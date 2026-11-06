// Consistency chart wire contracts + pure scoring helpers.
//
// Owner: TaskCharts.md
//   §5.1  — base score formula (completedWeight / scheduledCount, mid-reference)
//   §5.3  — dated-only backlog penalty (geometric decay, bounded near -3)
//   §5.4  — persisted score row shape
//   §6.1  — three endpoints (two globals + one per-section)
//
// The helpers below are the SINGLE SOURCE OF TRUTH for the formula. Both the
// nightly job (apps/api MaintenanceService) and any UI that needs to recompute
// (tooltip breakdowns, optimistic today-point updates) import from here so the
// math can't drift between server and client.

import { z } from 'zod';
import { TASK_PRIORITIES, TASK_PRIORITY_WEIGHT, type TaskPriority } from './enums.js';

// ---------------------------------------------------------------------------
//  Pure scoring helpers (TaskCharts.md §5)
// ---------------------------------------------------------------------------

/// Base score per TaskCharts.md §5.1.
///
///   scheduledCount == 0            → 0        (no items scheduled)
///   completedWeight == 0 && n > 0  → -1       (floor for zero completion)
///   else                           → completedWeight / scheduledCount
///
/// Range: [-1, +2]. The upper bound is only reached when the day is 100%
/// extreme AND fully completed (2.0 weight per task / 1 count per task).
///
/// Rounded to 3 decimals to match the DB column's `Decimal(4,3)` precision
/// and avoid float drift between "0.6 + 0.2" and "0.8" in the stored score.
export function computeBaseScore(
  scheduledCount: number,
  completedWeight: number,
): number {
  if (scheduledCount <= 0) return 0;
  if (completedWeight <= 0) return -1;
  return round3(completedWeight / scheduledCount);
}

/// Backlog penalty per TaskCharts.md §5.3. Geometric decay, count-driven:
///
///   N == 0            → 0
///   N >= 1            → -3 + (1/2)^(N-1)
///
/// Range: (-3, 0]. Bounded — any N approaches but never reaches -3.
///
/// Priority ordering of which task takes which decay TERM is a reporting
/// concern (TaskCharts.md §5.3) — use `backlogDecayTerms` for that. This
/// function only returns the per-day total.
export function computeBacklogPenalty(backlogCount: number): number {
  if (backlogCount <= 0) return 0;
  // -3 + (1/2)^(N-1). Math.pow is exact here for small N; well-defined
  // through at least N = 50.
  return round3(-3 + Math.pow(0.5, backlogCount - 1));
}

/// Per-task decay-term assignment for the tooltip ("1 extreme took -2,
/// 1 high took -0.5, ..."). Sorts by descending priority, ties broken by
/// `transferredFromDate` ASC (oldest first). Pure; no IO.
///
/// Returns one `{ taskId, priority, term }` per input task, where the sum
/// of `term` values equals `computeBacklogPenalty(tasks.length)`.
export function backlogDecayTerms<T extends {
  taskId: string;
  priority: TaskPriority;
  transferredFromDate: string | null;
}>(tasks: readonly T[]): { taskId: string; priority: TaskPriority; term: number }[] {
  const priorityRank: Record<TaskPriority, number> = {
    extreme: 0, high: 1, mid: 2, low: 3,
  };
  const ordered = tasks.slice().sort((a, b) => {
    const p = priorityRank[a.priority] - priorityRank[b.priority];
    if (p !== 0) return p;
    const da = a.transferredFromDate ?? '';
    const db = b.transferredFromDate ?? '';
    return da.localeCompare(db);
  });
  return ordered.map((t, i) => ({
    taskId: t.taskId,
    priority: t.priority,
    // First task: -2. Thereafter -(1/2)^(k-1) for k >= 2.
    //   k=1 -> -2
    //   k=2 -> -0.5
    //   k=3 -> -0.25
    //   ...
    term: i === 0 ? -2 : -Math.pow(0.5, i),
  }));
}

/// Re-export so API + web can compute weighted sums with a single symbol
/// import instead of reaching into `enums`.
export { TASK_PRIORITY_WEIGHT, TASK_PRIORITIES };
export type { TaskPriority };

/// Convenience: sum priority weights over a collection. Used by both the
/// nightly job (to compute `completedWeight` / `scheduledWeight` for
/// persistence) and by the chart's global-aggregation path (to re-apply
/// the formula over GROUP BY date totals — TaskCharts.md §6.1).
export function sumWeight(priorities: readonly TaskPriority[]): number {
  let total = 0;
  for (const p of priorities) total += TASK_PRIORITY_WEIGHT[p];
  // 3dp to match DB column precision.
  return round3(total);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
//  Wire contracts — chart endpoints (TaskCharts.md §6.1)
// ---------------------------------------------------------------------------

/// Query range for all three chart endpoints. Dates are YYYY-MM-DD in the
/// user's local date space (API converts with the user's tz).
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/// Default range when `from` / `to` are both omitted: last 90 days ending
/// today (TaskCharts.md §4.2 — the chart's default zoom).
export const CHART_DEFAULT_RANGE_DAYS = 90;
/// Hard cap — bigger than this and the UI should page or coarsen. v1
/// chart library handles 365 points fine on desktop (TaskCharts.md §6.3).
export const CHART_MAX_RANGE_DAYS = 400;

export const chartRangeQuerySchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    { message: 'from must be <= to', path: ['from'] },
  );
export type ChartRangeQuery = z.infer<typeof chartRangeQuerySchema>;

/// Shared base score point. Routine series populates everything EXCEPT the
/// backlog columns (which are undefined for the routine family — see §5.4).
export const routineChartPointSchema = z.object({
  date: dateOnly,
  scheduledCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  scheduledWeight: z.number().nonnegative(),
  completedWeight: z.number().nonnegative(),
  score: z.number(),           // [-1, +2]; equals baseScore for routines
  runningTotal: z.number(),
});
export type RoutineChartPoint = z.infer<typeof routineChartPointSchema>;

export const datedChartPointSchema = routineChartPointSchema.extend({
  baseScore: z.number(),       // [-1, +2]
  backlogPenalty: z.number(),  // (-3, 0]
  backlogCount: z.number().int().nonnegative(),
  // Max priority among the backlog set that day. Nullable when backlogCount == 0.
  backlogTopPriority: z.enum(TASK_PRIORITIES).nullable(),
  // `score` on dated is `baseScore + backlogPenalty`, approximately [-4, +2].
});
export type DatedChartPoint = z.infer<typeof datedChartPointSchema>;

export const routineChartSeriesResponseSchema = z.object({
  series: z.array(routineChartPointSchema),
});
export type RoutineChartSeriesResponse = z.infer<
  typeof routineChartSeriesResponseSchema
>;

export const datedChartSeriesResponseSchema = z.object({
  series: z.array(datedChartPointSchema),
});
export type DatedChartSeriesResponse = z.infer<
  typeof datedChartSeriesResponseSchema
>;
