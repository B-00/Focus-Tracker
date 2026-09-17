# `apps/extension/src/background/` — Background event page

Co-located spec for the Firefox extension's background module.

Parent spec: `Sources Markdown/Extension.md` §5 (Architecture), §6 (Data captured), §10 (Privacy).

## Purpose

The background **event page** is the always-on observer that watches the browser's tab/window/idle APIs and converts them into a stream of `focus_change` events. Everything else in the extension (popup, options, pairing UI) is a UI surface that talks to this module via `browser.runtime` messages.

## Files

| File            | Responsibility                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `index.ts`      | Event-page entrypoint. Wires capture + heartbeat + session + flusher on every wake. Exposes `__ft_*` devtools helpers. |
| `capture.ts`    | Listener registration + transition logic. Emits `focus_change` events to the outbox on every meaningful transition. |
| `heartbeat.ts`  | `browser.alarms`-backed 30s keepalive that emits `heartbeat` events while a focus is in flight.                    |
| `session.ts`    | Session bookkeeping in `browser.storage.local`. Emits `session_start` / `session_end` with a 30-min gap heuristic.  |
| `state.ts`      | In-memory current-focus tracker (target + startedAt). Lives only within a wake cycle.                              |
| `flusher.ts`    | Browser wiring — `browser.alarms` (60s) → `runDrain()` with live IndexedDB / fetch / storage implementations.       |
| `drain.ts`      | Pure drain-loop orchestration behind a `FlushDeps` interface. No browser API touches — testable in plain Node.      |

The `capture.ts` transition path also writes to the daily rollup in `../storage/rollup.ts` on every `focus_change` close-out. That rollup is what the popup's Stats view reads, because the flusher deletes acked outbox events and an outbox scan would only see the last ~60s of browsing.

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

## Flusher

`flusher.ts` + `drain.ts` implement Extension.md §8 — every 60s, `browser.alarms` wakes the event page and `runDrain()` walks the outbox in 50-event chunks (`BATCH_SIZE`, matching `telemetryBatchSchema.events.max(50)`).

Per-batch outcome table (mirrors `apps/desktop/src-tauri/src/flusher.rs`):

| API response                          | Effect on outbox     | Effect on loop        | Effect on client         |
| ------------------------------------- | -------------------- | --------------------- | ------------------------ |
| 2xx `{acceptedCount, duplicateCount}` | delete acked batch   | continue to next chunk | log info                 |
| 5xx / network / timeout / parse       | leave intact         | exit, retry next tick | log warn                 |
| 401 / 403                             | leave intact         | exit                  | `forgetPairedDevice()` → popup drops to PairingView |
| 4xx (other)                           | delete anyway (v1 dead-letter) | continue      | log error loudly         |

Design notes:

- **Alarm-only trigger**, no queue-depth signal. Human-paced input + 60s buffering is invisible in practice; one code path is simpler. `ponytail:` if the outbox ever grows past ~1k events between ticks we'd add a poke-on-append signal like the desktop's `Notify`.
- `MAX_CHUNKS_PER_TICK = 20` caps runtime at ~1000 events per wake so a pathological outbox can't monopolise the event page.
- **No client-side NUL-byte stripping.** The API strips them in `TelemetryService.ingest()`, so the extension can send raw bodies and rely on the server-side sanitiser.
- **Idempotency** is free: outbox key = event ULID = API dedup key. A retry after a crash-between-upload-and-delete just returns `duplicateCount = N` on the next attempt.
- **Testability** is why the pure logic lives in `drain.ts` behind a `FlushDeps` interface. `flusher.check.ts` exercises all five branches (multi-chunk drain, transient, auth-rejected, permanent, unpaired) in plain Node with in-memory fakes — no IndexedDB, no fetch, no `browser.*`.

## Pause

Extension.md §10 pause toggle. Persisted in `browser.storage.local` as `preferences.paused` (see `../storage/preferences.ts`). Two consumers:

- `capture.ts` keeps an in-memory `paused` mirror kept fresh via `subscribePreferences`. `transitionTo` refuses to open a NEW focus while paused, but still allows the transition-to-null path so idle handling and the pause-boundary close-out both work. On the pause boundary itself the capture module fires `transitionTo(null)` to close the in-flight focus; on unpause it re-primes.
- `flusher.ts` calls `isPaused()` at the top of `flushAll()` and returns a `paused` summary without touching the API. The 60s alarm still ticks — cheaper than tearing it down and re-registering — but each tick is a no-op.

Combined effect: while paused nothing enters the outbox, nothing leaves it, the rollup doesn't advance, and the popup grays out with a `Resume` button.

## Reachability

Extension.md §17. `flusher.ts` writes `apiHealth` to `browser.storage.local` after every real batch upload — the outcome maps to `reachable: false` for `transient` (5xx/network/timeout) and `reachable: true` for anything the API actually answered (2xx/4xx/401). The popup reads it, and if the stored status is missing or > 5 minutes old, fires a cheap `HEAD /v1/health` probe on open so the reachability pill is never blank.

We deliberately do NOT run a HEAD probe on every event-page wake even though the spec suggests it — the event page wakes on every tab event, and piggybacking on the 60s flush gives a strictly stronger signal (full round-trip with auth) with no extra HTTP traffic.

## What's NOT here (yet)

- No error log surface in the UI. Flush failures currently only `console.{info,warn,error}` in the background page devtools. Permanent-reject events are dropped rather than moved to a dead-letter store (v1 behaviour).
- No queue-depth-triggered flush — see design notes above.
- No standalone Options page. Pause lives in the popup; API base URL is still storage-only (edit via devtools).

## Testing notes

Slice 2 is verified manually by:

1. `pnpm dev` from `apps/extension/` — `vite build --watch` (no Firefox launch).
2. In Firefox Developer Edition, load `apps/extension/dist/manifest.json` via `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** (see `README.md`).
3. Open the **Inspect** window on the Focus Tracker entry.
4. Browse for a minute or two: switch tabs, alt-tab to another app and back, lock the screen and unlock. `[focus-tracker] focus transition:` log lines still appear.
5. In the Inspect console, run `await __ft_dumpOutbox()` — a `console.table` prints the queued events. Expect a mix of `focus_change`, `heartbeat`, and `session_start`. `focus_change` rows have both `startedAt` and `endedAt`.
6. Optional: `await __ft_outboxCount()` returns the current count; `await __ft_clearOutbox()` wipes it (for a clean re-run).

Slice 4 verification adds:

7. Pair the extension via the popup (Slice 3) so `apiKey` is in `browser.storage.local`.
8. Browse for a minute or two so the outbox has ~10+ events.
9. In the background page console, run `await __ft_flushNow()`. It returns a `FlushSummary` and logs one `flush ok` line per chunk. `__ft_outboxCount()` should read 0 afterwards.
10. Cross-check on the web dashboard — the events should appear in the activity view for the paired Firefox device.
11. Kill the API (`docker compose stop api` or similar), run `__ft_flushNow()` again: summary comes back `transient`, outbox count is unchanged. Restart the API and the next 60s alarm tick drains it.

The pure drain logic has an assert-based self-check:

```
node --experimental-strip-types apps/extension/src/background/flusher.check.ts
```

Runs 5 in-memory scenarios (multi-chunk drain, transient, auth-rejected, permanent-reject, unpaired) and exits non-zero on any regression.
