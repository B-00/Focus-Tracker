// Background telemetry flusher — concrete browser wiring.
//
// Spec: Extension.md §8 (mirrors the desktop flusher — apps/desktop/
// src-tauri/src/flusher.rs).
//
// The interesting orchestration lives in `drain.ts` behind a `FlushDeps`
// interface so it can be unit-tested in plain Node. This file is just
// the plumbing that hands live IndexedDB / fetch / storage.local
// implementations to `runDrain` on every alarm tick.
//
// Design notes:
//   * Alarm-only trigger — no queue-depth signal. The extension is a
//     personal tool with human-paced input; 60s buffering is invisible.
//     ponytail: if the outbox ever grows past ~1k events between ticks
//     we'd add a poke-on-append signal like the desktop's `Notify`.
//   * MV3 event-page suspension is safe: `browser.alarms` fires wake
//     the page back up, and `dbPromise` in outbox.ts re-opens the DB
//     on each cold start.

import { uploadBatch } from '../api/telemetry';
import { forgetPairedDevice, getPairedDevice } from '../storage/device';
import * as outbox from '../storage/outbox';
import { runDrain, type FlushSummary } from './drain';

const ALARM_NAME = 'ft-flush';
const PERIOD_MINUTES = 1;

export function initFlusher(): void {
  if (!browser.alarms.onAlarm.hasListener(handleAlarm)) {
    browser.alarms.onAlarm.addListener(handleAlarm);
  }
  browser.alarms.create(ALARM_NAME, { periodInMinutes: PERIOD_MINUTES });
}

function handleAlarm(alarm: browser.alarms.Alarm): void {
  if (alarm.name !== ALARM_NAME) return;
  void flushAll().catch((err: unknown) => {
    console.warn('[focus-tracker] flush loop crashed', err);
  });
}

/** Devtools + boot-time entry point. Uses live IndexedDB / fetch / storage. */
export async function flushAll(): Promise<FlushSummary> {
  return runDrain({
    getPaired: async () => {
      const paired = await getPairedDevice();
      if (paired === null) return null;
      return { deviceId: paired.deviceId, apiKey: paired.apiKey };
    },
    getBatch: (n) => outbox.getBatch(n),
    removeMany: (ids) => outbox.removeMany(ids),
    upload: (batch, apiKey) => uploadBatch(batch, apiKey),
    onAuthRejected: () => forgetPairedDevice(),
    log: console,
  });
}
