# Focus Tracker — Focus Session (Feature Spec)

> A user-controlled time window that, while active, **labels** events in the always-on telemetry stream from the browser extension and desktop app (see `PROJECT.md` §12) with this session's id.
> Sessions are either **timer-bound** (set a duration, auto-stops) or **open-ended** (start/stop manually). Pause/resume is supported; each pause is logged as an interruption marker on the session timeline.

**Status:** Specification in progress. v1 first batch (see `PROJECT.md` §6).

---

## 1. Overview

A Focus Session is a labeled, server-anchored time window. The user starts a session from the dashboard or `/focus` route; while the session is "running," any telemetry event ingested whose `startedAt` falls inside the session's effective time window (excluding paused intervals) is stamped with the session's `id`. When the session ends, the user gets a summary view of what their attention actually went to during that time.

**Important: telemetry is always on; sessions are just a label.** The browser extension and desktop app send telemetry events continuously regardless of session state (see `Sources Markdown/Extension.md` and `Sources Markdown/DesktopApp.md`). Those events land in the raw `TelemetryEvent` table whether a session is active or not. A Focus Session does **not** gate ingest, start telemetry, or stop it — it is purely a server-side correlation view: at ingest time, the server stamps `focusSessionId` on the row if the event's `startedAt` falls inside an active session's effective window, otherwise leaves it `null`. Events with `focusSessionId = null` are still useful — the `Activity.md` viewer reads them directly to show the user's always-on activity.

Only **one** session can be active at a time. Sessions are persisted server-side, so closing the browser, switching machines, or restarting the laptop does not end an active session — it'll still be running when you come back.

Sessions are intentionally **minimal-config** in v1: just a mode, an optional duration, and an optional task link. No intent prompt, no quality rating, no notes. The data the session yields comes from the telemetry it consumes, not from manual input.

---

## 2. Goals & Non-Goals

### Goals
- Zero-friction start: hit "Start" → you're in a session.
- Honest accounting: the session reflects what you actually did (via telemetry), not what you said you'd do.
- Server-side source of truth so sessions survive client restarts.
- Pause/resume is real — paused time does not count toward session duration or attract telemetry.
- Post-session summary makes the data legible without leaving the page.

### Non-Goals (v1)
- Intent prompt at start ("what are you working on?") — explicitly skipped per the **minimal** decision.
- Quality rating (1–5 stars) at end — same.
- Free-text post-session notes — same.
- Scheduled / planned sessions (block 10:00–11:00 in advance, get a reminder).
- Multiple concurrent sessions.
- Session templates / presets (saved durations or task links).
- Pomodoro-style auto-cycling (work / break / work / break loops).
- Quality scoring / focus score derived from telemetry on the client. Any scoring lives server-side as a future analytics layer.

---

## 3. Concepts

### 3.1 Focus Session

The session entity itself. Lifecycle states drive both UI and telemetry correlation.

| Field                  | Type                                                  | Notes                                                                              |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | uuid                                                  | Primary key                                                                        |
| `userId`               | uuid                                                  | FK → User                                                                          |
| `taskId`               | uuid?                                                 | Optional FK → Task. Pure attribution; sessions and tasks are otherwise independent. |
| `mode`                 | enum `'timer' \| 'open'`                              | Picked at start; immutable                                                          |
| `plannedDurationMs`    | int?                                                  | Required when `mode = 'timer'`, null when `mode = 'open'`                          |
| `state`                | enum `'running' \| 'paused' \| 'completed' \| 'aborted'` | Server-driven. See §4 state machine                                            |
| `startedAt`            | timestamptz                                           | When the session first began                                                       |
| `endedAt`              | timestamptz?                                          | Set when state → `completed` or `aborted`                                          |
| `effectiveDurationMs`  | int?                                                  | Final attribution window: `(endedAt - startedAt) - Σ pauses`. Computed on end.     |
| `endReason`            | enum `'timer_complete' \| 'manual_stop' \| 'aborted'`? | Why the session ended. Null while running.                                        |
| `createdAt`            | timestamptz                                           |                                                                                    |
| `updatedAt`            | timestamptz                                           |                                                                                    |

