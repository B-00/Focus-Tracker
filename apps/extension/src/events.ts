// Factory helpers that stamp every outgoing telemetry event with a fresh
// ULID + `source: 'browser'` + `clientVersion` from the manifest.
//
// Only the fields specific to the event kind vary; everything else is
// enforced here so we can never accidentally send an unstamped event.

import type { TelemetryEvent } from '@focus-tracker/shared';

import { ulid } from './id/ulid';

// Read the manifest version once per wake. `browser.runtime.getManifest()`
// is synchronous and returns a fresh object each call — cheap, but no reason
// to re-parse it on every event.
const CLIENT_VERSION: string = browser.runtime.getManifest().version;

/** Shared fields every event carries. */
function base(kind: TelemetryEvent['kind'], startedAt: Date): {
  id: string;
  kind: TelemetryEvent['kind'];
  source: 'browser';
  startedAt: string;
  clientVersion: string;
} {
  return {
    id: ulid(),
    kind,
    source: 'browser',
    startedAt: startedAt.toISOString(),
    clientVersion: CLIENT_VERSION,
  };
}

// ─── focus_change ───────────────────────────────────────────────────────────

export function createFocusChangeEvent(input: {
  domain: string;
  tabTitle: string | null;
  startedAt: Date;
  endedAt: Date;
}): TelemetryEvent {
  const durationMs = input.endedAt.getTime() - input.startedAt.getTime();
  return {
    ...base('focus_change', input.startedAt),
    target: {
      domain: input.domain,
      ...(input.tabTitle !== null ? { title: input.tabTitle } : {}),
    },
    endedAt: input.endedAt.toISOString(),
    // Negative durations can happen if the clock jumps backwards mid-event.
    // Clamp to 0 rather than emitting a nonsense value the server will reject.
    durationMs: Math.max(0, durationMs),
  };
}

// ─── heartbeat ──────────────────────────────────────────────────────────────

/**
 * Emitted every N seconds while a focus is in flight (Slice 2 uses 30s via
 * `browser.alarms`). Lets the server keep the current focus alive without
 * waiting for the eventual focus_change close-out — matters when a session
 * ends abruptly (browser crash, laptop lid) and the close-out never arrives.
 */
export function createHeartbeatEvent(input: {
  domain: string;
  tabTitle: string | null;
  at: Date;
}): TelemetryEvent {
  return {
    ...base('heartbeat', input.at),
    target: {
      domain: input.domain,
      ...(input.tabTitle !== null ? { title: input.tabTitle } : {}),
    },
  };
}

// ─── session_start / session_end ────────────────────────────────────────────

/**
 * Emitted once per event-page wake. The `sessionId` lives in
 * `browser.storage.local` so session_end can reference the same id when the
 * page suspends (or when a later wake finds a leftover session and closes
 * it out synthetically).
 */
export function createSessionStartEvent(input: {
  sessionId: string;
  at: Date;
}): TelemetryEvent {
  return {
    ...base('session_start', input.at),
    // The generated id above is this event's own id; sessionId identifies
    // the browsing session itself and matches the session_end that will
    // close it out later.
    target: { sessionId: input.sessionId },
  };
}

export function createSessionEndEvent(input: {
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
}): TelemetryEvent {
  const durationMs = input.endedAt.getTime() - input.startedAt.getTime();
  return {
    ...base('session_end', input.startedAt),
    target: { sessionId: input.sessionId },
    endedAt: input.endedAt.toISOString(),
    durationMs: Math.max(0, durationMs),
  };
}
