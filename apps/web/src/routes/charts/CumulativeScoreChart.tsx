import type { ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';

// Shared Recharts time-series for both the Routine and Dated families
// (TaskCharts.md §4). "Cumulative" = plots `runningTotal` over time,
// styled like a stock chart's price line.
//
// Both families share this component; dated-specific affordances (per-
// point backlog badge) are driven by `hasBacklog` on the data row.
//
// ponytail: today's point is included in the line directly. The spec
// calls for a separate "in-progress" marker (§4.5) since today's score
// isn't finalised until the nightly job runs. For v1 we rely on the
// tooltip to show the running total; a distinct today-marker dot is
// deferred until a user actually notices the provisional point looks
// final.

export interface ChartPoint {
  date: string;              // YYYY-MM-DD
  score: number;
  runningTotal: number;
  scheduledCount: number;
  completedCount: number;
  scheduledWeight: number;
  completedWeight: number;
  /// Dated-only — undefined for routine series.
  backlogCount?: number;
  backlogPenalty?: number;
  baseScore?: number;
}

interface Props {
  series: ChartPoint[];
  /// Height in pixels. Default 240 for full charts; dashboard widgets
  /// pass ~160 for compact variants.
  height?: number;
  /// Tint for the main line. Defaults to emerald (matches app accent).
  lineColor?: string;
  /// Shown when `series` is empty — "Not enough data yet" style.
  emptyLabel?: ReactNode;
}

export function CumulativeScoreChart({
  series,
  height = 240,
  lineColor = '#34d399', // emerald-400
  emptyLabel = 'Not enough data yet — keep at it.',
}: Props) {
  if (series.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-neutral-800 bg-neutral-950 text-xs text-neutral-500"
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            stroke="#525252"
            tick={{ fill: '#737373', fontSize: 10 }}
            // Keep axis sparse — stock-chart feel, not calendar-every-day.
            minTickGap={32}
          />
          <YAxis
            stroke="#525252"
            tick={{ fill: '#737373', fontSize: 10 }}
            width={36}
            // Running total is signed; let Recharts auto-domain. The
            // zero reference below gives the eye a baseline.
            domain={['auto', 'auto']}
          />
          <ReferenceLine y={0} stroke="#404040" strokeDasharray="2 2" />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#525252' }} />
          <Line
            type="monotone"
            dataKey="runningTotal"
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            // Make the final point visible so "today" stands out.
            activeDot={{ r: 3, fill: lineColor, stroke: '#0a0a0a', strokeWidth: 1 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/// "YYYY-MM-DD" -> "Mon DD" (en-US short form) for the x-axis ticks.
function shortDate(ymd: string): string {
  // Parse as local to avoid tz shift on the label.
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ChartPoint | undefined;
  if (!row) return null;

  const isDated = row.backlogCount !== undefined;
  // "would-be-max today if you'd done it all" per TaskCharts.md §4.2.
  const maxToday =
    row.scheduledCount > 0 ? row.scheduledWeight / row.scheduledCount : 0;

  return (
    <div className="rounded border border-neutral-700 bg-neutral-900/95 px-3 py-2 text-xs text-neutral-200 shadow-lg backdrop-blur-sm">
      <div className="font-medium text-neutral-100">{longDate(row.date)}</div>
      <div className="mt-1 flex items-center justify-between gap-6 text-neutral-400">
        <span>Running total</span>
        <span className="font-mono tabular-nums text-neutral-100">
          {fmtSigned(row.runningTotal)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-6 text-neutral-400">
        <span>Day score</span>
        <span
          className={`font-mono tabular-nums ${
            row.score < 0 ? 'text-red-300' : 'text-emerald-300'
          }`}
        >
          {fmtSigned(row.score)}
        </span>
      </div>
      {row.scheduledCount > 0 && (
        <div className="mt-1 text-neutral-500">
          {row.completedCount} of {row.scheduledCount} completed
          <span className="text-neutral-600">
            {' — max today +'}
            {maxToday.toFixed(2)}
          </span>
        </div>
      )}
      {isDated && row.backlogCount !== undefined && row.backlogCount > 0 && (
        <div className="mt-1 text-amber-300/90">
          {row.backlogCount} backlog
          {row.backlogCount === 1 ? '' : ' events'} · penalty{' '}
          {fmtSigned(row.backlogPenalty ?? 0)}
        </div>
      )}
      {row.scheduledCount === 0 && (
        <div className="mt-1 italic text-neutral-500">Nothing scheduled</div>
      )}
    </div>
  );
}

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtSigned(n: number): string {
  const s = n.toFixed(2);
  return n > 0 ? `+${s}` : s;
}
