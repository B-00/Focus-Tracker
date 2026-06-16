# Focus Tracker — Tasks (Feature Spec)

> Personal task list organized into user-defined **Sections** (Work, Workout, Side Project, etc.).
> Tasks come in three **kinds**: **Dated**, **Ongoing**, and **Routine**. Dated and ongoing tasks have a single completion checkbox; routine tasks generate a separate completion record per scheduled occurrence.
> Every task carries a required **priority** (`low | mid | high | extreme`) that drives sorting across the app and powers the weighted scoring in the consistency charts (see `TaskCharts.md` §5).
> Single-day dated tasks can opt in to **transfer-to-next-day** if missed; tasks missed again on the transferred day fall into a **Backlog** the user can re-date at will.

**Status:** Specification in progress. v1 first batch (see `PROJECT.md` §6).

---

## 1. Overview

Tasks are the lightweight to-do unit of the app. Each task lives in exactly one user-defined Section (or is "unsectioned" / in the implicit Inbox) and is one of three kinds:

| Kind     | Has a date? | Repeats? | Completion model                                         | Transfer / Backlog?           | Surfaces                                                            |
| -------- | ----------- | -------- | -------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| Dated    | Yes (day or range) | No | Single checkbox per task                                | Single-day only, opt-in       | `/tasks` (Dated panel), `/calendar`, dashboard "Today's Tasks"     |
| Ongoing  | No          | No       | Single checkbox per task                                | N/A (no date)                 | `/tasks` (Ongoing panel), dashboard "Ongoing Tasks"                |
| Routine  | No (driven by schedule) | Yes — daily / weekly / specific weekdays | One `TaskInstance` per scheduled occurrence, each with its own checkbox | N/A (consistency chart already handles missed days) | `/tasks` (Routine panel — also where the consistency chart lives), dashboard "Today's Tasks" |

Completion of an instance is binary (one checkbox). Routines do **not** appear on the calendar in v1 (they'd visually dominate); they have their own dedicated panel with a consistency chart instead — see `TaskCharts.md`.

---

## 2. Goals & Non-Goals

### Goals
- Simple, frictionless task capture for three distinct flavors (one-off-with-a-date, indefinite, repeating).
- User-defined organization via Sections (no fixed categories).
- **Force triage at creation** — every task picks a priority (low / mid / high / extreme), so what matters most is always visible and the consistency chart can weight items honestly.
- Surface today's actionable tasks on the dashboard with zero clicks (dated tasks for today + today's routine instances), highest priority first.
- Routine tasks generate honest history (each occurrence is its own row), feeding the consistency chart.
- Calendar stays uncluttered: dated tasks only.
- Don't lose tasks to "ran out of time" — opt-in transfer-to-next-day + Backlog catch-all for single-day dated tasks.

### Non-Goals (v1)
- Subtasks / checklists within a task.
- Free-form tags (the only categorisation axes are Section and priority).
- Arbitrary custom cadences for routines (every-N-days, "every 2nd Tuesday", etc.). v1 supports daily / weekly / specific weekdays only.
- Task assignees (single-user).
- Comments, attachments, reminders / notifications.
- External integrations (Todoist, GitHub Issues, etc.).
- Drag-and-drop reordering within a section (defer; ordering is by priority then creation date — see §4.1).
- Per-day completion for **multi-day dated tasks** (one checkbox completes the whole range).

---

## 3. Concepts

### 3.1 Section

A user-defined container for tasks. The user creates as many as they want ("Work", "Workout", "Reading List", "House", etc.) and may rename, recolor, archive, or delete them. Sections are strict containers — a task belongs to exactly one Section (or to none, in which case it lives in the implicit **Inbox**).

| Field        | Type            | Notes                                                  |
| ------------ | --------------- | ------------------------------------------------------ |
| `id`         | uuid            | Primary key                                            |
| `userId`     | uuid            | FK → User (always the single user in v1, see `PROJECT.md` §1.1) |
| `name`       | string (1..60)  | User-visible name                                      |
| `color`      | string (hex)    | Accent color for UI grouping (default: neutral)        |
| `position`   | int             | Manual ordering of Sections in the UI                  |
| `createdAt`  | timestamptz     |                                                        |
| `archivedAt` | timestamptz?    | Soft-archive instead of hard delete (preserves tasks)  |

### 3.2 Task

A unit of work, of one of three `kind`s. The `kind` discriminator drives which other fields are meaningful.

