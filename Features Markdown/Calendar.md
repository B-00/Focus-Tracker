# Focus Tracker — Calendar (Feature Spec)

> A month-first calendar view that displays **dated tasks** and **past focus sessions**.
> Users can create and edit dated tasks directly from the calendar.

**Status:** Specification in progress. v1 first batch (see `PROJECT.md` §6).

---

## 1. Overview

The Calendar is a read-mostly visual surface for "when things happened" (past focus sessions) and "when things are due / scheduled" (dated tasks). It is **not** a scheduling tool for focus sessions — sessions are recorded as they happen, not booked in advance.

The user can create a new dated task by clicking an empty day, and can edit/move/delete existing tasks from the calendar without leaving the view.

---

## 2. Goals & Non-Goals

### Goals
- Single-view answer to "what's happening this week / month?"
- Frictionless creation of dated tasks (click day → type → done).
- Past focus sessions visible at the day-cell level so the calendar doubles as a casual session history.
- Multi-day tasks render as continuous bars across cells.

### Non-Goals (v1)
- External calendar integrations (Google, Outlook, iCal subscriptions).
- Meetings as a first-class concept.
- Scheduled / planned focus sessions (block time in advance).
- Reminders / notifications tied to calendar entries.
- Multiple calendar overlays / color-by-section toggles (defer).
- Drag-and-drop to move a task's dates (defer; edit dates via the task modal).

---

## 3. What the Calendar Displays

### 3.1 Dated tasks
- Source: `Task` rows where `startDate` is non-null (see `Tasks.md` §3.2).
- Single-day task → rendered as a pill in its day cell.
- Multi-day task (`startDate` and `endDate` both set) → rendered as a horizontal bar spanning the inclusive range. Bar wraps to the next row when crossing a week boundary.
- Visual treatment:
  - Pill / bar shows a **priority glyph prefix** (`▲▲` / `▲` / `●` / `▽` — see `Tasks.md` §3.6) followed by the task title (truncated to fit).
  - Pill / bar **fill color** uses the task's Section color (see `Tasks.md` §3.1); Inbox tasks use a neutral color.
  - Pill / bar **left-edge accent stripe** uses the priority color (red / orange / muted / faded — see `Tasks.md` §3.6 table). Section color owns the fill so the calendar's at-a-glance grouping by life-area is preserved; the priority stripe adds a second channel for triage.
  - The combined treatment is also surfaced via `aria-label` (e.g. `"Extreme priority — Review PR — Work — Jun 12"`), so colour is never the sole signal (accessibility).
  - Completed tasks are rendered with reduced opacity + strikethrough, but still visible.
  - **Sort order within a day cell** (when multiple pills/bars start on the same day): priority descending (extreme → low), then by creation time. So the cell visually leads with what matters most.

