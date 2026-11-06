import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CHART_RANGE_DAYS,
  CHART_RANGE_PILLS,
  CHART_RANGE_PILLS_COMPACT,
  chartsQueryKeys,
  fetchDatedGlobal,
  fetchDatedInbox,
  fetchDatedSection,
  fetchRoutineGlobal,
  type ChartRangePill,
} from '../../lib/charts-api';
import { ChartRangePills } from './ChartRangePills';
import {
  CumulativeScoreChart,
  type ChartPoint,
} from './CumulativeScoreChart';

// Chart block = header (title + range pills) + chart body. Owns the
// range-pill state locally — different chart blocks on the same page
// can show different ranges independently without a store. If that
// turns out to be undesirable, promoting to a shared store later is a
// one-file change.

type Scope =
  | { kind: 'routine-global' }
  | { kind: 'dated-global' }
  | { kind: 'dated-section'; sectionId: string }
  | { kind: 'dated-inbox' };

interface Props {
  title: string;
  /// Which series to load.
  scope: Scope;
  /// Chart tint. Routines default to emerald (positive-habit feel), dated
  /// default to sky-blue (project-work feel). Per-section dated can be
  /// overridden to the Section accent color.
  lineColor?: string;
  /// Height of the chart body in pixels. Defaults 240; dashboard
  /// variants pass a smaller value.
  height?: number;
  /// Compact pill set (1M, 3M) for dashboard widgets. Full set
  /// (1M, 3M, 6M, 1Y) elsewhere.
  compact?: boolean;
  /// Right-side slot in the header (e.g. "Open tasks →" link on
  /// dashboard variants, or widget reorder controls).
  headerRight?: React.ReactNode;
  /// Shown in place of the chart body when the server returns an
  /// empty series. Default: "Not enough data yet — keep at it."
  emptyLabel?: React.ReactNode;
}

export function ConsistencyChartBlock({
  title,
  scope,
  lineColor,
  height = 240,
  compact = false,
  headerRight,
  emptyLabel,
}: Props) {
  const defaultPill: ChartRangePill = compact ? '1M' : '3M';
  const [pill, setPill] = useState<ChartRangePill>(defaultPill);
  const days = CHART_RANGE_DAYS[pill];

  const query = useChartQuery(scope, days);

  const resolvedColor = lineColor ?? defaultColorForScope(scope);
  const pills = compact ? CHART_RANGE_PILLS_COMPACT : CHART_RANGE_PILLS;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            {title}
          </h3>
          <ChartRangePills value={pill} onChange={setPill} options={pills} />
        </div>
        {headerRight}
      </header>
      {query.isLoading && (
        <div
          className="flex items-center justify-center text-xs text-neutral-500"
          style={{ height }}
        >
          Loading…
        </div>
      )}
      {query.isError && (
        <div
          className="flex items-center justify-center text-xs text-red-300"
          style={{ height }}
        >
          Couldn't load chart.
        </div>
      )}
      {query.data && (
        <CumulativeScoreChart
          series={query.data}
          height={height}
          lineColor={resolvedColor}
          emptyLabel={emptyLabel}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Query selection
// ---------------------------------------------------------------------------

function useChartQuery(scope: Scope, days: number) {
  // Each hook call is stable-keyed on scope + days; conditional
  // queryKey selection below keeps the hook-ordering invariants happy.
  const key = chartKey(scope, days);
  return useQuery<ChartPoint[]>({
    queryKey: key,
    queryFn: () => chartFetcher(scope, days),
    // Scores don't change intra-day (nightly job writes them); stale
    // after 60s is plenty to avoid chatter on tab-focus flips.
    staleTime: 60_000,
  });
}

function chartKey(scope: Scope, days: number): readonly unknown[] {
  if (scope.kind === 'routine-global') return chartsQueryKeys.routineGlobal(days);
  if (scope.kind === 'dated-global') return chartsQueryKeys.datedGlobal(days);
  if (scope.kind === 'dated-inbox') return chartsQueryKeys.datedInbox(days);
  return chartsQueryKeys.datedSection(scope.sectionId, days);
}

function chartFetcher(scope: Scope, days: number): Promise<ChartPoint[]> {
  if (scope.kind === 'routine-global') return fetchRoutineGlobal(days);
  if (scope.kind === 'dated-global') return fetchDatedGlobal(days);
  if (scope.kind === 'dated-inbox') return fetchDatedInbox(days);
  return fetchDatedSection(scope.sectionId, days);
}

function defaultColorForScope(scope: Scope): string {
  if (scope.kind === 'routine-global') return '#34d399'; // emerald-400
  return '#38bdf8'; // sky-400 for dated (incl. inbox + per-section)
}
