// Browser-session bookkeeping.
//
// A "session" here is one continuous stretch of browsing activity — NOT
// one wake of the event page. The MV3 event page wakes and sleeps
// constantly (~30s inactivity → sleep, any tab event → wake), so gating
// session_start on wake alone would produce dozens of sessions per real
// browsing spell.
//
// Rule: sessions live in `browser.storage.local` and PERSIST across
// suspend/wake. Every wake within SESSION_GAP_MS of `lastActivityAt`
// silently continues the same session — no wire events emitted. Every
// wake after that gap silently closes the old session (`session_end` at
// the recorded `lastActivityAt`) and opens a fresh one (`session_start`
// at now).
//
// We deliberately do NOT emit `session_end` on `runtime.onSuspend`:
// suspend fires every ~30s of idle, and emitting `session_end` there
// would fragment one real browsing spell into dozens of tiny bookended
// "sessions" — noise for any future session-count / session-duration
// metric. The tradeoff is that a clean browser shutdown never produces
// a client-side `session_end` for the last session; the server-side
// reconciliation (which the desktop client already relies on for crash
// recovery) closes it out from the last heartbeat.

import { createSessionEndEvent, createSessionStartEvent } from '../events';
import { ulid } from '../id/ulid';
import * as outbox from '../storage/outbox';

const KEY_SESSION_ID = 'sessionId';
const KEY_SESSION_STARTED_AT = 'sessionStartedAt';
const KEY_LAST_ACTIVITY_AT = 'lastActivityAt';

// If the extension hasn't seen activity for this long, we consider the
// previous session over and start a new one. 30 minutes matches how a
// user would intuitively describe "the same browsing session".
const SESSION_GAP_MS = 30 * 60 * 1000;

interface StoredSession {
  sessionId: string;
  startedAt: string; // ISO
  lastActivityAt: string; // ISO
}

/**
 * Kick off session tracking on every event-page wake. Handles both fresh
 * starts and stale-session cleanup transparently. No listeners to
 * register — the whole lifecycle is driven by the gap check below.
 */
export async function initSession(): Promise<void> {
  const now = new Date();
  const stored = await readStoredSession();

  if (stored === null) {
    await startNewSession(now);
    return;
  }

  const lastActivity = new Date(stored.lastActivityAt);
  const gap = now.getTime() - lastActivity.getTime();
  if (gap > SESSION_GAP_MS) {
    // Old session went stale (probably a crash or long AFK). Close it
    // out synthetically at the last activity we saw, then open a new one.
    void outbox
      .append(
        createSessionEndEvent({
          sessionId: stored.sessionId,
          startedAt: new Date(stored.startedAt),
          endedAt: lastActivity,
        }),
      )
      .catch((err: unknown) => {
        console.warn('[focus-tracker] stale session_end append failed', err);
      });
    await startNewSession(now);
    return;
  }

  // Session is still fresh — just update lastActivityAt so the next wake
  // sees a recent heartbeat.
  await touchSession(now);
}

/**
 * Mark that the session is still active. Called by capture/heartbeat on
 * every event so the gap check on next wake reflects reality.
 */
export async function touchSession(at: Date): Promise<void> {
  await browser.storage.local.set({ [KEY_LAST_ACTIVITY_AT]: at.toISOString() });
}

async function readStoredSession(): Promise<StoredSession | null> {
  const bag = await browser.storage.local.get([
    KEY_SESSION_ID,
    KEY_SESSION_STARTED_AT,
    KEY_LAST_ACTIVITY_AT,
  ]);
  const sessionId = bag[KEY_SESSION_ID];
  const startedAt = bag[KEY_SESSION_STARTED_AT];
  const lastActivityAt = bag[KEY_LAST_ACTIVITY_AT];
  if (
    typeof sessionId !== 'string' ||
    typeof startedAt !== 'string' ||
    typeof lastActivityAt !== 'string'
  ) {
    return null;
  }
  return { sessionId, startedAt, lastActivityAt };
}

async function startNewSession(at: Date): Promise<void> {
  const sessionId = ulid();
  await browser.storage.local.set({
    [KEY_SESSION_ID]: sessionId,
    [KEY_SESSION_STARTED_AT]: at.toISOString(),
    [KEY_LAST_ACTIVITY_AT]: at.toISOString(),
  });
  void outbox
    .append(createSessionStartEvent({ sessionId, at }))
    .catch((err: unknown) => {
      console.warn('[focus-tracker] session_start append failed', err);
    });
}

// (No `runtime.onSuspend` handler on purpose — see the top-of-file
// rationale about not fragmenting real browsing spells into per-wake
// bookend pairs.)
