import { Injectable } from '@nestjs/common';
import type { TaskPriority } from '@prisma/client';
import {
  CHART_DEFAULT_RANGE_DAYS,
  CHART_MAX_RANGE_DAYS,
  computeBacklogPenalty,
  computeBaseScore,
  TASK_PRIORITY_WEIGHT,
  type ChartRangeQuery,
  type DatedChartPoint,
  type RoutineChartPoint,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';
import { wallClockInTz } from '../activity/tz.util';

/// Consistency chart reads (TaskCharts.md §6.1).
///
/// Two series types, both global:
///
///   - Global dated   → aggregate per-section rows by date, THEN re-apply
///                       the score formula to the day's totals (not an
///                       average — see TaskCharts.md §6.1).
///   - Global routine → same aggregate pattern over routine_section_daily_score.
///
/// ponytail: per-section + inbox dated reads (via `datedPerSection`) were
/// dropped when the UI stopped rendering per-section charts. The underlying
/// `dated_section_daily_score` writes still happen nightly, so reinstating
/// the read path is a small additive change — no data gap to backfill.
///
/// All ranges respect the user's timezone for the default-range window.
/// `from` / `to` are user-local YYYY-MM-DD; the stored score rows use
/// DATE columns (no tz), so the comparison is a direct string match.
@Injectable()
export class ChartsService {
  constructor(private readonly prisma: PrismaService) {}

  async routineGlobal(
    userId: string,
    query: ChartRangeQuery,
  ): Promise<RoutineChartPoint[]> {
    const { from, to } = await this.resolveRange(userId, query);
    const rows = await this.prisma.routineSectionDailyScore.findMany({
      where: { userId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        scheduledCount: true,
        completedCount: true,
        scheduledWeight: true,
        completedWeight: true,
      },
    });

    // Aggregate per-section rows by date, THEN re-apply the formula
    // to the day's global totals. Running total is computed from the
    // re-derived daily score (NOT summed from per-section running totals,
    // which would overcount).
    const dailyTotals = groupByDate(rows);
    const points: RoutineChartPoint[] = [];
    let running = 0;
    for (const [date, totals] of dailyTotals) {
      const score = computeBaseScore(totals.scheduledCount, totals.completedWeight);
      running = round3(running + score);
      points.push({
        date,
        scheduledCount: totals.scheduledCount,
        completedCount: totals.completedCount,
        scheduledWeight: totals.scheduledWeight,
        completedWeight: totals.completedWeight,
        score,
        runningTotal: running,
      });
    }
    return points;
  }

  async datedGlobal(
    userId: string,
    query: ChartRangeQuery,
  ): Promise<DatedChartPoint[]> {
    const { from, to } = await this.resolveRange(userId, query);
    const rows = await this.prisma.datedSectionDailyScore.findMany({
      where: { userId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        scheduledCount: true,
        completedCount: true,
        scheduledWeight: true,
        completedWeight: true,
        backlogCount: true,
        backlogTopPriority: true,
      },
    });

    const dailyTotals = groupByDateDated(rows);
    const points: DatedChartPoint[] = [];
    let running = 0;
    for (const [date, totals] of dailyTotals) {
      const baseScore = computeBaseScore(totals.scheduledCount, totals.completedWeight);
      // Backlog penalty recomputes from the GLOBAL count (not a sum of
      // per-section penalties — geometric decay is non-linear).
      const backlogPenalty = computeBacklogPenalty(totals.backlogCount);
      const score = round3(baseScore + backlogPenalty);
      running = round3(running + score);
      points.push({
        date,
        scheduledCount: totals.scheduledCount,
        completedCount: totals.completedCount,
        scheduledWeight: totals.scheduledWeight,
        completedWeight: totals.completedWeight,
        backlogCount: totals.backlogCount,
        backlogTopPriority: totals.backlogTopPriority,
        baseScore,
        backlogPenalty,
        score,
        runningTotal: running,
      });
    }
    return points;
  }

  // -----------------------------------------------------------------
  //  Range resolution
  // -----------------------------------------------------------------

  /// Resolves `from` / `to` from the query, defaulting to the last
  /// CHART_DEFAULT_RANGE_DAYS ending today in the user's tz. Enforces
  /// CHART_MAX_RANGE_DAYS as a hard cap.
  private async resolveRange(
    userId: string,
    query: ChartRangeQuery,
  ): Promise<{ from: string; to: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = user?.timezone ?? 'UTC';
    const today = this.todayYmd(tz);

    const to = query.to ?? today;
    const from = query.from ?? addYmd(to, -(CHART_DEFAULT_RANGE_DAYS - 1));
    // Hard cap: clamp `from` upward if the requested span is too wide.
    const maxFrom = addYmd(to, -(CHART_MAX_RANGE_DAYS - 1));
    const clampedFrom = from < maxFrom ? maxFrom : from;
    return { from: clampedFrom, to };
  }

  private todayYmd(tz: string): string {
    const wc = wallClockInTz(new Date(), tz);
    return `${pad4(wc.year)}-${pad2(wc.month)}-${pad2(wc.day)}`;
  }
}

// =============================================================================
//  Grouping helpers (pure)
// =============================================================================

interface RoutineDailyTotals {
  scheduledCount: number;
  completedCount: number;
  scheduledWeight: number;
  completedWeight: number;
}

interface DatedDailyTotals extends RoutineDailyTotals {
  backlogCount: number;
  backlogTopPriority: TaskPriority | null;
}

/// Group routine score rows by date (user-local YYYY-MM-DD). Returns a
/// Map iterated in insertion order; since the query is `orderBy date asc`,
/// that's chronological which the chart needs.
function groupByDate(
  rows: readonly {
    date: Date;
    scheduledCount: number;
    completedCount: number;
    scheduledWeight: unknown; // Decimal
    completedWeight: unknown;
  }[],
): Map<string, RoutineDailyTotals> {
  const out = new Map<string, RoutineDailyTotals>();
  for (const r of rows) {
    const date = dateToYmd(r.date);
    const agg = out.get(date) ?? {
      scheduledCount: 0,
      completedCount: 0,
      scheduledWeight: 0,
      completedWeight: 0,
    };
    agg.scheduledCount += r.scheduledCount;
    agg.completedCount += r.completedCount;
    agg.scheduledWeight = round3(agg.scheduledWeight + Number(r.scheduledWeight));
    agg.completedWeight = round3(agg.completedWeight + Number(r.completedWeight));
    out.set(date, agg);
  }
  return out;
}

function groupByDateDated(
  rows: readonly {
    date: Date;
    scheduledCount: number;
    completedCount: number;
    scheduledWeight: unknown;
    completedWeight: unknown;
    backlogCount: number;
    backlogTopPriority: TaskPriority | null;
  }[],
): Map<string, DatedDailyTotals> {
  const out = new Map<string, DatedDailyTotals>();
  for (const r of rows) {
    const date = dateToYmd(r.date);
    const agg = out.get(date) ?? {
      scheduledCount: 0,
      completedCount: 0,
      scheduledWeight: 0,
      completedWeight: 0,
      backlogCount: 0,
      backlogTopPriority: null as TaskPriority | null,
    };
    agg.scheduledCount += r.scheduledCount;
    agg.completedCount += r.completedCount;
    agg.scheduledWeight = round3(agg.scheduledWeight + Number(r.scheduledWeight));
    agg.completedWeight = round3(agg.completedWeight + Number(r.completedWeight));
    agg.backlogCount += r.backlogCount;
    agg.backlogTopPriority = pickMaxPriority(agg.backlogTopPriority, r.backlogTopPriority);
    out.set(date, agg);
  }
  return out;
}

function pickMaxPriority(
  a: TaskPriority | null,
  b: TaskPriority | null,
): TaskPriority | null {
  if (a === null) return b;
  if (b === null) return a;
  return TASK_PRIORITY_WEIGHT[a] >= TASK_PRIORITY_WEIGHT[b] ? a : b;
}

// =============================================================================
//  Date helpers (same as maintenance.service.ts)
// =============================================================================

function toDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}
function dateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addYmd(ymd: string, days: number): string {
  const d = toDbDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToYmd(d);
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
