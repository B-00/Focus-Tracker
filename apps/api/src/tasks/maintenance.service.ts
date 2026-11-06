import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, TaskPriority } from '@prisma/client';
import {
  computeBacklogPenalty,
  computeBaseScore,
  sumWeight,
  TASK_PRIORITY_WEIGHT,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';
import { wallClockInTz } from '../activity/tz.util';

// Nightly task maintenance (Tasks.md §5.5 + TaskCharts.md §5).
//
// Four steps, run in strict order per-day:
//   1. Materialise missing routine instances (priority snapshot).
//   2. Snapshot dated due-day counts + backlog penalty into
//      dated_section_daily_score.         <-- MUST run before Step 3
//   3. Transfer / backlog missed dated tasks (the actual mutations).
//   4. Compute routine daily score into routine_section_daily_score.
//
// Catch-up on resume: when the API was off for N days, the per-day
// loop walks each missed day in order so Step 2 → Step 3 ordering is
// preserved for every snapshot. Bounded to MAX_CATCHUP_DAYS to keep
// a brand-new install (or a very long outage) from running wild.
//
// Inbox tasks (sectionId == null) ARE scored — the per-day group loops
// use `sectionId ?? null` as the map key so a null-sectioned group gets
// its own daily row. See `20261106_nullable_section_score_pk` for the
// supporting schema change. The upsert is a manual find-then-update
// because Prisma can't address the NULLS-NOT-DISTINCT raw-SQL unique
// index via its typed `upsert.where` helper.

interface StepReport {
  routineInstancesCreated: number;
  datedScoreRowsUpserted: number;
  routineScoreRowsUpserted: number;
  transferredCount: number;
  backloggedCount: number;
}

interface RunReport extends StepReport {
  userId: string;
  tz: string;
  today: string;         // YYYY-MM-DD, user-local
  firstProcessedDay: string | null; // null when no catch-up needed
  lastProcessedDay: string | null;
  daysProcessed: number;
}

/// How far back we're willing to catch up in one run. 60 days covers
/// "I was on vacation" and "the API crashed for a weekend"; longer
/// gaps leave prehistory unprocessed (which is correct — we can't
/// invent completion data for days the app wasn't running).
const MAX_CATCHUP_DAYS = 60;

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runForAllUsers(): Promise<RunReport[]> {
    const users = await this.prisma.user.findMany({
      select: { id: true, timezone: true },
    });
    const reports: RunReport[] = [];
    for (const u of users) {
      reports.push(await this.runForUser(u.id, u.timezone));
    }
    return reports;
  }

  async runForUser(userId: string, tzHint?: string): Promise<RunReport> {
    const tz = tzHint ?? (await this.resolveTimezone(userId));
    const today = this.todayYmd(tz);
    const firstDay = await this.resolveFirstDayToProcess(userId, today);

    const agg: StepReport = {
      routineInstancesCreated: 0,
      datedScoreRowsUpserted: 0,
      routineScoreRowsUpserted: 0,
      transferredCount: 0,
      backloggedCount: 0,
    };

    const daysProcessed: string[] = [];
    if (firstDay !== null) {
      // Loop from firstDay up through yesterday (= today - 1).
      let cursor = firstDay;
      const yesterday = addYmd(today, -1);
      while (cursor <= yesterday) {
        const stepReport = await this.processDay(userId, tz, cursor);
        agg.routineInstancesCreated += stepReport.routineInstancesCreated;
        agg.datedScoreRowsUpserted += stepReport.datedScoreRowsUpserted;
        agg.routineScoreRowsUpserted += stepReport.routineScoreRowsUpserted;
        agg.transferredCount += stepReport.transferredCount;
        agg.backloggedCount += stepReport.backloggedCount;
        daysProcessed.push(cursor);
        cursor = addYmd(cursor, 1);
      }
    }

    const report: RunReport = {
      userId,
      tz,
      today,
      firstProcessedDay: daysProcessed[0] ?? null,
      lastProcessedDay: daysProcessed[daysProcessed.length - 1] ?? null,
      daysProcessed: daysProcessed.length,
      ...agg,
    };
    this.logger.log(
      `nightly: user=${userId} tz=${tz} today=${today} ` +
        `days=${report.daysProcessed} ` +
        `routineInst+=${agg.routineInstancesCreated} ` +
        `datedScore=${agg.datedScoreRowsUpserted} ` +
        `routineScore=${agg.routineScoreRowsUpserted} ` +
        `transferred=${agg.transferredCount} ` +
        `backlogged=${agg.backloggedCount}`,
    );
    return report;
  }

  // -----------------------------------------------------------------
  //  Per-day driver
  // -----------------------------------------------------------------

  private async processDay(
    userId: string,
    tz: string,
    day: string, // YYYY-MM-DD, user-local
  ): Promise<StepReport> {
    const routineInstancesCreated = await this.step1_materialiseRoutines(userId, day);
    const datedScoreRowsUpserted = await this.step2_snapshotDatedScore(userId, tz, day);
    const { transferredCount, backloggedCount } = await this.step3_transferAndBacklog(
      userId,
      day, // cutoff = run as if "today" were day + 1
    );
    const routineScoreRowsUpserted = await this.step4_snapshotRoutineScore(userId, day);

    return {
      routineInstancesCreated,
      datedScoreRowsUpserted,
      routineScoreRowsUpserted,
      transferredCount,
      backloggedCount,
    };
  }

  // -----------------------------------------------------------------
  //  Watermark
  // -----------------------------------------------------------------

  /// Returns the first day (YYYY-MM-DD) we need to process for this
  /// user, or null if we're fully caught up.
  ///
  /// Rule:
  ///   lastScoredDay = max(date) across both daily-score tables for user
  ///   firstDay      = max(lastScoredDay + 1, today - MAX_CATCHUP_DAYS)
  ///   if firstDay > yesterday: null
  private async resolveFirstDayToProcess(
    userId: string,
    today: string,
  ): Promise<string | null> {
    const yesterday = addYmd(today, -1);
    const minAllowed = addYmd(today, -MAX_CATCHUP_DAYS);

    const [routineHigh, datedHigh] = await Promise.all([
      this.prisma.routineSectionDailyScore.findFirst({
        where: { userId },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
      this.prisma.datedSectionDailyScore.findFirst({
        where: { userId },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
    ]);
    const highest = [routineHigh?.date, datedHigh?.date]
      .filter((d): d is Date => d != null)
      .map(dateToYmd)
      .sort()
      .pop();

    const candidate = highest ? addYmd(highest, 1) : minAllowed;
    const firstDay = candidate > minAllowed ? candidate : minAllowed;

    if (firstDay > yesterday) return null;
    return firstDay;
  }

  // -----------------------------------------------------------------
  //  Step 1 — materialise missing past routine instances
  // -----------------------------------------------------------------

  private async step1_materialiseRoutines(
    userId: string,
    day: string,
  ): Promise<number> {
    const dayDbDate = toDbDate(day);
    const isoWeekday = isoWeekdayOfYmd(day);

    const routines = await this.prisma.task.findMany({
      where: {
        userId,
        kind: 'routine',
        archivedAt: null,
        routineDaysOfWeek: { has: isoWeekday },
        AND: [
          {
            OR: [
              { routineStartDate: null },
              { routineStartDate: { lte: dayDbDate } },
            ],
          },
          {
            OR: [
              { routineEndDate: null },
              { routineEndDate: { gte: dayDbDate } },
            ],
          },
        ],
      },
      select: { id: true, priority: true },
    });

    if (routines.length === 0) return 0;

    // createMany + skipDuplicates relies on the (taskId, scheduledDate)
    // unique index to make this idempotent. Re-running the same day is
    // a no-op.
    const res = await this.prisma.taskInstance.createMany({
      data: routines.map((r) => ({
        taskId: r.id,
        scheduledDate: dayDbDate,
        priority: r.priority,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  // -----------------------------------------------------------------
  //  Step 2 — dated score snapshot (MUST run before Step 3)
  // -----------------------------------------------------------------

  private async step2_snapshotDatedScore(
    userId: string,
    tz: string,
    day: string,
  ): Promise<number> {
    const dayDbDate = toDbDate(day);
    const endOfDay = this.endOfLocalDayUtc(day, tz);

    // Candidate tasks: single-day dated, due on this day, not yet in
    // backlog, not archived. endDate IS NULL OR endDate = startDate
    // enforces "single day"; approximated here as endDate IS NULL +
    // in-memory filter for the rare endDate == startDate case.
    // Inbox tasks (sectionId == null) are INCLUDED — they're grouped under
    // the null key below and get their own daily row.
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        kind: 'dated',
        archivedAt: null,
        inBacklog: false,
        startDate: dayDbDate,
      },
      select: {
        id: true,
        sectionId: true,
        priority: true,
        completedAt: true,
        endDate: true,
        startDate: true,
        transferredFromDate: true,
      },
    });

    // In-memory single-day filter.
    const singleDay = tasks.filter(
      (t) =>
        t.endDate === null ||
        (t.startDate !== null && t.endDate.getTime() === t.startDate.getTime()),
    );
    if (singleDay.length === 0) return 0;

    // Group by sectionId; null = Inbox pseudo-group.
    const bySection = new Map<string | null, typeof singleDay>();
    for (const t of singleDay) {
      const sid = t.sectionId;
      const arr = bySection.get(sid) ?? [];
      arr.push(t);
      bySection.set(sid, arr);
    }

    let rowsWritten = 0;
    for (const [sectionId, groupTasks] of bySection) {
      const scheduledCount = groupTasks.length;
      const scheduledPriorities = groupTasks.map((t) => t.priority);
      const scheduledWeight = sumWeight(scheduledPriorities);

      const completed = groupTasks.filter(
        (t) => t.completedAt !== null && t.completedAt.getTime() <= endOfDay.getTime(),
      );
      const completedCount = completed.length;
      const completedWeight = sumWeight(completed.map((t) => t.priority));

      // Backlog set = tasks that Step 3 will push to Backlog at end of
      // this day: already-transferred AND still-uncompleted.
      const backlogTasks = groupTasks.filter(
        (t) => t.completedAt === null && t.transferredFromDate !== null,
      );
      const backlogCount = backlogTasks.length;
      const backlogTopPriority =
        backlogCount === 0
          ? null
          : maxPriority(backlogTasks.map((t) => t.priority));

      const baseScore = computeBaseScore(scheduledCount, completedWeight);
      const backlogPenalty = computeBacklogPenalty(backlogCount);
      const score = round3(baseScore + backlogPenalty);
      const runningTotal = round3(
        (await this.previousDatedRunningTotal(userId, sectionId, day)) + score,
      );

      // Manual upsert: find by (userId, sectionId, date) then update or
      // create. Can't use `prisma.upsert` because the NULLS-NOT-DISTINCT
      // unique lives in raw SQL and isn't visible to the Prisma client.
      const existing = await this.prisma.datedSectionDailyScore.findFirst({
        where: { userId, sectionId, date: dayDbDate },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.datedSectionDailyScore.update({
          where: { id: existing.id },
          data: {
            scheduledCount,
            completedCount,
            scheduledWeight,
            completedWeight,
            backlogCount,
            backlogTopPriority,
            baseScore,
            backlogPenalty,
            score,
            runningTotal,
            computedAt: new Date(),
          },
        });
      } else {
        await this.prisma.datedSectionDailyScore.create({
          data: {
            sectionId,
            userId,
            date: dayDbDate,
            scheduledCount,
            completedCount,
            scheduledWeight,
            completedWeight,
            backlogCount,
            backlogTopPriority,
            baseScore,
            backlogPenalty,
            score,
            runningTotal,
          },
        });
      }
      rowsWritten += 1;
    }
    return rowsWritten;
  }

  // -----------------------------------------------------------------
  //  Step 3 — transfer / backlog missed dated tasks
  // -----------------------------------------------------------------

  /// `day` is the simulated "end of day" — we transfer/backlog
  /// anything with `startDate <= day` that's still missed. In
  /// day-by-day catch-up this is called with each day in order so a
  /// task misses day D (→ transfer), then misses D+1 (→ backlog).
  private async step3_transferAndBacklog(
    userId: string,
    day: string,
  ): Promise<{ transferredCount: number; backloggedCount: number }> {
    const dayDbDate = toDbDate(day);
    // "After end of `day`" = startDate <= day (lte). Equivalent to the
    // original "< today" with today = day + 1.
    const candidates = await this.prisma.task.findMany({
      where: {
        userId,
        kind: 'dated',
        archivedAt: null,
        inBacklog: false,
        completedAt: null,
        startDate: { lte: dayDbDate },
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        transferIfMissed: true,
        transferredFromDate: true,
      },
    });

    const toTransfer: { id: string; originalDate: Date }[] = [];
    const toBacklog: string[] = [];
    for (const t of candidates) {
      if (t.startDate === null) continue;
      const isSingleDay =
        t.endDate === null || t.endDate.getTime() === t.startDate.getTime();
      if (!isSingleDay) continue;

      if (t.transferIfMissed && t.transferredFromDate === null) {
        toTransfer.push({ id: t.id, originalDate: t.startDate });
      } else {
        toBacklog.push(t.id);
      }
    }

    if (toTransfer.length > 0) {
      await this.prisma.$transaction(
        toTransfer.map((t) =>
          this.prisma.task.update({
            where: { id: t.id },
            data: {
              startDate: addDaysDate(t.originalDate, 1),
              transferredFromDate: t.originalDate,
            },
          }),
        ),
      );
    }
    if (toBacklog.length > 0) {
      await this.prisma.task.updateMany({
        where: { id: { in: toBacklog } },
        data: { inBacklog: true },
      });
    }

    return {
      transferredCount: toTransfer.length,
      backloggedCount: toBacklog.length,
    };
  }

  // -----------------------------------------------------------------
  //  Step 4 — routine score snapshot
  // -----------------------------------------------------------------

  private async step4_snapshotRoutineScore(
    userId: string,
    day: string,
  ): Promise<number> {
    const dayDbDate = toDbDate(day);

    // All of this user's routine instances scheduled on this day.
    // Join to Task for sectionId; inbox (sectionId == null) IS included
    // and grouped under the null key.
    const instances = await this.prisma.taskInstance.findMany({
      where: {
        scheduledDate: dayDbDate,
        task: { userId },
      },
      select: {
        priority: true,
        completedAt: true,
        task: { select: { sectionId: true } },
      },
    });
    if (instances.length === 0) return 0;

    const bySection = new Map<string | null, typeof instances>();
    for (const i of instances) {
      const sid = i.task.sectionId;
      const arr = bySection.get(sid) ?? [];
      arr.push(i);
      bySection.set(sid, arr);
    }

    let rowsWritten = 0;
    for (const [sectionId, group] of bySection) {
      const scheduledCount = group.length;
      const scheduledWeight = sumWeight(group.map((i) => i.priority));
      const completed = group.filter((i) => i.completedAt !== null);
      const completedCount = completed.length;
      const completedWeight = sumWeight(completed.map((i) => i.priority));

      const score = computeBaseScore(scheduledCount, completedWeight);
      const runningTotal = round3(
        (await this.previousRoutineRunningTotal(userId, sectionId, day)) + score,
      );

      // Manual upsert — see Step 2 for the rationale.
      const existing = await this.prisma.routineSectionDailyScore.findFirst({
        where: { userId, sectionId, date: dayDbDate },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.routineSectionDailyScore.update({
          where: { id: existing.id },
          data: {
            scheduledCount,
            completedCount,
            scheduledWeight,
            completedWeight,
            score,
            runningTotal,
            computedAt: new Date(),
          },
        });
      } else {
        await this.prisma.routineSectionDailyScore.create({
          data: {
            sectionId,
            userId,
            date: dayDbDate,
            scheduledCount,
            completedCount,
            scheduledWeight,
            completedWeight,
            score,
            runningTotal,
          },
        });
      }
      rowsWritten += 1;
    }
    return rowsWritten;
  }

  // -----------------------------------------------------------------
  //  Running-total lookups
  // -----------------------------------------------------------------

  private async previousDatedRunningTotal(
    userId: string,
    sectionId: string | null,
    day: string,
  ): Promise<number> {
    const row = await this.prisma.datedSectionDailyScore.findFirst({
      where: { userId, sectionId, date: { lt: toDbDate(day) } },
      orderBy: { date: 'desc' },
      select: { runningTotal: true },
    });
    return row ? Number(row.runningTotal) : 0;
  }

  private async previousRoutineRunningTotal(
    userId: string,
    sectionId: string | null,
    day: string,
  ): Promise<number> {
    const row = await this.prisma.routineSectionDailyScore.findFirst({
      where: { userId, sectionId, date: { lt: toDbDate(day) } },
      orderBy: { date: 'desc' },
      select: { runningTotal: true },
    });
    return row ? Number(row.runningTotal) : 0;
  }

  // -----------------------------------------------------------------
  //  Helpers
  // -----------------------------------------------------------------

  private async resolveTimezone(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return u?.timezone ?? 'UTC';
  }

  private todayYmd(tz: string): string {
    const wc = wallClockInTz(new Date(), tz);
    return `${pad4(wc.year)}-${pad2(wc.month)}-${pad2(wc.day)}`;
  }

  /// End-of-day (23:59:59.999) in the user's tz, expressed as a UTC
  /// Date. Used to bound "completed by end of day" for Step 2.
  private endOfLocalDayUtc(day: string, tz: string): Date {
    // Reuse Intl: construct 23:59:59.999 wall-clock in tz, measure offset.
    const [y, m, d] = day.split('-').map(Number);
    if (!y || !m || !d) throw new Error(`bad day: ${day}`);
    // Zone offset for this day. zonedTimeToUtc lives in tz.util but
    // isn't exported for this file; inline the calc.
    const naiveUtcMs = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
    const wc = wallClockInTz(new Date(naiveUtcMs), tz);
    const observedUtcMs = Date.UTC(
      wc.year,
      wc.month - 1,
      wc.day,
      wc.hour,
      wc.minute,
      wc.second,
    );
    const offsetMs = observedUtcMs - naiveUtcMs;
    return new Date(naiveUtcMs - offsetMs);
  }
}

// =============================================================================
//  Module-private helpers
// =============================================================================

function toDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function dateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysDate(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addYmd(ymd: string, days: number): string {
  return dateToYmd(addDaysDate(toDbDate(ymd), days));
}

function isoWeekdayOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const utcDow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return utcDow === 0 ? 7 : utcDow;
}

/// Max priority in the extreme > high > mid > low sense.
function maxPriority(ps: readonly TaskPriority[]): TaskPriority {
  // Use TASK_PRIORITY_WEIGHT as a dense numeric ordering.
  let best: TaskPriority = ps[0]!;
  let bestW = TASK_PRIORITY_WEIGHT[best];
  for (let i = 1; i < ps.length; i++) {
    const w = TASK_PRIORITY_WEIGHT[ps[i]!];
    if (w > bestW) {
      best = ps[i]!;
      bestW = w;
    }
  }
  return best;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