### 3.2 Past focus sessions
- Source: `FocusSession` rows that have ended (`endedAt != null`).
- Aggregated per day: each day cell shows a small indicator (e.g. a dot + a number) reflecting **session count** for that day, plus a tooltip showing total focus minutes for the day.
- Today's in-progress session (if any) is also shown, marked distinctly (e.g. pulsing dot).
- Future days never show session data (sessions can't be scheduled in v1).

### 3.3 Today
- The cell representing today is visually distinct (border, accent background, "today" label).

---

## 4. What the Calendar Lets You Create / Edit

In v1, the calendar can create and edit **only dated tasks** — nothing else.

### 4.1 Create a dated task
- Click an empty area of a day cell → inline composer opens at that cell. Type a title, **pick a priority** (the four-segment selector — extreme / high / mid / low — is required, no default; see `Tasks.md` §3.6), hit Enter → task created with `startDate = clickedDate`, no `endDate`, no `sectionId` (goes to Inbox unless the user picked a section in the composer).
- The inline composer will not submit until both `title` and `priority` are set. The priority picker auto-focuses immediately after the title is typed so the keyboard flow is `title → ⌨ priority selector → Enter`.
- Composer also offers: section picker, "add end date" toggle (turns the single-day task into a date range), and a full-modal escape hatch for description / etc.

### 4.2 Edit a task
- Click an existing pill/bar → opens a popover with title, dates, section, complete checkbox, delete button.
- Changes persist on blur or explicit save.

### 4.3 Delete a task
- Inside the popover; confirmation modal if the task is incomplete.

### 4.4 What the Calendar does NOT let you do (intentionally)
- Cannot create or schedule a focus session from the calendar. Sessions start from the dashboard/`/focus`.
- Cannot edit a focus session (sessions are immutable once ended). Clicking the day's session indicator opens a quick read-only summary (counts, total minutes, link to session detail).
- Cannot add per-day notes (those live on Memento Mori — see `MementoMori.md` — and are weekly, not daily).

---

## 5. Views & Navigation

| View       | Status (v1)              |
| ---------- | ------------------------ |
| Month      | **Default**              |
| Week       | Deferred to v2           |
| Day        | Deferred to v2           |
| Agenda     | Deferred to v2           |

Controls in the calendar header:
- `‹` / `›` to navigate months
- `Today` button to jump back to current month
- Month/Year label (clickable to open a year/month picker)

### 5.1 Layout
- 7 columns (weekdays). First column is **Monday** by default (configurable in settings later — defer).
- 5 or 6 rows per month depending on month layout (standard month-grid behavior).
- Cells are roughly square; bars/pills wrap to the next visual line within a cell if many items land on the same day.

---

## 6. Behavior

### 6.1 Data fetching
- On mount: fetch `tasks?from={firstVisibleDay}&to={lastVisibleDay}` and `focus-sessions/summary?from=...&to=...` (returns per-day session counts and total minutes).
- Refetch on month change.
- TanStack Query caches per range — fast back-navigation, light bandwidth.

### 6.2 Live updates
- When the user creates / edits / deletes a task elsewhere (dashboard, `/tasks`), the calendar invalidates the relevant range and refetches.
- An in-progress focus session is reflected on today's cell live (polled every 30s while the calendar is visible; no WebSocket in v1).

### 6.3 Empty states
- Empty month → calendar still renders the grid; no special message.
- A specific day with nothing → empty cell with hover affordance "click to add task."

### 6.4 Loading / error states
- Loading: skeleton cells; existing data stays visible during refetch.
- Error: small inline banner above the grid with a retry button; the grid still renders whatever stale data is cached.

---

## 7. API surface (sketch — full shape goes in `PROJECT.md` §7)

| Method | Path                                                     | Purpose                                              |
| ------ | -------------------------------------------------------- | ---------------------------------------------------- |
| GET    | `/v1/tasks?from={date}&to={date}`                        | List dated tasks intersecting the range              |
| GET    | `/v1/focus-sessions/summary?from={date}&to={date}`       | Per-day session count + total minutes (aggregated)   |
| GET    | `/v1/focus-sessions/{id}`                                | Read-only session detail for the quick popover       |

Task create / edit / delete reuse the endpoints in `Tasks.md` §7.

---

## 8. Accessibility

- Calendar grid uses ARIA `role="grid"`, day cells are `role="gridcell"`.
- Keyboard navigation: arrow keys to move between days; Enter to open create-task composer; Esc to dismiss popovers.
- Today's cell announces "Today, {date}" via screen reader label.
- Color is never the sole indicator (e.g. completed tasks also have strikethrough; in-progress session also has a label, not just a pulse).

---

## 9. Dependencies

- **Tasks** (`Features Markdown/Tasks.md`) — for dated tasks.
- **Focus Sessions** (`Features Markdown/FocusSession.md`) — for past session indicators.
- **date-fns** — for date arithmetic and locale formatting.

---

## 10. Open Questions / TODOs

- Default week start: Monday (current plan) or Sunday? Make it a setting later; defer the setting itself.
- Should the per-day session indicator be a single dot, a count, or a tiny sparkline? Leaning "dot + count + minutes-in-tooltip" for v1.
- How do we render a multi-day task that's mostly off-screen (only the tail visible at the start of the month)? Should the leading cell show a `← continued` marker?
- Should the popover allow changing a single-day task into a multi-day one inline, or force a modal? Leaning inline (add "end date" affordance).
- How are recurring or repeating events handled? Out of scope for v1; the calendar treats every task as a one-off.
- **Filter calendar by priority?** A small priority chip-bar in the calendar header (`Show: extreme ✓ high ✓ mid ✓ low ✓`) lets the user hide low-priority noise during heavy weeks. Defer to v1.1 unless the calendar gets visually cluttered in early use.
- **Two-channel colour (Section fill + priority stripe).** Listed in §3.1; the alternative is to drop the priority glyph and rely only on the stripe. Decide during component design — the glyph is more accessible but adds visual weight.
- Year and decade views — out of v1, but worth noting that the Memento Mori grid (`MementoMori.md`) already serves the "years" use case in a different idiom.
