import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import {
  fetchCurrentSession,
  focusSessionsQueryKeys,
} from '../lib/focus-sessions-api';

// Shared poll + live-tick primitives for every surface that shows an
// active focus session (dashboard widget, /focus route, slice-3 sticky bar).
//
// Two independent concerns intentionally co-located here:
//   1. `useCurrentSession()` — 5s poll of GET /v1/focus-sessions/current
//      (FocusSession.md §9.6). Every mount that uses the same query key
//      shares the request thanks to TanStack Query, so mounting the widget
//      and the sticky bar at once is still one network call per 5s.
//   2. `useNowMs()` — module-level 1Hz ticker. The elapsed/remaining readout
//      ticks every second; a shared setInterval drives all subscribers so
//      N widgets don't each spin up their own timer.
//
// ponytail: visibility pausing comes free from react-query's default
// `refetchIntervalInBackground: false`; no visibilitychange listener needed.

// ---------------------------------------------------------------------------
//  /current poll
// ---------------------------------------------------------------------------

const CURRENT_POLL_MS = 5_000;

export function useCurrentSession() {
  return useQuery({
    queryKey: focusSessionsQueryKeys.current(),
    queryFn: fetchCurrentSession,
    refetchInterval: CURRENT_POLL_MS,
    // `refetchIntervalInBackground: false` is the default — polling stops
    // when the tab is hidden. Explicit here to make the §9.6 behavior
    // obvious to future maintainers.
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------------
//  Shared 1Hz "now" clock
// ---------------------------------------------------------------------------

let currentNowMs = Date.now();
const nowListeners = new Set<() => void>();
let nowTimer: ReturnType<typeof setInterval> | null = null;

function startNowTimerIfNeeded() {
  if (nowTimer !== null) return;
  nowTimer = setInterval(() => {
    currentNowMs = Date.now();
    for (const l of nowListeners) l();
  }, 1_000);
}

function stopNowTimerIfIdle() {
  if (nowTimer !== null && nowListeners.size === 0) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
}

function subscribeNow(cb: () => void): () => void {
  nowListeners.add(cb);
  startNowTimerIfNeeded();
  return () => {
    nowListeners.delete(cb);
    stopNowTimerIfIdle();
  };
}

function getNowSnapshot(): number {
  return currentNowMs;
}

/// Re-renders the calling component once per second with the current wall-
/// clock ms. Zero dependency between callers; one shared interval.
export function useNowMs(): number {
  return useSyncExternalStore(subscribeNow, getNowSnapshot, getNowSnapshot);
}
