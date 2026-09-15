# `apps/extension/src/background/` — Background event page

Co-located spec for the Firefox extension's background module.

Parent spec: `Sources Markdown/Extension.md` §5 (Architecture), §6 (Data captured), §10 (Privacy).

## Purpose

The background **event page** is the always-on observer that watches the browser's tab/window/idle APIs and converts them into a stream of `focus_change` events. Everything else in the extension (popup, options, pairing UI) is a UI surface that talks to this module via `browser.runtime` messages.

## Files

| File         | Responsibility                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `index.ts`   | Event-page entrypoint. Wires `initCapture()` on every wake.                                             |
| `capture.ts` | Listener registration + transition logic. Translates raw `tabs.*` / `windows.*` / `idle.*` events into focus transitions. |
| `state.ts`   | In-memory current-focus tracker. Lives only within a wake cycle.                                        |

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

## What's NOT here (yet)

This module currently only **logs** transitions. Slice 2 will:

- Stamp each transition with a ULID + `startedAt` / `endedAt` / `durationMs`.
- Append to the IndexedDB outbox (`outbox.ts`).
- Emit `heartbeat` events on the alarm interval.
- Emit `session_start` on every wake, `session_end` on `runtime.onSuspend`.

## Testing notes

Slice 1 is verified manually by:

1. `pnpm dev` from `apps/extension/` — starts `vite build --watch` (no Firefox launch).
2. In an already-open Firefox Developer Edition, load `apps/extension/dist/manifest.json` once via `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** (see `README.md` for the reload cycle).
3. Open the **Inspect** window for the Focus Tracker entry to reach the background event page's devtools console.
4. Switch between tabs/windows; observe `[focus-tracker] focus transition:` log lines.
5. Lock the screen; verify the next log line is `→ (none)` after the 60s idle threshold.

No unit tests in slice 1 — the logic is almost entirely Firefox API plumbing, and the integration test (steps 1–5 above) covers the meaningful behavior cheaply.
