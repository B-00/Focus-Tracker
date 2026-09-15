// Periodic "still here, still on X" heartbeat.
//
// When the user parks on a single tab for hours, no `tabs.*` events fire,
// so no focus_change would be emitted until they eventually navigate away.
// If Firefox crashes mid-park, the API would think the focus_change never
// happened. The heartbeat is a keepalive that lets the server extend the
// current focus without waiting for the eventual close-out.
//
// We use `browser.alarms` instead of `setInterval` because the MV3 event
// page can suspend, and only alarms survive suspension — the browser wakes
// us back up to service each tick.

import { createHeartbeatEvent } from '../events';
import * as outbox from '../storage/outbox';

import { touchSession } from './session';
import { getCurrentFocus } from './state';

const ALARM_NAME = 'focus-tracker-heartbeat';
const PERIOD_MINUTES = 0.5; // 30s — matches the design in Extension.md §6.3.

export function initHeartbeat(): void {
  // Register a listener BEFORE creating/replacing the alarm so we never
  // miss the first tick (browser.alarms fires only after both exist).
  if (!browser.alarms.onAlarm.hasListener(handleAlarm)) {
    browser.alarms.onAlarm.addListener(handleAlarm);
  }
  // `create` with an existing name overwrites cleanly — safe to call on
  // every wake without a preflight check. The first tick fires after
  // `periodInMinutes`, not immediately.
  browser.alarms.create(ALARM_NAME, { periodInMinutes: PERIOD_MINUTES });
}

function handleAlarm(alarm: browser.alarms.Alarm): void {
  if (alarm.name !== ALARM_NAME) return;

  const current = getCurrentFocus();
  if (current === null) {
    // No focus in flight → nothing to heartbeat. This happens when the
    // browser is defocused or the user is idle.
    return;
  }

  const now = new Date();
  const event = createHeartbeatEvent({
    domain: current.target.domain,
    tabTitle: current.target.tabTitle,
    at: now,
  });
  void outbox.append(event).catch((err: unknown) => {
    console.warn('[focus-tracker] heartbeat append failed', err);
  });
  void touchSession(now).catch((err: unknown) => {
    console.warn('[focus-tracker] touchSession failed', err);
  });
}
