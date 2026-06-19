import type {
  ActivityBucket,
  ActivityBucketGrain,
} from '@focus-tracker/shared';
import { formatDurationCompact } from '../../lib/format-duration';

// Hand-rolled stacked-bar chart for the "Hourly breakdown" (or daily, on
// 7d / 30d ranges). Hand-rolled because:
//   1. Recharts ~50 KB for a single static stacked bar isn't worth it.
//   2. Tooltip + axis + accessibility are all easier when we own the DOM.
//
// Two stacked segments per bucket: apps (emerald) on the bottom, sites
// (sky) on top. Empty buckets render as a thin baseline line so the user
// can see the slot exists.
//
// Owner: Activity.md §4.1 ("HOURLY BREAKDOWN" panel), §7 (accessibility).

interface HourlyBreakdownProps {
  buckets: ActivityBucket[];
  grain: ActivityBucketGrain;
  timezone: string;
}

const MIN_BAR_HEIGHT_FRAC = 0.02; // 2% — keep tiny non-zero buckets visible.

export function HourlyBreakdown({ buckets, grain, timezone }: HourlyBreakdownProps) {
  // Single scan for the max so we don't allocate.
  let maxMs = 0;
  for (const b of buckets) {
    const total = b.apps + b.sites;
    if (total > maxMs) maxMs = total;
  }
  // Floor at 1ms to avoid a divide-by-zero when every bucket is empty —
  // the bars will still render at zero height in that case.
  const scaleDenom = Math.max(maxMs, 1);

  const xLabels = pickAxisLabels(buckets, grain, timezone);

  return (
    <section
      aria-label={grain === 'hour' ? 'Hourly breakdown' : 'Daily breakdown'}
      className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <p className="text-[0.7rem] uppercase tracking-wider text-neutral-500">
          {grain === 'hour' ? 'Hourly breakdown' : 'Daily breakdown'}
        </p>
        <Legend />
      </header>

      <div
        className="flex h-40 items-end gap-1"
        role="img"
        aria-label={`${buckets.length} ${grain}-grain activity bars`}
      >
        {buckets.map((b) => (
          <Bar
            key={b.bucketStart}
            bucket={b}
            grain={grain}
            timezone={timezone}
            scaleDenom={scaleDenom}
          />
        ))}
      </div>

      {/* X-axis tick labels — sparse so they don't crowd at 30 buckets. */}
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

interface BarProps {
  bucket: ActivityBucket;
  grain: ActivityBucketGrain;
  timezone: string;
  scaleDenom: number;
}

function Bar({ bucket, grain, timezone, scaleDenom }: BarProps) {
  const total = bucket.apps + bucket.sites;
  const appsFrac = bucket.apps / scaleDenom;
  const sitesFrac = bucket.sites / scaleDenom;
  // Floor non-zero fractions so they're never rendered as 0 px. Lets the
  // user see "something happened in this hour" even if it was 30 seconds.
  const safeAppsFrac =
    bucket.apps > 0 && appsFrac < MIN_BAR_HEIGHT_FRAC ? MIN_BAR_HEIGHT_FRAC : appsFrac;
  const safeSitesFrac =
    bucket.sites > 0 && sitesFrac < MIN_BAR_HEIGHT_FRAC ? MIN_BAR_HEIGHT_FRAC : sitesFrac;

  const title = total === 0
    ? `${formatBucketStart(bucket.bucketStart, grain, timezone)} · idle`
    : `${formatBucketStart(bucket.bucketStart, grain, timezone)}\nApps: ${formatDurationCompact(bucket.apps)}\nSites: ${formatDurationCompact(bucket.sites)}`;

  return (
    <div className="group relative flex h-full flex-1 flex-col justify-end" title={title}>
      {/* Empty-bucket baseline so the slot is always visible. */}
      {total === 0 && (
        <div className="h-px w-full bg-neutral-800 group-hover:bg-neutral-700" />
      )}
      {bucket.sites > 0 && (
        <div
          className="w-full bg-sky-600/80 group-hover:bg-sky-500"
          style={{ height: `${safeSitesFrac * 100}%` }}
        />
      )}
      {bucket.apps > 0 && (
        <div
          className="w-full bg-emerald-600/80 group-hover:bg-emerald-500"
          style={{ height: `${safeAppsFrac * 100}%` }}
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[0.65rem] text-neutral-400">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm bg-emerald-500" /> apps
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm bg-sky-500" /> sites
      </span>
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

function formatBucketStart(iso: string, grain: ActivityBucketGrain, tz: string): string {
  const d = new Date(iso);
  if (grain === 'hour') {
    // Hover tooltip: full date + 12h time with AM/PM (e.g. "Jun 18, 10:00 PM").
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  }).format(d);
}
