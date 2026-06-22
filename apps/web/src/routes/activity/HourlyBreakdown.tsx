import { useMemo, useState } from 'react';
import type {
  ActivityBucket,
  ActivityBucketGrain,
  ActivityTargetTotal,
} from '@focus-tracker/shared';
import { formatDurationCompact } from '../../lib/format-duration';
import { OTHER_COLOR, PALETTE } from './palette';

// Per-kind stacked breakdown chart. One instance for apps, one for sites
// on the /activity page. Bars are stacked by the top-N target colors
// (matching the donut + ranked list in TopTargetsList) with an "Other"
// segment in the cyan track color for everything outside the top N.
//
// Hover shows a tooltip with the bucket time, total, and the per-target
// breakdown (top N + Other), filtered to non-zero entries. The tooltip
// floats above the hovered bar.
//
// Owner: Activity.md §4.1 ("HOURLY BREAKDOWN" panel), §7 (accessibility).

interface HourlyBreakdownProps {
  /// Either "apps" or "sites" — drives which bucket field gets stacked
  /// (`appsByTopTarget` vs `sitesByTopTarget`), which top-N list provides
  /// the segment labels + colors, and which copy the header / tooltip
  /// title uses.
  kind: 'apps' | 'sites';
  buckets: ActivityBucket[];
  /// Aligned by index with each bucket's `(apps|sites)ByTopTarget` array —
  /// drives the segment names + tooltip rows.
  topTargets: ActivityTargetTotal[];
  grain: ActivityBucketGrain;
  timezone: string;
}

const MIN_BAR_HEIGHT_FRAC = 0.02; // 2% — keep tiny non-zero buckets visible.

interface HoverState {
  bucketIndex: number;
}