| Field                  | Type                                     | Required?     | Notes                                                                  |
| ---------------------- | ---------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| `id`                   | uuid                                     | yes           | Primary key                                                            |
| `userId`               | uuid                                     | yes           | FK → User                                                              |
| `sectionId`            | uuid?                                    | no            | FK → Section. `null` = Inbox                                           |
| `kind`                 | enum `'dated' \| 'ongoing' \| 'routine'` | yes           | Discriminator. See per-kind rules below.                               |
| `priority`             | enum `'low' \| 'mid' \| 'high' \| 'extreme'` | yes       | Required at creation, no default — user must pick. Drives sorting (extreme→low) across all surfaces and the weighted scoring in `TaskCharts.md` §5.1. See §3.6. |
| `title`                | string (1..200)                          | yes           |                                                                        |
| `description`          | text?                                    | no            | Longform                                                               |
| `startDate`            | date?                                    | dated         | **Dated only.** Inclusive start of the date or range.                  |
| `endDate`              | date?                                    | no            | **Dated only.** Inclusive end. Must be `≥ startDate` if set.           |
| `completedAt`          | timestamptz?                             | no            | **Dated / ongoing only.** `null` = incomplete; non-null = ticked time. |
| `routineDaysOfWeek`    | int[] (subset of `[0..6]`, ISO Mon=1)    | routine       | **Routine only.** Non-empty. `[1..7]` = daily; `[1]` = weekly Monday; `[1,3,5]` = Mon/Wed/Fri. |
| `routineStartDate`     | date?                                    | no            | **Routine only.** First day instances can be generated. Defaults to creation date. |
| `routineEndDate`       | date?                                    | no            | **Routine only.** Last day instances may be generated (for time-boxed routines, e.g. "30-day challenge"). `null` = open-ended. |
| `transferIfMissed`     | bool                                     | no (def. false) | **Single-day dated only.** When true, the nightly job rolls this task forward by one day if missed (see §5.6). |
| `transferredFromDate` | date?                                    | no            | **Set by the nightly job** when a transfer occurs. Records the original day the task was due. Cleared when the task is pulled out of Backlog. |
| `inBacklog`            | bool                                     | no (def. false) | **Dated only.** `true` after the task was transferred once and still not completed. Hides the task from `/calendar` and the dashboard "Today" panel; shows it in the Backlog (see §3.5). |
| `archivedAt`           | timestamptz?                             | no            | Soft-archive. Hides from active lists; preserves history (esp. for routines). |
| `createdAt`            | timestamptz                              | yes           |                                                                        |
| `updatedAt`            | timestamptz                              | yes           |                                                                        |

**Per-kind rules**

- **`kind = 'dated'`**: `startDate` required; `endDate` optional. Routine fields ignored. `completedAt` toggles completion of the whole task. `transferIfMissed` may only be `true` when the task is **single-day** (i.e. `endDate IS NULL` or `endDate == startDate`); validation rejects `transferIfMissed = true` on multi-day dated tasks.
- **`kind = 'ongoing'`**: All date and routine fields are null. `completedAt` toggles completion. `transferIfMissed` / `inBacklog` must be `false` / `null`.
- **`kind = 'routine'`**: `routineDaysOfWeek` required and non-empty. `completedAt` is **always** null on the Task itself — completion lives on the `TaskInstance` (see §3.3). The routine's `priority` flows down to every generated `TaskInstance` (instances inherit it at materialisation time; editing the parent's priority does not retroactively rewrite past instances — see §3.6). `startDate`/`endDate` are null; the routine's own `routineStartDate` / `routineEndDate` control its activity window. `transferIfMissed` / `inBacklog` must be `false` / `null` (routines have their own miss-handling via the consistency chart).
- **All kinds**: `priority` is required and must be one of `'low' | 'mid' | 'high' | 'extreme'`.

Validation rejects any combination that violates the per-kind rules.

### 3.3 TaskInstance (routine completions)

Each scheduled occurrence of a routine task is its own row. This makes history honest: "did I complete Mon's workout?" is a real database row, not a derived calculation.

