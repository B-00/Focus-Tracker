// Typed fetchers + query keys for the three consistency chart endpoints
// (see TaskCharts.md §6.1 + §7).
//
// All three return the same wire shape (routine or dated series), so
// one hook can drive /tasks top-of-page, per-Section Dated, and the
// dashboard widget variants. Query keys include the resolved range so
// switching range pills doesn't thrash the same cache slot.

import type {
  DatedChartPoint,
  DatedChartSeriesResponse,
  RoutineChartPoint,
  RoutineChartSeriesResponse,
} from '@focus-tracker/shared';
import { api } from './api';

// ---------------------------------------------------------------------------
//  Range selector
// ---------------------------------------------------------------------------

/// The range pills the UI exposes. Pre-resolved to a day count here
/// (server accepts explicit `from` / `to`, no pill-name mapping needed
/// server-side). "All" is represented as the chart's max (365d — the API
/// clamps anything larger).
///
/// ponytail: 1D renders a single data point (scores post nightly, so a
/// line chart with one dot). That's expected — a user who picks 1D is
/// explicitly asking for "just today". Recharts handles the degenerate
/// case fine.
export const CHART_RANGE_PILLS = ['1D', '1W', '1M', '3M', '6M', '1Y'] as const;
export type ChartRangePill = (typeof CHART_RANGE_PILLS)[number];

export const CHART_RANGE_DAYS: Record<ChartRangePill, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

/// Dashboard widget variants omit 1Y per TaskCharts.md §3.4; use this
/// tuple to render a compact pill row.
export const CHART_RANGE_PILLS_COMPACT = ['1M', '3M'] as const;

// ---------------------------------------------------------------------------
//  Query keys
// ---------------------------------------------------------------------------

export const chartsQueryKeys = {
  all: ['charts'] as const,
  routineGlobal: (days: number) =>
    [...chartsQueryKeys.all, 'routine', 'global', days] as const,
  datedGlobal: (days: number) =>
    [...chartsQueryKeys.all, 'dated', 'global', days] as const,
};

// ---------------------------------------------------------------------------
//  Fetchers
// ---------------------------------------------------------------------------

/// Resolve [from, to] as YYYY-MM-DD for the given rolling-day window
/// ending today in the browser's local date space. Server will clamp
/// if the range is out of bounds.
function rollingRange(days: number): { from: string; to: string } {
  const now = new Date();
  const to = ymd(now);
  const start = new Date(now.getTime());
  start.setDate(start.getDate() - (days - 1));
  return { from: ymd(start), to };
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function fetchRoutineGlobal(days: number): Promise<RoutineChartPoint[]> {
  const res = await api.get<RoutineChartSeriesResponse>('/v1/charts/routine/global', {
    params: rollingRange(days),
  });
  return res.data.series;
}

export async function fetchDatedGlobal(days: number): Promise<DatedChartPoint[]> {
  const res = await api.get<DatedChartSeriesResponse>('/v1/charts/dated/global', {
    params: rollingRange(days),
  });
  return res.data.series;
}