export function HourlyBreakdown({
  kind,
  buckets,
  topTargets,
  grain,
  timezone,
}: HourlyBreakdownProps) {
  // Each row collapses the four-shape API into a single rendering model
  // {total, segments[]} so the per-bar code below doesn't have to keep
  // re-deriving "Other" or sniffing the source field.
  const rows = useMemo(
    () =>
      buckets.map((b) => {
        const sourceTotal = kind === 'apps' ? b.apps : b.sites;
        const byTarget = kind === 'apps' ? b.appsByTopTarget : b.sitesByTopTarget;
        // The byTarget array is the same length as topTargets — defensive
        // `?? 0` handles a payload regression without crashing the chart.
        const segments = topTargets.map((t, i) => ({
          name: t.target,
          color: PALETTE[i % PALETTE.length],
          ms: byTarget[i] ?? 0,
        }));
        const topSum = segments.reduce((acc, s) => acc + s.ms, 0);
        const otherMs = Math.max(0, sourceTotal - topSum);
        if (otherMs > 0) {
          segments.push({ name: 'Other', color: OTHER_COLOR, ms: otherMs });
        }
        return { bucketStart: b.bucketStart, total: sourceTotal, segments };
      }),
    [buckets, kind, topTargets],
  );

  const maxMs = useMemo(() => {
    let m = 0;
    for (const r of rows) if (r.total > m) m = r.total;
    return m;
  }, [rows]);
  // Floor at 1 ms so the empty-state still renders zero-height bars (vs
  // dividing by zero). The track baselines below still render fine.
  const scaleDenom = Math.max(maxMs, 1);

  const xLabels = useMemo(() => pickAxisLabels(buckets, grain, timezone), [
    buckets,
    grain,
    timezone,
  ]);

  const [hover, setHover] = useState<HoverState | null>(null);
  const sectionTitle =
    grain === 'hour' ? 'Hourly breakdown' : 'Daily breakdown';

  return (
    <section
      aria-label={`${sectionTitle} — ${kind}`}
      className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <p className="text-[0.7rem] uppercase tracking-wider text-neutral-500">
          {sectionTitle} · {kind === 'apps' ? 'apps' : 'sites'}
        </p>
        <span className="text-[0.65rem] text-neutral-500">
          {kind === 'apps' ? 'desktop' : 'browser'}
        </span>
      </header>

      <div className="relative">
        <div
          className="flex h-40 items-end gap-1"
          role="img"
          aria-label={`${rows.length} ${grain}-grain ${kind} bars`}
          onMouseLeave={() => setHover(null)}
        >
          {rows.map((row, i) => (
            <Bar
              key={row.bucketStart}
              row={row}
              scaleDenom={scaleDenom}
              isHovered={hover?.bucketIndex === i}
              onEnter={() => setHover({ bucketIndex: i })}
            />
          ))}
        </div>

        {hover !== null && rows[hover.bucketIndex] && (
          <Tooltip
            row={rows[hover.bucketIndex]}
            bucketIndex={hover.bucketIndex}
            bucketCount={rows.length}
            grain={grain}
            timezone={timezone}
            kind={kind}
          />
        )}
      </div>

      {/* Sparse x-axis tick labels. */}
      <div className="mt-2 flex gap-1 text-[0.6rem] tabular-nums text-neutral-500">
        {buckets.map((b, i) => (
          <div key={b.bucketStart} className="flex-1 text-center">
            {xLabels[i] ?? <>&nbsp;</>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Bar (one bucket)
// ---------------------------------------------------------------------------

interface RowModel {
  bucketStart: string;
  total: number;
  segments: Array<{ name: string; color: string; ms: number }>;
}

interface BarProps {
  row: RowModel;
  scaleDenom: number;
  isHovered: boolean;
  onEnter: () => void;
}

function Bar({ row, scaleDenom, isHovered, onEnter }: BarProps) {
  const totalFrac = row.total / scaleDenom;
  const heightFrac =
    row.total > 0 && totalFrac < MIN_BAR_HEIGHT_FRAC ? MIN_BAR_HEIGHT_FRAC : totalFrac;

  return (
    <div
      className="group relative flex h-full flex-1 flex-col justify-end"
      onMouseEnter={onEnter}
    >
      {/* Empty-bucket baseline — keeps the slot visible at zero. */}
      {row.total === 0 && (
        <div
          className={`h-px w-full ${
            isHovered ? 'bg-neutral-600' : 'bg-neutral-800'
          }`}
        />
      )}
      {row.total > 0 && (
        <div
          className={`flex w-full flex-col-reverse overflow-hidden transition ${
            isHovered ? 'ring-1 ring-neutral-500' : ''
          }`}
          style={{ height: `${heightFrac * 100}%` }}
        >
          {/* Bottom → top: top-N targets in rank order, then Other on top.
              `flex-col-reverse` puts the first child at the bottom, so the
              stack reads "rank 1 at the bottom" naturally. */}
          {row.segments.map((s, i) =>
            s.ms === 0 ? null : (
              <div
                key={`${row.bucketStart}-${i}`}
                style={{
                  height: `${(s.ms / row.total) * 100}%`,
                  background: s.color,
                }}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Tooltip
// ---------------------------------------------------------------------------

interface TooltipProps {
  row: RowModel;
  bucketIndex: number;
  bucketCount: number;
  grain: ActivityBucketGrain;
  timezone: string;
  kind: 'apps' | 'sites';
}

function Tooltip({
  row,
  bucketIndex,
  bucketCount,
  grain,
  timezone,
  kind,
}: TooltipProps) {
  // Horizontal position: center the tooltip on the hovered bar. The bars
  // share equal width via flex-1, so `(index + 0.5) / count` lands on the
  // bar's centerline as a percentage of the chart width.
  const leftPct = ((bucketIndex + 0.5) / bucketCount) * 100;
  // Clamp the tooltip's horizontal anchor so it never overflows the chart
  // edges visibly. The `translateX(-50%)` below centers around the anchor;
  // the clamp keeps that center safely within the chart.
  const clampedLeftPct = Math.min(Math.max(leftPct, 14), 86);

  // Only show non-zero entries — a tooltip with five "0s · 0s · 0s" rows
  // is noisier than helpful.
  const visibleSegments = row.segments.filter((s) => s.ms > 0);

  return (
    <div
      className="pointer-events-none absolute bottom-full z-10 mb-2 w-[15rem] -translate-x-1/2 rounded-md border border-neutral-700 bg-neutral-900/95 p-3 text-xs shadow-lg backdrop-blur"
      style={{ left: `${clampedLeftPct}%` }}
      role="tooltip"
    >
      <p className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
        Total {kind}
      </p>
      <p className="mt-0.5 text-[0.65rem] text-neutral-400">
        {formatBucketRange(row.bucketStart, grain, timezone)}
      </p>
      <p className="mt-1 font-mono tabular-nums text-base font-semibold text-neutral-100">
        {formatDurationCompact(row.total)}
      </p>
      {visibleSegments.length > 0 && (
        <ul className="mt-2 space-y-1">
          {visibleSegments.map((s, i) => (
            <li
              key={`${row.bucketStart}-tt-${i}`}
              className="flex items-center gap-2"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: s.color }}
                aria-hidden
              />
              <span className="flex-1 truncate text-neutral-200" title={s.name}>
                {s.name}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-neutral-300">
                {formatDurationCompact(s.ms)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Axis label picking
// ---------------------------------------------------------------------------

/// Sparse axis labels: show every Nth bucket's tick. For 24 hourly bars we
/// show every 4th hour; for 7-day grain we show every day; for 30-day we
/// show every 5th day. Returns the same length as `buckets` with empty
/// slots interleaved.
function pickAxisLabels(
  buckets: ActivityBucket[],
  grain: ActivityBucketGrain,
  tz: string,
): Array<string | null> {
  const stride =
    buckets.length <= 8 ? 1 : buckets.length <= 14 ? 2 : buckets.length <= 24 ? 4 : 5;
  return buckets.map((b, i) =>
    i % stride === 0 ? formatTick(b.bucketStart, grain, tz) : null,
  );
}

function formatTick(iso: string, grain: ActivityBucketGrain, tz: string): string {
  const d = new Date(iso);
  if (grain === 'hour') {
    // 12h with explicit AM/PM, no minutes — keeps axis compact (e.g. "3 PM").
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      hour12: true,
      timeZone: tz,
    }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  }).format(d);
}

function formatBucketRange(
  iso: string,
  grain: ActivityBucketGrain,
  tz: string,
): string {
  const d = new Date(iso);
  if (grain === 'hour') {
    // Hour range: "Jun 18 · 3:00 – 4:00 PM"
    const end = new Date(d.getTime() + 60 * 60_000);
    const startStr = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: tz,
    }).format(d);
    const startHour = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    }).format(d);
    const endHour = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    }).format(end);
    return `${startStr} · ${startHour} – ${endHour}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  }).format(d);
}
