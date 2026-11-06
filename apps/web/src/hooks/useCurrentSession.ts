import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';
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

// ---------------------------------------------------------------------------
//  "Session just ended" latch — for auto-opening the post-session summary
// ---------------------------------------------------------------------------

/// Watches the current-session poll for a non-null → null transition and
/// fires `onEnded(endedSessionId)` once per transition. Used by the dashboard
/// widget and /focus page to pop the SessionSummaryModal (§8.4) the moment
/// the session completes — whether that completion was the user hitting
/// Stop or the scheduler firing timer_complete.
///
/// ponytail: component-local latch instead of a global pub/sub. Two mount
/// points (widget + /focus page) both call this, but the summary should
/// only open on the surface the user is currently on — not both. Keeping
/// the latch per-component lets each surface decide independently, and
/// React batching makes "both open the modal" impossible since the hook
/// mounts in only one of them at a time (the widget is only on /, the
/// page is only on /focus).
export function useSessionEnded(onEnded: (endedSessionId: string) => void): void {
  const prevIdRef = useRef<string | null>(null);
  const callbackRef = useRef(onEnded);
  callbackRef.current = onEnded;

  const { data } = useCurrentSession();
  const currentId = data?.session?.id ?? null;

  useEffect(() => {
    const prev = prevIdRef.current;
    if (prev !== null && currentId === null) {
      callbackRef.current(prev);
    }
    prevIdRef.current = currentId;
  }, [currentId]);
}
