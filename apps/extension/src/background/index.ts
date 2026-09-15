// Background event-page entry point for the Firefox extension.
//
// Firefox MV3 loads this file as a non-persistent ES module (see
// `manifest.json` → `background.scripts` + `type: "module"`). The page is
// woken on any registered event and suspended after periods of inactivity.
// State that must survive a suspend cycle lives in IndexedDB or
// `browser.storage.local` — anything in module scope here will not.
//
// Slice 2 (this file): initialize capture + heartbeat + session tracking,
// each of which writes durably to the IndexedDB outbox. Also exposes a
// couple of devtools helpers on `globalThis` so we can eyeball outbox
// state from the about:debugging → Inspect console before the popup
// (Slice 3) exists.
//
// Spec: ../../../Sources Markdown/Extension.md §5, §6.

import * as outbox from '../storage/outbox';

import { initCapture } from './capture';
import { initHeartbeat } from './heartbeat';
import { initSession } from './session';

console.log('[focus-tracker] background event page waking');

initCapture();
initHeartbeat();
void initSession().catch((err: unknown) => {
  console.warn('[focus-tracker] initSession failed', err);
});

// ─── devtools helpers ───────────────────────────────────────────────────────
// Reachable from the background page console (about:debugging → Inspect).
// Deliberately named with `__ft_` so they don't collide with anything real
// and are easy to grep for when removing them post-Slice-3.
// ponytail: no popup yet — these are the eyeball tool until the popup lands.
declare global {
  interface Window {
    __ft_dumpOutbox?: () => Promise<void>;
    __ft_clearOutbox?: () => Promise<void>;
    __ft_outboxCount?: () => Promise<number>;
  }
}
(globalThis as unknown as Window).__ft_dumpOutbox = async () => {
  const events = await outbox.listAll();
  console.table(
    events.map((e) => ({
      id: e.id,
      kind: e.kind,
      target: JSON.stringify(e.target),
      startedAt: e.startedAt,
      endedAt: e.endedAt ?? '',
      durationMs: e.durationMs ?? '',
    })),
  );
  console.log(`[focus-tracker] outbox has ${events.length} event(s)`);
};
(globalThis as unknown as Window).__ft_outboxCount = () => outbox.count();
(globalThis as unknown as Window).__ft_clearOutbox = async () => {
  await outbox.clear();
  console.log('[focus-tracker] outbox cleared');
};
