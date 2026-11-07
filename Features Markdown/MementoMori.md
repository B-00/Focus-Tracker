# Focus Tracker — Memento Mori Life Calendar (Feature Spec)

> A weeks-of-life grid: one cell per week from birth to a configurable life expectancy.
> Past weeks are shaded by **total active telemetry minutes** that week. Current week is highlighted; future weeks are empty except for user-defined milestone markers.
> Clicking a past week opens a stats panel with a writable journal note.

**Status:** Specification in progress. v1 first batch (see `PROJECT.md` §6).

---

## 1. Overview

Inspired by the classic Stoic "Life in Weeks" poster (see: [Memento Mori poster on Pinterest](https://www.pinterest.com/pin/printed-life-calendar-memento-mori-stoic-poster-life-in-weeks-wall-calendar-stoicism-reflection-printed-memento-mori-poster-weeks-of-life-etsy--1129981362728380897/)). The grid is a single, deliberate reminder of finite time — combined with personal data so that past weeks are visually "what they were" (focused or not) and future weeks can carry user-defined milestones.

The Memento Mori view lives at `/life`; a compact strip (just the current row + current week marker) appears on the home dashboard.

---

## 2. Goals & Non-Goals

### Goals
- A clear, single-screen visualization of life-in-weeks.
- Make the past weeks **encode something true** about how I spent them (focus minutes), not just "this week happened."
- Make it interactive — clicking a past week tells me what I did that week and lets me leave a note.
- Configurable lifespan and milestones so it's personally meaningful, not generic.

### Non-Goals (v1)
- Multiple metrics on the grid simultaneously (just focus minutes for v1; toggle deferred).
- Multi-week journaling features (rich text, attachments, mood tracking) — note is plain text only.
- Sharing or exporting the grid as an image / PDF (defer).
- Predictive future shading ("if you keep this pace…") — never; defeats the point.
- Importing historical data from external sources to backfill pre-app weeks (defer; pre-app weeks show as "lived but no data").

---

## 3. Concepts

### 3.1 Week numbering

- A "week" in this feature is **ISO-week-style**, anchored to the user's **birthday**: week 0 = the week containing the birthday, week 1 = the next 7-day window, and so on.
- Default week start day **matches the rest of the app** (Monday by default — see `Calendar.md` §5.1). Document explicitly here so behavior is unambiguous if the app-wide setting ever changes.
- `currentWeekIndex = floor((today - birthday) / 7 days)`.
- `totalWeeks = lifeExpectancyYears * 52` (approximation — exact alignment is not the point; the user understands this is a poster, not a clock).

### 3.2 Cell states

| State           | Visual                                                             |
| --------------- | ------------------------------------------------------------------ |
| Past, no data   | Filled with a neutral base color (lived, but no telemetry data yet — e.g. before sources were paired) |
| Past, with data | Filled with a color whose intensity scales with **total active telemetry minutes** that week (heatmap; see §4.2) |
| Current week    | Distinct border / accent color so it's instantly findable          |
| Future          | Outlined / unfilled                                                |
| Milestone overlay | Small icon or colored dot inside the cell (see §3.4)             |

### 3.3 Configuration (stored in user settings)

| Setting               | Type        | Default | Notes                                                       |
| --------------------- | ----------- | ------- | ----------------------------------------------------------- |
| `birthday`            | date        | _none_  | Required before the Memento Mori view will render           |
| `lifeExpectancyYears` | int (60..110) | 80    | Drives `totalWeeks`                                         |

If `birthday` is missing, the `/life` route shows a one-question onboarding panel ("When were you born?") instead of an empty grid.

### 3.4 Milestone

A user-defined annotation on a specific future (or past) week.

| Field        | Type            | Notes                                                             |
| ------------ | --------------- | ----------------------------------------------------------------- |
| `id`         | uuid            |                                                                   |
| `userId`     | uuid            | FK → User                                                         |
| `targetDate` | date            | Resolves to a single week-index                                   |
| `label`      | string (1..60)  | Short text shown in the tooltip / detail panel                    |
| `color`      | string (hex)    | Cell overlay color                                                |
| `icon`       | string?         | Optional Lucide icon name                                         |
| `createdAt`  | timestamptz     |                                                                   |

Examples: "Graduate", "Move to X", "Retirement (planned)", "First job", "Met partner". Past-week milestones are equally valid — they mark moments the user wants to remember on the grid.

### 3.5 WeekNote

A short, plain-text reflection tied to a single past week.

| Field       | Type           | Notes                                                |
| ----------- | -------------- | ---------------------------------------------------- |
| `id`        | uuid           |                                                      |
| `userId`    | uuid           | FK → User                                            |
| `weekIndex` | int            | Week-since-birthday index. Unique per (user, weekIndex) |
| `body`      | text (0..2000) | Plain text                                           |
| `updatedAt` | timestamptz    |                                                      |

Notes are only writable for **past** weeks. Today's week becomes writable as soon as today passes.

---

## 4. Visual Layout

### 4.1 Grid shape
- Columns: **52** (one per week of a year).
- Rows: `lifeExpectancyYears` (default 80 → 80 rows × 52 cols = 4,160 cells).
- Year labels run down the left edge (every 5 or 10 years labeled, others tick marks).
- Decade boundaries get a slightly stronger horizontal divider for at-a-glance reading.

### 4.2 Color shading for past weeks (heatmap)

**Metric — total active telemetry minutes (the "how full was your week" story)**
- Metric: **total active telemetry minutes** in that week, summed from `activity_minute_rollup` (see `Activity.md` §3.2) across both sources (browser + desktop). Idle periods are naturally absent from the rollup (source clients close out `focus_change` events on internal idle detection; see `Sources Markdown/Extension.md` §6.1 / `Sources Markdown/DesktopApp.md` §7.1).
- Why telemetry: telemetry is always-on (`Activity.md` §1), so this metric captures every week the user actually used their devices.
- Scale: 5–7 buckets mapped to a sequential color ramp. Bucket boundaries are tunable; start with day-equivalents (e.g. 0, < 5h, 5–15h, 15–30h, 30–50h, 50h+) and adjust visually.
- "Past with zero minutes" (week happened but no telemetry, e.g. vacation, devices off) shows the lightest non-empty shade.
- "Past, no telemetry data yet" (weeks before the user paired any source) gets a distinct neutral so it's clearly *unmeasured* rather than *measured-and-zero*.

### 4.3 Current week marker
- Heavier border (2px accent color).
- A small "you are here" tooltip on hover.

### 4.4 Milestone marker
- Small filled circle / icon in the corner of the cell (color = milestone color).
- Hovering reveals the label.
- Multiple milestones in one week → stack icons; "+N" pill if more than 3.

### 4.5 Dashboard summary widget (compact view)
- Shows: just the row containing the current week, with the cells slightly larger; below it a one-line stat ("Week 1,742 of 4,160 — 41.9% lived").
- Click → opens `/life`.

---

## 5. Interactivity

### 5.1 Click a past week
- Opens a side panel (right drawer) showing:
  - Date range of that week.
  - **Total active telemetry minutes** that week (matches the cell's shade).
  - **Top 3 apps and top 3 websites by time** — from all telemetry that week, so the picture is honest about *what you actually did*.
  - Number of tasks completed (tasks whose `completedAt` fell in the week).
  - A textarea for the **WeekNote** body (autosaves on blur). Empty by default.
- Esc or click-outside closes the panel.

### 5.2 Click the current week
- Same panel layout, but the WeekNote field is **read-only** (or hidden) with a note: "You'll be able to write a reflection once this week ends."
- Stats are shown live (this week so far).

### 5.3 Click a future week
- Opens a small popover offering "Add milestone here." Confirming creates a Milestone at that week.
- Editing / deleting milestones is via the same popover when the cell already has milestones.

### 5.4 Click a milestone in the panel
- Allows editing label, icon, color; or deleting it.

### 5.5 Hover
- All cells: tooltip showing the date range of that week + (for past) focus minutes summary.

---

## 6. Behavior

### 6.1 Data fetching
- `GET /v1/life/grid` → returns aggregate buckets: `{ weekIndex, telemetryMinutes }[]` for all past weeks where the user has any data, plus `birthday`, `lifeExpectancyYears`, `currentWeekIndex`. One request renders the whole grid (4,000 ints + metadata = tiny).
- `GET /v1/milestones` → list of all milestones (also tiny).
- `GET /v1/life/weeks/{weekIndex}` → on-demand for the clicked week's drawer: stats + WeekNote body + top-apps/sites.

### 6.2 Aggregation
- Telemetry minutes are rolled up from `activity_minute_rollup` (see `Activity.md` §3.2) into a `week_activity_minutes` summary table. The nightly maintenance job (`Tasks.md` §5.5) — or a sibling job in the same scheduled service — refreshes the current and previous weeks; older weeks are immutable once a week has fully ended.
- The API never sums raw events on each render — the shading column comes from the precomputed summary table.

### 6.3 WeekNote autosave
- Debounced 1s after the user stops typing; explicit "Saved" indicator in the drawer.
- Conflict handling is trivial (single user) — last write wins.

### 6.4 Empty / loading / error states
- Empty (no birthday): one-question onboarding panel ("When were you born?").
- Loading: skeleton grid (correct dimensions, all cells in neutral) so the page doesn't jump.
- Error: small banner; the grid still renders whatever cached data is available.

---

## 7. API surface (sketch — full shape goes in `PROJECT.md` §7)

| Method | Path                                | Purpose                                              |
| ------ | ----------------------------------- | ---------------------------------------------------- |
| GET    | `/v1/life/grid`                     | Aggregated per-week focus minutes + metadata         |
| GET    | `/v1/life/weeks/{weekIndex}`        | Detailed stats + WeekNote for a single week          |
| PUT    | `/v1/life/weeks/{weekIndex}/note`   | Upsert the WeekNote                                  |
| GET    | `/v1/milestones`                    | List all milestones                                  |
| POST   | `/v1/milestones`                    | Create                                               |
| PATCH  | `/v1/milestones/{id}`               | Edit (label, color, icon, date)                      |
| DELETE | `/v1/milestones/{id}`               | Delete                                               |

`birthday` and `lifeExpectancyYears` live on the User profile (`/v1/me`).

---

## 8. Accessibility

- Grid uses `role="grid"` with row/cell semantics; year labels are `role="rowheader"`.
- Keyboard nav: arrow keys to move week-by-week; Enter to open the detail drawer.
- Color is never the sole indicator: the detail drawer always shows numeric values; tooltips include the numeric value too.
- Reduced motion respected (no pulsing on current-week marker if `prefers-reduced-motion`).

---

## 9. Dependencies

- **Activity / always-on telemetry** (`Features Markdown/Activity.md`) — source of the shading's "total active telemetry minutes" via `activity_minute_rollup`.
- **Tasks** (`Features Markdown/Tasks.md`) — for the weekly "tasks completed" stat in the drawer.
- User settings: `birthday`, `lifeExpectancyYears`.
- **date-fns** for week math.

---

## 10. Open Questions / TODOs

- 52 weeks/year is an approximation; some years have 53 ISO weeks. For v1, treat each row as exactly 52 cells (poster-style); the small calendar drift is acceptable. Revisit only if it ever feels wrong in practice.
- Metric toggle (telemetry minutes / tasks completed) — deferred. v1 fixes telemetry-minutes as the only shading signal (§4.2).
- Should milestones in the past also visually overlay on past cells (icon on top of the heatmap color)? Yes, but how the icon interacts with the heatmap intensity needs design work.
- "Multiple metrics overlaid" idea (e.g. telemetry-color + task-count dots) — explicitly deferred to keep v1 readable.
- Export / print as a poster — out of scope but a natural v2.
- "Week 0" semantics — does the week containing the user's birthday count as week 0 or week 1? Decision above: week 0. Confirm with a test on real data.
- Time zones: weeks are bucketed in the user's local timezone (stored on the User). Crossing DST: ignored for v1 (poster, not a clock).