| Field           | Type            | Notes                                                                       |
| --------------- | --------------- | --------------------------------------------------------------------------- |
| `id`            | uuid            |                                                                             |
| `taskId`        | uuid            | FK → Task (must be of `kind = 'routine'`)                                   |
| `scheduledDate` | date            | The day this instance is for (in the user's timezone)                       |
| `priority`      | enum `'low' \| 'mid' \| 'high' \| 'extreme'` | **Snapshot** of the parent routine's `priority` at materialisation time. Stored on the instance so historical chart scoring stays honest if the parent's priority is later edited. See §3.6. |
| `completedAt`   | timestamptz?    | `null` if not yet completed (still actionable today, or "missed" if past)   |
| `createdAt`     | timestamptz     |                                                                             |
| `updatedAt`     | timestamptz     |                                                                             |

Constraints:
- **Unique** on (`taskId`, `scheduledDate`).
- `scheduledDate` must fall within the routine's `[routineStartDate, routineEndDate]` window (or open-ended) AND on a day listed in `routineDaysOfWeek`.

**Instance lifecycle:**
- **Today's** instance is created **lazily on first read** of today's list (e.g. when the dashboard or `/tasks` panel queries "today's routines").
- **Past missed instances** are materialized by a nightly maintenance job (see §5.5). After the job runs, every day in `[routineStartDate, today - 1]` that matches `routineDaysOfWeek` has a `TaskInstance` row, either completed or with `completedAt = null` (= missed). This makes "missed" a concrete data state rather than the absence of a row — required for the routine consistency chart (see `TaskCharts.md` §5).
- Marking today's checkbox sets `completedAt = now()`. Unchecking clears it to `null`.
- Past instances are normally read-only in the UI, but unchecking / re-checking a missed past day is allowed (rare, but useful for correcting accidental misses). It updates `completedAt` and the daily score is recomputed by the next nightly run, or immediately on demand if invoked from the UI.

### 3.4 The Inbox

Implicit. A task with `sectionId = NULL` is "in the Inbox." There is no `Section` row for Inbox — it's just NULL.

### 3.5 The Backlog

Implicit (no `Backlog` entity). The Backlog is **the set of all dated tasks where `inBacklog = true`**, regardless of Section.

Lifecycle:

```
                      created with transferIfMissed=true
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ dated on Day N   │  ← visible on /calendar + dashboard
                         └────────┬─────────┘
                                  │ end of Day N, not completed
                                  │ nightly job at ~01:00 of Day N+1
                                  ▼
                   ┌──────────────────────────────┐
                   │ dated on Day N+1             │  ← startDate=N+1
                   │ transferredFromDate=N        │
                   └────────────┬─────────────────┘
                                │ end of Day N+1, not completed
                                ▼
                       ┌─────────────────────┐
                       │ inBacklog = true    │  ← visible in Backlog panel only
                       │ (still has the old  │
                       │  startDate for      │
                       │  history reference) │
                       └─────────┬───────────┘
                                 │ user pulls back to a chosen date
                                 ▼
                       ┌─────────────────────┐
                       │ dated again on Day X│  ← inBacklog=false
                       │ transferredFromDate │     transferredFromDate=null
                       │ cleared             │     (the transfer cycle restarts)
                       └─────────────────────┘
```

Notes on the Backlog state:
- Backlogged tasks still carry their last `startDate` for reference, but **do not** appear on `/calendar` or in the dashboard "Today" panel. They only appear in the Backlog (§4.4) and on `/tasks` in the Backlog panel (§4.1).
- A backlogged task with `transferIfMissed = true` retains that flag. When pulled back to a date, the one-transfer cycle starts over.
- A backlogged task can be completed directly from the Backlog UI (sets `completedAt = now()`); it then disappears from the Backlog and counts as a completed dated task on whatever its last `startDate` was.
- A backlogged task retains its `priority`. The default Backlog view groups by priority (§4.4), so the user can triage extreme items first regardless of which Section they originally belonged to.

### 3.6 Priority

Every task carries a `priority` value from a fixed four-level enum: `low`, `mid`, `high`, `extreme`. Priority is **required at task creation** — there is no default, and the create form will not submit without a selection.

**Why required, not optional with a default.** A "mid" default would let every task silently land at the same priority, defeating the point of triage. Forcing the user to pick keeps the levels meaningful and makes the Backlog's priority grouping actually informative.

**Visual treatment** (consistent across all surfaces — `/tasks`, `/calendar`, `/backlog`, dashboard):

| Priority  | Numeric weight (see `TaskCharts.md` §5.1) | Color cue                  | Icon / glyph    |
| --------- | ----------------------------------------- | -------------------------- | --------------- |
| `extreme` | 2.0                                       | Red badge (`destructive`)  | `▲▲` (or skull) |
| `high`    | 1.5                                       | Orange badge (`warning`)   | `▲`             |
| `mid`     | 1.0                                       | Neutral badge (`muted`)    | `●`             |
| `low`     | 0.5                                       | Faded badge (`muted/50`)   | `▽`             |

Color is **never** the sole indicator (accessibility): the glyph + priority label in the badge text + `aria-label` all carry the priority info. The badge sits at the start of the row (before the checkbox is read but after focus order — see Accessibility notes in `TaskCharts.md` §8 for full keyboard-nav rules).

**Default sort order** in every list panel: `extreme → high → mid → low`, then by the panel's secondary sort (creation date for most panels; due date for the Dated panel; original-due date for the Backlog). The user can override sort via a panel header control (see §4.1).

**Editing priority** on a task is allowed at any time and takes effect immediately (changes how the task is sorted). For routine tasks, editing the parent's priority **does not retroactively rewrite past `TaskInstance` rows** — each instance keeps its priority snapshot from materialisation time (§3.3) so the consistency chart's history stays honest. Future instances inherit the new priority.

**Priority in the consistency charts.** Each completed task contributes its weight (extreme = 2.0, high = 1.5, mid = 1.0, low = 0.5) to the numerator; the denominator is the **count** of scheduled tasks (treating `mid` as the reference baseline of 1.0). So completing an `extreme` task on an otherwise-mid day pushes the score above the +1 baseline, and a day of fully-completed extreme work peaks at +2.0; conversely, a day of fully-completed `low` work caps at +0.5 — low-impact effort is honestly logged as low impact. Backlog penalties also order by priority (highest first absorbs the largest decay term). See `TaskCharts.md` §5 for the full formula and worked examples.

---

## 4. Surfaces

### 4.1 `/tasks` — Full task management

Top-level layout is by **task kind**, not by Section — this puts the routine chart alongside the routines it measures, and keeps dated/ongoing visually quieter.

```
┌─────────────────────────────────────────────────────────────┐
│ GLOBAL CHARTS                       ← see TaskCharts.md §3.3│
│   [ global routine: cumulative-score chart ]                │
│   [ global dated:   cumulative-score chart ]                │
│ ─────────────────────────────────────────────────────────── │
│ ROUTINE                                  Sort: priority ▾   │
│   Section: Workout                                          │
│     ▲▲ ☐ Run (Mon/Wed/Fri)                     [extreme]   │
│     ●  ☑ Stretching (daily)                    [mid]       │
│   Section: Work                                             │
│     ▲  ☑ Daily standup notes (Mon-Fri)         [high]      │
│ ─────────────────────────────────────────────────────────── │
│ DATED                                    Sort: priority ▾   │
│   Section: Work                                             │
│     [ per-section dated cumulative-score chart ] ← see TaskCharts.md §3.2 │
│     ▲▲ ☐ Review PR (Jun 12) ↻                  [extreme]   │
│     ●  ☐ Q3 report (Jun 1 – Jun 15)            [mid]       │
│   Inbox                                                     │
│     ▽  ☐ Buy groceries (today) ↻               [low]       │
│ ─────────────────────────────────────────────────────────── │
│ ONGOING                                  Sort: priority ▾   │
│   Section: Reading List                                     │
│     ▲  ☐ "Deep Work" — Cal Newport             [high]      │
│     ●  ☑ "The Pragmatic Programmer"            [mid]       │
│   Inbox                                                     │
│     ▽  ☐ Clean desk                            [low]       │
│ ─────────────────────────────────────────────────────────── │
│ BACKLOG (4)                              Group: priority ▾  │  ← see §4.4
│   ▲▲ Extreme                                                │
│     ☐ Reschedule dentist  (Work · was Jun 10) → [Today] [Pick…] │
│   ▲  High                                                   │
│     ☐ Reply to landlord   (Inbox · was Jun 8) → [Today] [Pick…] │
│   ●  Mid                                                    │
│     ☐ Pick up dry cleaning (Inbox · was Jun 9) → [Today] [Pick…] │
│   ▽  Low                                                    │
│     ☐ Fix bike pump        (Inbox · was Jun 7) → [Today] [Pick…] │
└─────────────────────────────────────────────────────────────┘
```

Behaviors:
- Top of page: **two global charts** (routine + dated) — see `TaskCharts.md` §3.3. The whole panel is collapsible (default expanded). Each global chart aggregates across all Sections plus the Inbox. Same charts also appear as compact widgets on the dashboard (§4.2).
- Each top-level kind panel (Routine / Dated / Ongoing / Backlog) is collapsible (state persisted per-user in local UI prefs).
- Within a panel, tasks are grouped by Section (followed by the Inbox group if relevant) — **except the Backlog**, which has a `Group by` toggle (see below).
- **Every task row starts with a priority badge** (color + glyph + label — see §3.6). Rows are sorted **priority descending (extreme → low) first**, then by the panel's secondary axis. A small `Sort: priority ▾` control in each panel header lets the user switch the primary axis to `due date` (Dated only), `created`, or `title`; the choice is persisted in local UI prefs.
- **Routine panel:** just lists, no per-Section charts (see `TaskCharts.md` §3.5 — routines are global-only in v1). Each Section block lists its routine tasks (priority-sorted); today's checkbox is the primary affordance per routine row, plus a cadence pill ("Mon/Wed/Fri"), the priority badge, and a context menu (edit / archive / delete).
- **Dated panel:** each Section block has its **per-Section dated cumulative-score chart** at the top — but **only for Sections that have at least one single-day dated task in their history**. Multi-day tasks do not count toward the chart (see `TaskCharts.md` §3.2 / §5.2). Then standard list rows with priority badge · checkbox · title · date pill · context menu. Single-day dated tasks have a small `↻` glyph if `transferIfMissed = true` (so you can spot which tasks will roll forward).
- **Ongoing / Backlog panels:** lists only, no charts.
- Ongoing panel: standard list rows with priority badge · checkbox · title · context menu.
- **Backlog panel:** only appears when there are backlogged tasks. A `Group by` toggle in the panel header switches between:
  - **`Group: priority ▾`** (default) — four sub-headers (`▲▲ Extreme`, `▲ High`, `● Mid`, `▽ Low`), only shown for non-empty levels; each row also displays its Section as inline context ("Work · was Jun 10").
  - **`Group: section ▾`** — original behavior: grouped by Section (Inbox last); each row still shows its priority badge at the start.
  - Toggle state is persisted in local UI prefs (separately from the panel header sort controls).
  - Within each group, rows are sub-sorted **oldest-`transferredFromDate` first** (most-stale tasks bubble to the top of their priority group, so the user notices long-festering items).
  - Each row shows the original date for context ("was Jun 10") plus inline `[Today]` and `[Pick date…]` buttons. Hard-delete and complete-in-place are available via the context menu.
- Add task: kind-aware inline composer at the bottom of each Section block. Pick kind first; the form adapts (date inputs for dated, cadence picker for routine, just title for ongoing). **Priority picker is always shown and required** — the form cannot submit without a selection (see §3.6). The dated form includes a "Transfer to next day if missed" checkbox, visible only when the date range is a single day.
- Add Section: button at the bottom of the Sections list.

### 4.2 Dashboard widgets

The home dashboard at `/` (see `PROJECT.md` §8) shows several task-related widgets:

1. **Today's Tasks** — combines:
   - Dated tasks whose `[startDate, endDate]` range includes today (or `startDate == today` if no `endDate`), and `inBacklog = false`.
   - **Today's routine instances** (one row per routine that's scheduled for today).
   - Grouped by Section, then sorted within each Section by **priority descending (extreme → low)**, with un-done items above done items. Every row carries its priority badge (see §3.6) so the user's eye can land on extremes immediately.
