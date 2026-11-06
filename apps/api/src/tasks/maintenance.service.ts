import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { wallClockInTz } from '../activity/tz.util';

// Nightly task maintenance (Tasks.md §5.5).
//
// Scope right now: Step 3 only (transfer + backlog of missed dated
// single-day tasks). Steps 1 (routine past-materialization) and Step 2/4
// (daily-score snapshots) are deferred to the chart slice — until charts
// read historical rows, running them nightly just writes data nothing
// consumes.
//
// ponytail: skipping Step 2 means historical chart data starts "when
// Slice 5 lands". The spec's strict ordering ("Step 2 before Step 3") is
// satisfied by inference — if Step 2 isn't run at all, Step 3 is still
// correct. Upgrade path: add RoutineInstanceMaterialise + DailyScore
// services alongside this one when the chart ships.
//
// Catch-up semantics (§5.6 "catch-up"): a task missed for N days doesn't
// transfer N times; the first run after the miss transfers it once
// (miss-day → miss-day+1), and the next run notices it's still missed
// and moves it to backlog. The implementation below gets this for free
// because the two rules (transfer / backlog) are mutually exclusive on a
// single invocation (a task either has transferredFromDate=null AND
// transferIfMissed=true → transfer, or transferredFromDate!=null → backlog).

interface RunReport {
  userId: string;
  tz: string;
  today: string;
  transferredCount: number;
  backloggedCount: number;
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /// Run the transfer/backlog step for every user with at least one
  /// candidate missed task. Each user's "today" is computed in their
  /// own tz so running this once at e.g. 05:00 UTC covers the whole
  /// world correctly (no user sees their task transfer *during* their
  /// own day, as long as the job runs after local midnight everywhere).
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

  /// Run the transfer/backlog step for a single user. Used by the
  /// nightly job (one call per user) and by tests.
  async runForUser(userId: string, tzHint?: string): Promise<RunReport> {
    const tz = tzHint ?? (await this.resolveTimezone(userId));
    const today = this.todayYmd(tz);
    const todayDbDate = toDbDate(today);

    // All candidate tasks: missed single-day dated, not archived, not
    // completed. Fetch in one query, then partition locally — cheaper
    // than two near-identical queries, and the volume is tiny.
    const candidates = await this.prisma.task.findMany({
      where: {
        userId,
        kind: 'dated',
        archivedAt: null,
        inBacklog: false,
        completedAt: null,
        startDate: { lt: todayDbDate },
        // Single-day: endDate IS NULL OR endDate == startDate. Prisma
        // doesn't support column-to-column equality in a filter, so we
        // approximate by endDate IS NULL here and verify in-memory for
        // the equal case. Keeps the DB query indexable.
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
      if (t.startDate === null) continue; // defensive — schema says dated has startDate
      const isSingleDay =
        t.endDate === null || t.endDate.getTime() === t.startDate.getTime();
      if (!isSingleDay) continue;

      if (t.transferIfMissed && t.transferredFromDate === null) {
        // First miss → transfer forward by one day. Not to "today" —
        // §5.6 is explicit: "roll forward by one day", so a task missed
        // Monday transfers to Tuesday regardless of when the job runs.
        toTransfer.push({ id: t.id, originalDate: t.startDate });
      } else {
        // Either already transferred (transferredFromDate != null) OR
        // transferIfMissed=false. Either way: move to backlog.
        toBacklog.push(t.id);
      }
    }

    // Writes in two batched updateMany-per-task passes. updateMany can't
    // set per-row distinct values, so we use Promise.all over update()
    // calls — fine at the tiny volumes expected for a personal tracker.
    if (toTransfer.length > 0) {
      await this.prisma.$transaction(
        toTransfer.map((t) =>
          this.prisma.task.update({
            where: { id: t.id },
            data: {
              startDate: addDays(t.originalDate, 1),
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

    const report: RunReport = {
      userId,
      tz,
      today,
      transferredCount: toTransfer.length,
      backloggedCount: toBacklog.length,
    };
    this.logger.log(
      `nightly: user=${userId} tz=${tz} today=${today} ` +
        `transferred=${report.transferredCount} ` +
        `backlogged=${report.backloggedCount}`,
    );
    return report;
  }

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
}

function toDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
