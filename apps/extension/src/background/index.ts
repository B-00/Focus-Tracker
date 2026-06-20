// Background event-page entry point for the Firefox extension.
//
// Firefox MV3 loads this file as a non-persistent ES module (see
// `manifest.json` → `background.scripts` + `type: "module"`). The page is
// woken on any registered event and suspended after periods of inactivity.
// State that must survive a suspend cycle lives in IndexedDB or
// `browser.storage.local` — anything in module scope here will not.
//
// Slice 1 (this file): wire up the capture listeners and log every focus
// transition to the browser console so we can verify the dev loop works
// end-to-end. No outbox, no networking, no popup yet.
//
// Spec: ../../../Sources Markdown/Extension.md §5, §6.

import { initCapture } from './capture';

// `console.log` in an event page goes to the per-extension devtools
// console reachable from about:debugging → "Inspect" on this extension.
console.log('[focus-tracker] background event page waking');

initCapture();

// `runtime.onSuspend` fires when Firefox is about to unload the event
// page. Best-effort logging — Firefox doesn't guarantee anything async
// completes after this fires, so don't do real work here in slice 1.
browser.runtime.onSuspend.addListener(() => {
  console.log('[focus-tracker] background event page suspending');
});
