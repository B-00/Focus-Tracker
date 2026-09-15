# `apps/extension/src/background/` — Background event page

Co-located spec for the Firefox extension's background module.

Parent spec: `Sources Markdown/Extension.md` §5 (Architecture), §6 (Data captured), §10 (Privacy).

## Purpose

The background **event page** is the always-on observer that watches the browser's tab/window/idle APIs and converts them into a stream of `focus_change` events. Everything else in the extension (popup, options, pairing UI) is a UI surface that talks to this module via `browser.runtime` messages.

## Files

| File            | Responsibility                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `index.ts`      | Event-page entrypoint. Wires capture + heartbeat + session on every wake. Exposes `__ft_dumpOutbox()` for devtools. |
| `capture.ts`    | Listener registration + transition logic. Emits `focus_change` events to the outbox on every meaningful transition. |
| `heartbeat.ts`  | `browser.alarms`-backed 30s keepalive that emits `heartbeat` events while a focus is in flight.                    |
| `session.ts`    | Session bookkeeping in `browser.storage.local`. Emits `session_start` / `session_end` with a 30-min gap heuristic.  |
| `state.ts`      | In-memory current-focus tracker (target + startedAt). Lives only within a wake cycle.                              |

## Lifecycle

Firefox MV3 unloads the event page after periods of inactivity. State that must survive a sleep cycle lives in IndexedDB or `browser.storage.local`. There is no in-process cache that survives suspension.

On every wake:

1. `index.ts` top-level executes → `initCapture()` registers the listeners. Idempotent because the browser unregisters them when the page is unloaded.
2. `primeCurrentFocus()` queries `windows.getLastFocused` to figure out where the user is *right now* (we missed the events that put them there).
3. Listeners take over; the in-memory `currentFocus` evolves with each transition.

## Capture sources (priority order)

| Source                                       | Meaning                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `windows.onFocusChanged(WINDOW_ID_NONE)`     | Browser lost OS focus → user switched to another app entirely. Close out the in-flight event.                    |
| `windows.onFocusChanged(<id>)`               | A different browser window came forward. Resolve its active tab; transition.                                    |
| `tabs.onActivated`                           | User switched tabs inside the focused window. Transition to the new tab's domain.                                |
| `tabs.onUpdated` (url change or status=complete) | The active tab navigated. Transition to the new URL's domain.                                                |
| `idle.onStateChanged(idle | locked)`         | User AFK for ≥ 60s OR locked the screen. Close out the in-flight event. Idle is **internal-only**, no wire event. |
| `idle.onStateChanged(active)`                | User returned. Re-prime focus from `windows.getLastFocused`.                                                     |

## Privacy hard rules

- Incognito / private windows: `tab.incognito === true` → drop on the floor, never emit.
- Non-HTTP schemes: `about:`, `moz-extension:`, `file:`, `javascript:`, `data:` → drop. The desktop client tracks Firefox the application; internal browser surfaces would double-count there.

## Session semantics

A **session** here is one continuous stretch of browsing activity, NOT one wake of the event page. The event page wakes and sleeps constantly (~30s inactivity → sleep, any tab event → wake), so gating `session_start` on wake alone would produce dozens of sessions per real browsing spell.

Rule:

- Sessions live in `browser.storage.local` and persist across event-page suspend/wake.
- Every wake, `initSession()` inspects `lastActivityAt`. If it's more than **30 minutes** in the past, the previous session is closed out (`session_end` at `lastActivityAt`) and a fresh one begins. Otherwise the same session continues silently — no wire events emitted.
- Every `focus_change` and every heartbeat calls `touchSession()` to refresh `lastActivityAt`.
- **No `runtime.onSuspend` handler.** Emitting `session_end` on suspend would fragment one browsing spell into dozens of tiny bookended sessions (suspend fires every ~30s of idle). If the browser is closed cleanly or crashes, the last session simply never gets a client-side `session_end`; server-side reconciliation from the last heartbeat closes it out. The desktop client already relies on this same pattern.

## What's NOT here (yet)

- IndexedDB outbox HAS events flowing into it (see `../storage/outbox.ts`), but **no flusher** yet — the outbox grows unbounded until Slice 4 lands and POSTs batches to `/v1/telemetry/batch`.
- No popup / options UI (Slice 3+).
- No error surface — outbox write failures currently only `console.warn` in the background page devtools.

## Testing notes

Slice 2 is verified manually by:

1. `pnpm dev` from `apps/extension/` — `vite build --watch` (no Firefox launch).
2. In Firefox Developer Edition, load `apps/extension/dist/manifest.json` via `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** (see `README.md`).
3. Open the **Inspect** window on the Focus Tracker entry.
4. Browse for a minute or two: switch tabs, alt-tab to another app and back, lock the screen and unlock. `[focus-tracker] focus transition:` log lines still appear.
5. In the Inspect console, run `await __ft_dumpOutbox()` — a `console.table` prints the queued events. Expect a mix of `focus_change`, `heartbeat`, and `session_start`. `focus_change` rows have both `startedAt` and `endedAt`.
6. Optional: `await __ft_outboxCount()` returns the current count; `await __ft_clearOutbox()` wipes it (for a clean re-run).

No unit tests — the meaningful logic is Firefox API plumbing + IndexedDB, both of which are painful to fake and cheap to verify by inspection.
