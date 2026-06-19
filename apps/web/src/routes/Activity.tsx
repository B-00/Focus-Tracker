import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityRange } from '@focus-tracker/shared';
import {
  ACTIVITY_RECENT_DEFAULT_LIMIT,
} from '@focus-tracker/shared';
import {
  activityQueryKeys,
  fetchActivityRecent,
  fetchActivitySummary,
} from '../lib/activity-api';
import { HourlyBreakdown } from './activity/HourlyBreakdown';
import { RangeSelector } from './activity/RangeSelector';
import { RecentSwitches } from './activity/RecentSwitches';
import { SummaryBand } from './activity/SummaryBand';
import { TopTargetsList } from './activity/TopTargetsList';

// `/activity` page — the always-on telemetry viewer.
//
// Owner: Activity.md §4.1. Layout follows the ASCII mock in the spec:
// header → summary band → breakdown chart → top apps / top sites →
// recent switches.
//
// Polling: every 60s while the tab is visible. We pause the poll when
// the document is hidden so a backgrounded tab doesn't keep hitting the
// server. Manual refresh button bypasses the polling cadence.

const POLL_INTERVAL_MS = 60_000;

export function ActivityPage() {
  const qc = useQueryClient();
  const [range, setRange] = useState<ActivityRange>('today');
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );

  useEffect(() => {
    function onVisibility(): void {
      setTabVisible(document.visibilityState !== 'hidden');
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const summaryQuery = useQuery({
    queryKey: activityQueryKeys.summary(range),
    queryFn: () => fetchActivitySummary(range),
    refetchInterval: tabVisible ? POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: true,
  });

  const recentQuery = useQuery({
    queryKey: activityQueryKeys.recent(ACTIVITY_RECENT_DEFAULT_LIMIT),
    queryFn: () => fetchActivityRecent(ACTIVITY_RECENT_DEFAULT_LIMIT),
    refetchInterval: tabVisible ? POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: true,
  });

  const refreshing = summaryQuery.isFetching || recentQuery.isFetching;

  function handleRefresh(): void {
    void qc.invalidateQueries({ queryKey: activityQueryKeys.all });
  }

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-5 px-6 py-7">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-0.5 text-sm text-neutral-400">
            Always-on telemetry — what your devices have been doing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelector
            value={range}
            onChange={setRange}
            disabled={summaryQuery.isLoading}
          />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh activity"
            className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-neutral-200 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {summaryQuery.isError && (
        <ErrorBox
          title="Couldn't load activity summary."
          message={
            summaryQuery.error instanceof Error
              ? summaryQuery.error.message
              : 'Unknown error'
          }
        />
      )}

      {summaryQuery.data && (
        <>
          <SummaryBand summary={summaryQuery.data} />
          <HourlyBreakdown
            buckets={summaryQuery.data.buckets}
            grain={summaryQuery.data.range.bucketGrain}
            timezone={summaryQuery.data.range.timezone}
          />
          {/* Stacked: Top Apps over Top Sites. Each section has its own
              donut + ranked list (see TopTargetsList). */}
          <div className="flex flex-col gap-5">
            <TopTargetsList
              title="Top apps"
              kind="apps"
              items={summaryQuery.data.topApps}
            />
            <TopTargetsList
              title="Top sites"
              kind="sites"
              items={summaryQuery.data.topSites}
            />
          </div>
        </>
      )}

      {!summaryQuery.data && summaryQuery.isLoading && <SkeletonSummary />}

      <RecentSwitches
        events={recentQuery.data?.events ?? []}
        isLoading={recentQuery.isLoading}
      />

      <p className="text-[0.7rem] text-neutral-500">
        Want to hide something? Adjust the capture rules in the desktop app
        (or browser extension when it ships).
      </p>
    </main>
  );
}

function ErrorBox({ title, message }: { title: string; message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-900 bg-red-950/30 p-3 text-sm text-red-200"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-red-300/80">{message}</p>
    </div>
  );
}

function SkeletonSummary() {
  // Lightweight skeleton — three boxes that match the SummaryBand grid.
  // Avoids reserving space and then snapping when the data lands.
  return (
    <div className="grid grid-cols-3 gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-20 rounded bg-neutral-800" />
          <div className="h-7 w-16 rounded bg-neutral-800" />
        </div>
      ))}
    </div>
  );
}