2. **Ongoing Tasks** — tasks with `kind = 'ongoing'`, grouped by Section, priority-sorted within each Section. Capped at top N per section with an "open in `/tasks`" link.
3. **Backlog indicator** — a small badge / pill (`Backlog (4)`), with a thin priority-distribution stripe underneath: a 4-segment bar whose segment widths reflect the per-priority counts (`extreme:1, high:1, mid:1, low:1` → four equal segments coloured red/orange/grey/faded). Hidden when backlog is empty. Click → navigates to `/backlog`.
4. **Global Routine chart widget** — compact version of `TaskCharts.md` §3.3 / §3.4. Same data as the routine chart at the top of `/tasks`, just visually compressed (default range 30 days instead of 90, no `1Y / All` range pills).
5. **Global Dated chart widget** — same treatment for the dated family.

All task list panels (#1–#3) support inline complete (checkbox toggle). The chart widgets (#4–#5) are read-only; clicking either jumps to `/tasks` with that family's panel expanded.

### 4.3 Calendar integration

- **Dated tasks** appear on `/calendar` only when **not** in the Backlog (`inBacklog = false`). When a task transfers from Monday to Tuesday, its pill on the calendar moves accordingly. Once it lands in the Backlog, it disappears from the calendar entirely until re-dated.
- **Ongoing tasks** never appear on the calendar (no date to pin to).
- **Routine tasks** do **not** appear on the calendar in v1 (decision: they'd dominate the view). Their consistency lives in the dedicated chart on `/tasks` — see `TaskCharts.md`.

### 4.4 `/backlog` — dedicated Backlog route

A dedicated route mirrors the Backlog panel from `/tasks` (§4.1) at full screen — useful when you have a lot of backlogged tasks and want them out of the way of the routine charts and other panels.

Contents:
- Header: "Backlog · N tasks" + a small explanation tooltip ("Tasks that were transferred forward and missed again. Pull each one back to today or pick a date.").
- Header also includes a per-priority **summary chip row**: four chips (`▲▲ Extreme · 2`, `▲ High · 1`, `● Mid · 3`, `▽ Low · 1`), each clickable to filter the list to that priority only. Empty levels are hidden. Active filter shown as a selected chip with an `×` to clear.
- **Grouped by priority by default** — `▲▲ Extreme → ▲ High → ● Mid → ▽ Low`. Each priority group has a small header showing the badge + label + count (e.g. `▲▲ Extreme (2)`). Empty priority groups are not rendered.
- A `Group by` toggle in the header (mirroring the `/tasks` Backlog panel — §4.1) switches between `priority` (default) and `section`. State is persisted in local UI prefs and synced with the `/tasks` Backlog panel's toggle so the two surfaces stay consistent.
- Within each group, rows are sorted by **oldest `transferredFromDate` first** (most-stale tasks bubble to the top so the user notices long-festering items).
- Each row: priority badge · checkbox · title · context line ("Work · was Jun 10" — original `startDate` before the transfer, plus Section name when grouped by priority) · inline `[Send to today]` and `[Pick date…]` buttons · context menu (edit / hard-delete).
- Empty state (no tasks at all): friendly note ("Nothing in the backlog. Nice.").
- Empty state with a filter active (e.g. only `extreme` selected but no extreme-backlog tasks): "No extreme-priority tasks in the backlog. Lower-priority items are still listed when you clear the filter."

---

## 5. Behavior

### 5.1 Validation
- `title`: trimmed, length 1..200.
- `priority`: must be one of `'low' | 'mid' | 'high' | 'extreme'`. Required (no default — see §3.6). Validation rejects `null` / missing.
- `kind`-driven field rules (see §3.2 per-kind rules).
- Dated: `endDate ≥ startDate` if both present; `endDate` alone is rejected.
- Routine: `routineDaysOfWeek` non-empty subset of `[1..7]`; `routineEndDate ≥ routineStartDate` if both present.

### 5.2 Editing
- Any field on a Task can be edited at any time, except `kind` — once chosen, the kind is fixed (changing kind would invalidate instances / dates and cause confusing history). Document this in the UI by hiding the kind picker after creation.
- Moving a task between Sections is allowed.
- Editing a routine's schedule (`routineDaysOfWeek`, `routineStartDate`, `routineEndDate`) takes effect for **future** instances only. Existing TaskInstance rows are preserved — history is honest.

### 5.3 Deletion vs Archive
- **Dated / Ongoing tasks**: hard delete (no trash). Confirmation modal if the task is incomplete.
- **Routine tasks**: prefer **archive** over delete — preserves the TaskInstance history that feeds the consistency chart. Archived routines stop generating new instances and disappear from active lists. A hard-delete escape hatch exists in the UI ("Delete forever — this will also delete its X completed instances") with a strong confirmation.
- **Sections**: deleting a Section prompts the user to (a) move its tasks to Inbox, or (b) delete all tasks in it. Archiving a Section hides it but preserves its tasks (including routine history).

### 5.4 Routine instance behavior
- Today's instance for a routine is materialized on first read of today's list.
- Checking today's instance sets `completedAt = now()`. Unchecking clears it. There's no undo timeout.
- Past missed instances are materialized by the nightly maintenance job (see §5.5).
- If the user changes a routine's cadence mid-week, today's already-materialized instance keeps its state; future days follow the new schedule.

### 5.5 Nightly maintenance job (`@nestjs/schedule`)

A scheduled NestJS service (`TaskMaintenanceService`) runs once per night at ~01:00 in the user's local timezone. It is **required** by the consistency charts (see `TaskCharts.md` §5) and by the transfer / backlog flow (§5.6); without it, missed days are invisible, the charts' scoring rule cannot be computed honestly, and transfers don't happen.

The job processes four steps, **in strict order — order matters for the Dated chart's honest history** (see `TaskCharts.md` §5.3 / §5.4):

**Step 1 — Materialize missing past routine instances.** For each routine task that is not archived: walk every day in `[max(routineStartDate, lastMaterializedDate + 1), yesterday]` whose weekday is listed in `routineDaysOfWeek` AND that falls within the routine's active window. For each such day with no existing `TaskInstance`, insert a row with `completedAt = null` AND `priority = parentRoutine.priority` (snapshot — see §3.6).

**Step 2 — Snapshot dated due-day counts AND backlog penalty for yesterday.** For each Section that had any single-day dated task whose `startDate = yesterday` AND `inBacklog = false` at end of day, upsert one row into `dated_section_daily_score` with:
- `scheduledCount` — count of those tasks. **Drives the base-score denominator** (`TaskCharts.md` §5.1).
- `completedCount` — count of those with `completedAt IS NOT NULL AND completedAt <= yesterday_end_local`.
- `scheduledWeight` — **sum of `priorityWeight(task.priority)`** over those tasks (see `TaskCharts.md` §5.1 for the weights). Informational; not in the denominator.
- `completedWeight` — sum of `priorityWeight(task.priority)` over the completed subset. **Drives the base-score numerator.**
- `backlogCount` (`N`) — count of those with `completedAt IS NULL AND transferredFromDate IS NOT NULL` (i.e. tasks that were already transferred once and missed again — Step 3 will move them to Backlog).
- `baseScore` — `completedWeight / scheduledCount` per `TaskCharts.md` §5.1, with the `-1` floor for zero completion and `0` for zero scheduled. Range `[-1.000, +2.000]`.
- `backlogPenalty` — geometric-decay formula per `TaskCharts.md` §5.3, with backlog tasks **ordered by descending `priority`** so the highest-priority task absorbs the `-2` term: `0` if `N == 0`, otherwise `-3 + (1/2)^(N-1)`. Bounded in `(-3, 0]`.
- `score` — `baseScore + backlogPenalty`. Range `[-4.000, +2.000]`.
- `runningTotal` — previous-day's `runningTotal + score`.

**This step must run before Step 3** — Step 3 mutates `startDate` and `inBacklog`, which would both erase the historical due-day information AND make it impossible to detect which tasks were transitioning into Backlog tonight.

**Step 3 — Transfer / backlog missed dated tasks** (see §5.6 for the full rule). At this point the chart snapshot is already persisted, so the mutations here don't affect the chart's honest history.

**Step 4 — Compute and persist each section's daily routine score for yesterday.** Apply the scoring rule from `TaskCharts.md` §5 to each Section's `TaskInstance` rows for yesterday and upsert into `routine_section_daily_score` (`sectionId`, `userId`, `date`, `scheduledCount`, `completedCount`, `scheduledWeight`, `completedWeight`, `score`, `runningTotal`). Weights are summed from each instance's `priority` snapshot (Step 1). `score = completedWeight / scheduledCount` (with `TaskCharts.md` §5.1 boundary rules); range `[-1.000, +2.000]`. Routines have no backlog modifier.

Properties of the job:
- **Idempotent.** Skips dates already materialized / scored. Safe to re-run.
- **Catch-up on resume — day-by-day, NOT step-by-step across the whole window.** If the API process was off for several days (laptop closed), the next run processes each missed day in order: for each day D, it runs Steps 1–4 with D as "yesterday" before moving to D+1. This preserves the Step 2 → Step 3 ordering critical for the dated chart.
- **No external infrastructure.** Pure in-process scheduler; lives wherever the API process lives. Fine for the local-first deployment in `PROJECT.md` §1.1.
- **Manual trigger.** A `POST /v1/admin/maintenance/run?from=...` endpoint (auth-gated) lets the user force a re-run after editing past data or for debugging.

### 5.6 Transfer / Backlog logic (single-day dated tasks)

Executed as Step 2 of the nightly job (§5.5). For each dated task where `transferIfMissed = true`, `inBacklog = false`, `archivedAt IS NULL`, `completedAt IS NULL`, `endDate IS NULL OR endDate == startDate`, and `startDate < today`:

```
if transferredFromDate IS NULL:
    # First miss → roll forward one day.
    transferredFromDate := startDate
    startDate := startDate + 1 day

elif transferredFromDate IS NOT NULL:
    # Already transferred once and still missed → move to Backlog.
    inBacklog := true
    # startDate is left at its (already-transferred) value for "was Jun X" display.
    # transferredFromDate is retained for context until the user re-dates the task.
```

Catch-up behavior (multi-day gaps, e.g. laptop closed for a week):
- If a task with `transferIfMissed = true` was due last Monday and the job hasn't run all week, the catch-up run on Sunday night must NOT roll the task forward 6 times. Instead, it applies **at most one transfer** (Monday → Tuesday) and then moves the task to Backlog on the next missed-day evaluation. The final state after catch-up: `inBacklog = true`, `transferredFromDate = Monday`, `startDate = Tuesday`. The user sees one backlogged task, not seven daily ghosts.

When the user pulls a task out of the Backlog (via `/backlog` or the Backlog panel on `/tasks`):
- `[Send to today]` → `startDate = today`, `inBacklog = false`, `transferredFromDate = null`. The one-transfer cycle restarts.
- `[Pick date…]` → same, but `startDate = userPickedDate`.
- The task's `transferIfMissed` flag is preserved (no need to re-opt-in each time it's resurrected).

Editing a backlogged task is allowed; in particular, the user can clear `transferIfMissed` if they no longer want the rolling behavior. Completing a backlogged task directly is also allowed (sets `completedAt = now()` and removes it from the Backlog view).

### 5.7 No telemetry coupling
- Task completion is purely user-driven. Tasks do **not** consume or trigger telemetry from the extension / desktop. Focus Sessions are the only feature that does (see `FocusSession.md`).

---

## 6. Future work (deferred / out of v1)

- Per-day completion for multi-day **dated** tasks (today, the single checkbox completes the whole range).
- Subtasks / checklists.
- Free-form tags (Section + priority cover v1's needs).
- Arbitrary custom routine cadences (every N days, every Nth weekday of the month).
- Drag-and-drop reordering of tasks within a section (sort is priority-then-secondary in v1 — see §4.1).
- Snooze / postpone (move dates forward by N days with one click).
- Quick capture via global keyboard shortcut.
- Reminders / notifications for dated or routine tasks.
- Priority-aware reminder cadences (e.g. nag harder for `extreme` items).

---

## 7. API surface (sketch — full shape goes in `PROJECT.md` §7)

| Method | Path                                                | Purpose                                                       |
| ------ | --------------------------------------------------- | ------------------------------------------------------------- |
| GET    | `/v1/sections`                                      | List sections (with task counts)                              |
| POST   | `/v1/sections`                                      | Create a section                                              |
| PATCH  | `/v1/sections/{id}`                                 | Rename / reorder / recolor / archive                          |
| DELETE | `/v1/sections/{id}?cascade=...`                     | Delete (cascade or move-to-inbox)                             |
| GET    | `/v1/tasks?kind=...&from=...&to=...&section=...`    | List tasks, filterable by kind / date range / section. Excludes backlogged unless `?backlog=true`. |
| POST   | `/v1/tasks`                                         | Create a task (validates per-kind rules, including the single-day requirement for `transferIfMissed=true` and the required `priority` field) |
| PATCH  | `/v1/tasks/{id}`                                    | Edit (any field except `kind`). Includes toggling `transferIfMissed`, clearing `inBacklog`, and changing `priority`. Editing a routine's `priority` does not retroactively rewrite past `TaskInstance.priority` (see §3.6). |
| DELETE | `/v1/tasks/{id}`                                    | Hard delete (with extra confirmation for routine if instances) |
| POST   | `/v1/tasks/{id}/archive`                            | Soft-archive (mainly for routines)                             |
| GET    | `/v1/tasks/{id}/instances?from=...&to=...`          | List instances of a routine in a range                         |
| GET    | `/v1/instances/today`                               | Materialize + return today's routine instances across all routines |
| PATCH  | `/v1/instances/{id}`                                | Toggle completion (set / clear `completedAt`)                  |
| GET    | `/v1/backlog?groupBy=priority\|section&priority=...` | List all backlogged tasks (where `inBacklog = true`). `groupBy` defaults to `priority`. Optional `priority` filter narrows to one or more priority levels (CSV: `priority=extreme,high`). Drives `/backlog` and the Backlog panel. Response includes a per-priority `summary` ( `{ extreme: 2, high: 1, mid: 3, low: 1 }` ) for the chip row regardless of filter. |
| POST   | `/v1/tasks/{id}/redate`                             | Pull a backlogged task back. Body: `{ date: "YYYY-MM-DD" }` (or `"today"`). Server sets `startDate`, clears `inBacklog` and `transferredFromDate`. |

---

## 8. Dependencies

- **Calendar** (`Features Markdown/Calendar.md`) reads dated tasks from this module.
- **Task Charts** (`Features Markdown/TaskCharts.md`) reads `TaskInstance` data (Routine family) and single-day dated task lifecycle (Dated family) to render per-section consistency for both task kinds.
- **Dashboard** reads today's dated + today's routine instances + ongoing.
- **Focus Sessions** do **not** depend on Tasks (sessions are independent of any task link in v1).
- **date-fns** for date math.

---

## 9. Open Questions / TODOs

- **Inbox modeling.** Implicit-NULL (current plan) vs an auto-seeded Section row per user. Leaning implicit-NULL.
- **"Show completed" toggle.** Per-section UI toggle (in localStorage) vs per-user setting. Leaning per-section.
- **Auto-archive completed routines.** A 90-day-old completed routine instance contributes to history but clutters nothing — keep forever in v1.
- **Multi-day dated task in dashboard "Today's Tasks".** Show every day with a "day 3 of 5" pill, or only on the first/last day? Leaning every-day-with-pill.
- **Reopen behavior.** If you uncheck a completed task, does it move back to the top of its section, or stay in place? Defer.
- **Timezone of `scheduledDate`.** All routine scheduling is in the user's local timezone (stored on `User`). Crossing DST: a routine scheduled at "Sunday" still resolves to the local Sunday. v1 doesn't deal with users changing timezones; document as a known limitation.
- **Cadence picker UX.** Need to design the form control for picking `routineDaysOfWeek`: a 7-button toggle row plus presets ("Daily", "Weekdays", "Weekends")?
- **Calendar indicator for "originally was Day N" on a transferred task.** Should the calendar render a small icon on a transferred task's new day (e.g. ↻) so the user can see at a glance that it rolled forward? Leaning yes, but it's a Calendar.md detail; coordinate in a future pass.
- **Backlog cap / age-out.** Should very old backlog tasks (e.g. >90 days since they entered the backlog) auto-archive? Probably not for v1 — the user opted into transfer, the backlog is their reminder. (If we ever do this, age-out the lowest-priority items first.)
- **Bulk Backlog actions.** "Send all to today" / "Pick date for all selected" / "Send all `extreme` to today" — defer until backlog actually feels cluttered.
- **Priority weight tunables.** v1 hard-codes weights at `extreme=2.0 / high=1.5 / mid=1.0 / low=0.5` (see §3.6 and `TaskCharts.md` §5.1). Should these become a user setting later? Probably not — the whole point is that the weights are an objective, fixed dial-up of "extreme matters twice as much as mid." Re-evaluate after a few months of use if the chart's dynamic range feels off.
- **Should completing a task also auto-promote a related task's priority?** (e.g. completing "draft email" auto-bumps "send email" to extreme). Out of v1 — no task linking yet.
- **Visual badge style.** Currently planned as small coloured pills with glyphs (`▲▲` / `▲` / `●` / `▽` — see §3.6). Could also experiment with left-border coloured bars per row. Decide during component design.
- **Routine instance priority drift.** Editing a routine's parent `priority` does not retroactively rewrite past `TaskInstance.priority` (§3.6). Should there be a one-shot "recompute past N days at the new priority" action for users who want it? Defer until someone actually asks.