Constraint: **at most one** session per user with `state IN ('running', 'paused')` at any time. Enforced via a partial unique index on `(userId)` where `state IN ('running', 'paused')`.

### 3.2 FocusSessionPause

Each pause within a session is its own row, so the session's effective window (and the post-session interruption timeline) is reconstructable.

| Field        | Type                                | Notes                                       |
| ------------ | ----------------------------------- | ------------------------------------------- |
| `id`         | uuid                                |                                             |
| `sessionId`  | uuid                                | FK → FocusSession                           |
| `pausedAt`   | timestamptz                         | When the pause began                        |
| `resumedAt`  | timestamptz?                        | Null while still paused; set on Resume      |
| `durationMs` | int?                                | `resumedAt - pausedAt`. Computed on resume. |
<!-- `trigger` column removed for v1 — every pause is user-initiated. Re-add if auto-pause-on-idle ships in a future version. -->

When a session ends while paused, `resumedAt` is set to the session's `endedAt` so the math stays clean.

---

## 4. State Machine

```
                       ┌───────────────────────────────┐
                       │ no active session             │
                       └────────────┬──────────────────┘
                                    │ user hits Start
                                    │ (picks mode, optional task)
                                    ▼
              ┌────────────────────────────┐
       ┌──────│           running          │──────┐
       │      └────────────┬───────────────┘      │
       │ user hits Pause   │                      │ timer elapsed (mode=timer)
       ▼                   │                      │   OR user hits Stop
┌─────────────┐            │                      ▼
│   paused    │────────────┘             ┌────────────────┐
└──────┬──────┘  user hits Resume        │   completed    │
       │                                  └────────────────┘
       │ user hits Stop while paused
       ▼
 (transitions to completed; endReason = 'manual_stop')
```

- **Only one session at a time.** Attempting to start a new session while one is `running` / `paused` returns `409 Conflict`.
- **`aborted`** state is reserved for cases where the server force-ends a stuck session (e.g. left running for > 24h with no client check-in) — see §9.
- All transitions are server-driven via API calls; the client never persists state alone.

---

## 5. Time accounting

- **Wall-clock duration**: `endedAt - startedAt`. Includes all paused intervals.
- **Effective duration**: `(endedAt - startedAt) - Σ FocusSessionPause.durationMs`. This is the number reported as "session length" and used for Memento Mori weekly focus-minutes shading (see `MementoMori.md` §4.2).
- For an in-progress session, both numbers are computed live on the client from `startedAt` + the running pause clock; the server only persists the canonical values on each state change.

---

<!-- §6 (Auto-pause on idle) intentionally removed for v1. Every pause is user-triggered. The `FocusSessionPause` row has no `trigger` column. Idle is not a wire-protocol event in v1 either (see PROJECT.md §12.4); source clients handle idle internally to bound focus_change endedAt. Section numbers below preserved to avoid cross-reference churn. -->

## 7. Telemetry correlation

**Telemetry ingest is always on; this section describes the *labeling* that runs on top of every event.** Sessions never gate ingest — they only add a non-null `focusSessionId` to events that happen to fall inside an active session's effective window. Events that fall outside any session window are ingested unchanged with `focusSessionId = null` and remain queryable for the Activity viewer (`Activity.md`) and other always-on consumers.

Per `PROJECT.md` §12.5, the server stamps `focusSessionId` on every incoming `TelemetryEvent` at ingest time. The rule for stamping is:

```
event.focusSessionId = id of the user's session S where
  S.startedAt <= event.startedAt < S.endedAt
  AND event.startedAt is NOT inside any pause window of S
  AND S.state IN ('running', 'paused', 'completed')

  ELSE event.focusSessionId = null    (event still ingested, just not attributed)
```

