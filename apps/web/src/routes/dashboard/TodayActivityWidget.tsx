import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  activityQueryKeys,
  fetchActivitySummary,
} from '../../lib/activity-api';
import { formatDuration } from '../../lib/format-duration';
import { TopTargetsList } from '../activity/TopTargetsList';
import { useWidgetCollapsed } from './widget-collapse';
import { WidgetCollapseToggle } from './WidgetCollapseToggle';
import { WidgetReorderControls } from './WidgetReorderControls';

// Compact dashboard widget — "Today's activity" (Activity.md §4.2).
//
// Mirrors the page's data path (same query key, same 60s cadence) so
// having both the dashboard AND `/activity` open at once doesn't double
// the API load. TanStack Query coalesces the polls per key.

const POLL_INTERVAL_MS = 60_000;
// Matches `/activity` page's default (ACTIVITY_TOP_N) so the dashboard
// and the deep-dive page agree on rank-N identity at a glance. Earlier
// spec called for 3 here to keep the widget glance-short; the visual
// symmetry won out.
const TOP_N = 5;
const BODY_ID = 'widget-today-activity-body';

export function TodayActivityWidget() {
  const collapsed = useWidgetCollapsed('today_activity');
  const { data, isLoading, isError, error } = useQuery({
    queryKey: activityQueryKeys.summary('today'),
    queryFn: () => fetchActivitySummary('today'),
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    enabled: !collapsed,
  });

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <header className={`flex items-baseline justify-between gap-3 ${collapsed ? '' : 'mb-4'}`}>
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Today's activity
          </h2>
          <WidgetReorderControls id="today_activity" />
          <WidgetCollapseToggle id="today_activity" controlsId={BODY_ID} />
        </div>
        <Link
          to="/activity"
          className="text-xs text-emerald-400 transition hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          View all →
        </Link>
      </header>

      {!collapsed && (
        <div id={BODY_ID}>
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

          {/* Top apps stacked over top sites, compact donut variant so the
              widget stays short. Same component as the /activity page. */}
          <div className="flex flex-col gap-3">
            <TopTargetsList
              title="Top apps"
              kind="apps"
              items={data.topApps}
              totalMsForKind={data.totals.apps}
              limit={TOP_N}
              variant="compact"
            />
            <TopTargetsList
              title="Top sites"
              kind="sites"
              items={data.topSites}
              totalMsForKind={data.totals.sites}
              limit={TOP_N}
              variant="compact"
            />
          </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

