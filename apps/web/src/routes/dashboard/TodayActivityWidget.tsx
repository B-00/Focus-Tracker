import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  activityQueryKeys,
  fetchActivitySummary,
} from '../../lib/activity-api';
import { formatDuration } from '../../lib/format-duration';
import { TopTargetsList } from '../activity/TopTargetsList';

// Compact dashboard widget — "Today's activity" (Activity.md §4.2).
//
// Mirrors the page's data path (same query key, same 60s cadence) so
// having both the dashboard AND `/activity` open at once doesn't double
// the API load. TanStack Query coalesces the polls per key.

const POLL_INTERVAL_MS = 60_000;
const TOP_N = 3;

export function TodayActivityWidget() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: activityQueryKeys.summary('today'),
    queryFn: () => fetchActivitySummary('today'),
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          Today's activity
        </h2>
        <Link
          to="/activity"
          className="text-xs text-emerald-400 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          View all →
        </Link>
      </header>

      {isLoading && <p className="text-sm text-neutral-300">Loading…</p>}

      {isError && (
        <p className="text-sm text-red-300">
          {error instanceof Error ? error.message : 'Failed to load activity.'}
        </p>
      )}

      {data && (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[0.65rem] uppercase tracking-wider text-neutral-500">
              Active so far
            </p>
            <p className="font-mono text-2xl tabular-nums text-emerald-300">
              {formatDuration(data.totals.activeMs)}
            </p>
          </div>

          <MiniBar buckets={data.buckets} />

          {/* Top apps stacked over top sites, compact donut variant so the
              widget stays short. Same component as the /activity page. */}
          <div className="flex flex-col gap-3">
            <TopTargetsList
              title="Top apps"
              kind="apps"
              items={data.topApps}
              limit={TOP_N}
              variant="compact"
            />
            <TopTargetsList
              title="Top sites"
              kind="sites"
              items={data.topSites}
              limit={TOP_N}
              variant="compact"
            />
          </div>
        </div>
      )}
    </section>
  );
}

// Tiny no-axis silhouette of today's hourly buckets. Just the shape, no
// labels — the user can click through to `/activity` for the full view.
function MiniBar({
  buckets,
}: {
  buckets: { apps: number; sites: number }[];
}) {
  let maxMs = 0;
  for (const b of buckets) {
    const total = b.apps + b.sites;
    if (total > maxMs) maxMs = total;
  }
  const denom = Math.max(maxMs, 1);

  return (
    <div
      className="flex h-12 items-end gap-0.5"
      role="img"
      aria-label="Hourly activity silhouette"
    >
      {buckets.map((b, i) => {
        const total = b.apps + b.sites;
        const heightFrac = total / denom;
        const sitesShare = total === 0 ? 0 : b.sites / total;
        return (
          <div key={i} className="flex h-full flex-1 flex-col justify-end">
            {total === 0 ? (
              <div className="h-px w-full bg-neutral-800" />
            ) : (
              <div
                className="flex w-full flex-col-reverse"
                style={{ height: `${heightFrac * 100}%` }}
              >
                <div
                  className="bg-emerald-500/70"
                  style={{ height: `${(1 - sitesShare) * 100}%` }}
                />
                <div
                  className="bg-sky-500/70"
                  style={{ height: `${sitesShare * 100}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