Notes:
- A session that is currently `running` will retroactively claim events that arrive late (e.g. an extension that was offline for 20 minutes and finally flushed).
- Events that fall inside a `paused` window are **not** attributed to the session. They are still ingested and live in the raw events table; they just have a `null` `focusSessionId`.
- Events with `endedAt` straddling a session boundary or a pause boundary are attributed by their `startedAt` — no split / clip logic in v1.
- A session that ends does NOT re-stamp historical events whose `focusSessionId` was set to a different (or null) value. Past attributions stand.
- Events that were ingested with `focusSessionId = null` during a window that **later** gets covered by a backdated session (not a v1 scenario, but worth noting) would not be retroactively stamped either — past attributions stand.

This means the post-session summary (see §8.4) can be built by a simple query: `WHERE focusSessionId = :id`.
The Activity viewer's queries (`Activity.md`) are equally simple: `WHERE userId = :id AND startedAt BETWEEN :from AND :to` — they don't care about `focusSessionId` at all.

---

## 8. Surfaces

### 8.1 Dashboard widget

The home dashboard at `/` (see `PROJECT.md` §8) shows a **Focus Session** widget with one of two states:

**No active session:**
- Big "Start Session" button.
- Mode toggle: `Timer` / `Open`.
- If `Timer`: a duration picker (presets: 25m / 50m / 90m, plus a "custom" input).
- Optional task picker (dropdown of incomplete tasks, searchable).
- Hitting Start creates the session and transitions the widget to the active state. If a session is already active in this user's account, the concurrent-session flow in §9.1 kicks in instead.

**Active session (running or paused):**
- Big elapsed-time readout, ticking once per second.
- If `Timer`: shows remaining time too, and a progress bar.
- Current target line (latest telemetry event's target — e.g. "github.com" or "Cursor"). Updates as new telemetry arrives.
- `Pause` / `Resume` button.
- `Stop` button (ends the session; transitions to completed; opens the summary view).
- Optional link to the attached task.

### 8.2 `/focus` route

- **Top section**: same active-session controls as the dashboard widget if a session is running; otherwise a "Start Session" form (mirrors the dashboard).
- **Bottom section**: **session history** — reverse-chronological list of past sessions. Each row: date · effective duration · pause count · task name (if linked) · click to expand the post-session summary inline (or open a detail drawer).

### 8.3 Cross-route sticky session bar

When a session is `running` or `paused`, a thin sticky bar renders at the top of **every route except `/focus`** (and `/login`). The bar surfaces the same state as the dashboard widget — status (`● running` / `❚❚ paused`), live elapsed time, and quick `Pause` / `Resume` / `Stop` controls — so the user always knows a session is active no matter where they've navigated.

Behavior summary (full spec in `Features Markdown/Dashboard.md` §6):
- Listens to the same `GET /v1/focus-sessions/current` 5s poll as the dashboard widget (§9.6) — no extra requests.
- Auto-dismisses when the session transitions to `completed` / `aborted` / `null`, with a toast linking to the summary.
- `Pause` flips the bar's color and label (green `running` → amber `paused`); `Resume` flips it back.
- Suppressed on `/focus` (covered by the page itself) and `/login` (not authenticated). Not suppressed on `/` — the minor redundancy with the dashboard widget is accepted to keep the rule simple and to handle the case where the user has hidden the `focus_session` widget on their dashboard.
- Click anywhere on the bar outside the controls → navigates to `/focus`.

### 8.4 Post-session summary

Shown automatically when a session transitions to `completed`. Reachable later from `/focus` history or from session indicators on `/calendar`.

Contents:
- Header: start time, end time, effective duration, wall-clock duration, pause count.
- Pause timeline: a horizontal bar representing the session's wall-clock duration with shaded segments for each pause; hover shows pause start/end and duration.
- Pause breakdown text: e.g. *"3 pauses (12m 24s total)"*.
- **Top apps** (from desktop source telemetry attributed to the session): top 5 by total time, with bar chart.
- **Top websites** (from browser source telemetry attributed to the session): top 5 by total time, with bar chart.
- **Linked task** (if any): title + section + a small "Mark complete" affordance.

No quality rating, no notes input. v1 minimal.

---

## 9. Behavior & lifecycle details

### 9.1 Starting a session (and concurrent-session handling)

- `POST /v1/focus-sessions` with `{ mode, plannedDurationMs?, taskId? }`.
- Server creates a row in `state = 'running'`, `startedAt = now()`.

**Concurrent-session UX — "Stop existing & start new":**

If another session is already `running` or `paused`, the request returns `409 Conflict` with a body identifying the existing session:

```json
{
  "code": "session_already_active",
  "existingSessionId": "01J9X...",
  "existingSession": {
    "state": "running",
    "mode": "timer",
    "startedAt": "2026-06-11T14:32:00.000Z",
    "plannedDurationMs": 1500000,
    "taskId": "..."
  }
}
```

The client UI catches this and shows a confirm modal:

> *"A focus session is already running (started 14:32, 25 minutes elapsed). Stop it and start a new one?"*

On confirm, the client makes two calls in sequence:
1. `POST /v1/focus-sessions/{existingSessionId}/stop` — ends the old session with `endReason = 'manual_stop'`. The old session's post-session summary is reachable from `/focus` history as normal.
2. `POST /v1/focus-sessions` (retried with the original payload) — creates the new session.

On cancel: nothing happens; the existing session keeps running.

The race window (another tab starting a third session in between the two calls) is negligible given the single-user scope and 5s polling cadence (§9.6). An atomic single-call "stop-and-start" endpoint can be added later if this ever matters in practice.

### 9.2 Pausing
- `POST /v1/focus-sessions/{id}/pause`.
- Server flips `state` to `paused`, opens a `FocusSessionPause` row with `pausedAt = now()`.

### 9.3 Resuming
- `POST /v1/focus-sessions/{id}/resume`.
- Server flips `state` to `running`, sets `resumedAt = now()` on the open pause row, computes `durationMs`.

### 9.4 Stopping (manual)
- `POST /v1/focus-sessions/{id}/stop`.
- If currently paused, the server closes the open pause row (`resumedAt = now()`) first.
- Sets `state = 'completed'`, `endedAt = now()`, `endReason = 'manual_stop'`, computes `effectiveDurationMs`.

### 9.5 Timer expiry
- For `mode = 'timer'` sessions, the **server** is authoritative: a scheduled check (e.g. `@nestjs/schedule` every 10s) finds sessions whose `running` time has reached `plannedDurationMs` and auto-completes them with `endReason = 'timer_complete'`. The client doesn't need to be online for the session to end on time.
- Client UI also runs the countdown locally for snappy display, then converges on the server's authoritative end.

### 9.6 Client polling / live updates
- The dashboard widget polls `GET /v1/focus-sessions/current` every 5s while the page is visible (no WebSocket in v1, per `PROJECT.md` §2.2).
- Polling is paused when the tab is hidden (`document.visibilitychange`).

### 9.7 Resuming an existing session on page load
- On dashboard mount: query `GET /v1/focus-sessions/current`. If a `running`/`paused` session exists, hydrate the widget with it (including pause count and current pause's `pausedAt`).
- The browser the session was started in has no special status — any browser / device the user is logged into shows the same active session.

### 9.8 Crash / abandon handling
- If a session sits in `running` or `paused` for more than 24 hours without any client `GET /v1/focus-sessions/current` heartbeat, a server job marks it `aborted` with `endedAt = startedAt + min(24h, plannedDurationMs)` to avoid contaminating Memento Mori focus-minute shading with a phantom multi-day session.
- Aborted sessions appear in history with a clear "auto-ended (no activity)" label.

---

## 10. API surface (sketch — full shape goes in `PROJECT.md` §7)

| Method | Path                                            | Purpose                                                                |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/v1/focus-sessions/current`                    | Returns the user's currently active (running/paused) session or `null` |
| POST   | `/v1/focus-sessions`                            | Start a new session. Returns `409` with `existingSessionId` body if one is already active (see §9.1) |
| POST   | `/v1/focus-sessions/{id}/pause`                 | Pause                                                                  |
| POST   | `/v1/focus-sessions/{id}/resume`                | Resume                                                                 |
| POST   | `/v1/focus-sessions/{id}/stop`                  | End manually                                                           |
| GET    | `/v1/focus-sessions?from=...&to=...`            | List historical sessions (for `/focus` history and Calendar indicators) |
| GET    | `/v1/focus-sessions/{id}`                       | Detailed session (used for summary view)                               |
| GET    | `/v1/focus-sessions/{id}/breakdown`             | Top apps + top websites for this session (from attributed telemetry)   |
| GET    | `/v1/focus-sessions/summary?from=...&to=...`    | Per-day session counts + total minutes (used by `Calendar.md` §3.2)    |

User settings endpoints live on `/v1/me` and are detailed alongside the auth/user spec in `PROJECT.md` §9.

---

## 11. Accessibility

- Session controls are real `<button>` elements with descriptive labels ("Start session", "Pause session", "Stop session").
- Active session timer announces minute changes via an `aria-live="polite"` region (not every second — too chatty).
- Pause / Resume affordance has both an icon and a text label.
- Post-session summary chart bars include numeric values in adjacent text (color not the sole indicator).
- Keyboard: Space toggles Pause/Resume when the widget has focus; Esc on the summary view dismisses it.

---

## 12. Dependencies

- **Telemetry pipeline** (`PROJECT.md` §12) — provides the events that get attributed.
- **Browser extension** (`Sources Markdown/Extension.md`) and **Desktop app** (`Sources Markdown/DesktopApp.md`) — the actual sources of those events.
- **Tasks** (`Features Markdown/Tasks.md`) — for the optional `taskId` link.
- **Memento Mori** (`Features Markdown/MementoMori.md`) — consumes `effectiveDurationMs` for weekly shading.
- **Calendar** (`Features Markdown/Calendar.md`) — consumes daily session-count + total-minutes summary.
- **Recharts** — for the top-apps / top-websites bar charts in the post-session summary.

---

## 13. Open Questions / TODOs

- **Auto-pause on idle.** Removed for v1 (every pause is user-triggered). If it comes back in a future version, re-introduce idle as a wire-protocol event from the desktop app (browser-extension idle is too noisy) and ship the auto-pause toggle as opt-in.
- **Crash threshold.** 24h auto-abort (§9.8) — does this conflict with overnight deep-work sessions? Probably fine for personal scope; revisit if it bites.
- **Aborted timer semantics.** When a `timer` session times out while the user is paused, does it complete normally (with `endReason = 'timer_complete'` and `endedAt = now()`) or wait for resume? Leaning "complete normally" — the timer is wall-clock, not effective-time.
- **Stop a session from the extension / desktop app?** Could let the desktop tray show a Stop button. Defer — start in the web UI only.
- **What happens to the linked task on session end?** No automatic side-effect (task completion is manual). The summary panel offers a one-click "Mark complete" but doesn't auto-tick.
- **Live telemetry breakdown during an active session?** v1 only shows "current target" (latest event). Full breakdown shows only in the post-session summary. Live breakdown is nice but adds a polling endpoint just for it — defer.
- **Time zones.** All timestamps stored UTC; UI formats in user's local timezone. Session "day" for Calendar / Memento Mori bucketing follows the user's local-day boundary (stored on `User`).
- **Aborted-session contribution to Memento Mori.** Should aborted sessions count their `effectiveDurationMs` toward weekly focus minutes, or be excluded? Leaning excluded — the duration is a fabrication.
