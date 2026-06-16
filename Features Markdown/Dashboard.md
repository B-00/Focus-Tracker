# Focus Tracker — Dashboard (Feature Spec)

> The home composition surface at `/`. Stitches together compact widgets from every other v1 feature into a single-column, fully responsive, fully customizable layout. Also defines the cross-route **sticky session bar** that surfaces an active Focus Session on every page.

**Status:** Specification in progress. v1 first batch (see `PROJECT.md` §6).

---

## 1. Overview

The Dashboard is the **composition surface** for Focus Tracker — every other feature's compact widget renders here, in a vertical stack the user can reorder and hide. The Dashboard itself owns no feature behavior beyond layout, customization, and the cross-route active-session indicator; each widget's content, polling cadence, empty state, and data fetching are defined by its owning feature spec and consumed unchanged.

### Why it exists
- Give a single glance-surface for "what's happening right now": active session, today's tasks, today's activity, consistency trends, and a reflective anchor (Memento Mori).
- Stay personal — the user controls which widgets are visible and in what order.
- Keep navigation cheap — clicking any widget jumps to its full-screen route; the Dashboard is a *summary*, not a workspace.

### What the Dashboard is NOT
- A unique feature with its own data — it is purely a renderer of other features' widgets.
- A workspace for full editing flows — inline interactions are limited to checkbox-tick + Focus Session controls (see §8).
- A drag-and-drop *within* widgets — reordering operates at the widget level only; per-widget internals are unchanged.

---

## 2. Goals & Non-Goals

### Goals
- Always-visible answers to "is a session running?", "what's on my plate today?", "how am I trending?"
- Customizable: every widget can be hidden, every widget can be reordered.
- Fully responsive: same single-column stack on desktop, tablet, and phone; each widget handles its own internal density.
- Cheap to ship: zero net-new feature behavior, just composition + a thin global session bar.

### Non-Goals (v1)
- Multi-column / grid layouts.
- "Compact mode" / global density toggle.
- Per-widget configuration beyond hide/show (e.g. "show top 10 apps instead of top 3" — that lives in the owning feature's spec / Settings).
- A dedicated `/dashboard` route distinct from `/` — the dashboard IS `/`.
- Drag-and-drop of widgets between routes (widgets are not portable).
- Widget marketplace, plugins, custom widgets — fixed v1 inventory only.

---

## 3. Widget Inventory (composition)

Eight widgets in v1, each defined by its owning feature spec. The Dashboard renders these and nothing else.

| ID                | Widget                         | Owner spec                     | Always renders?                              |
| ----------------- | ------------------------------ | ------------------------------ | -------------------------------------------- |
| `focus_session`   | Focus Session controls         | `FocusSession.md` §8.1         | Yes — shows start button or active controls   |
| `todays_tasks`    | Today's Tasks                  | `Tasks.md` §4.2 (item 1)       | Yes — shows empty CTA when no tasks today     |
| `todays_activity` | Today's Activity               | `Activity.md` §4.2             | Yes — shows empty CTA before first telemetry  |
| `ongoing_tasks`   | Ongoing Tasks                  | `Tasks.md` §4.2 (item 2)       | Yes — shows empty CTA when no ongoing tasks   |
| `routine_chart`   | Global Routine chart (compact) | `TaskCharts.md` §3.4           | Yes — shows empty CTA before first routine    |
| `dated_chart`     | Global Dated chart (compact)   | `TaskCharts.md` §3.4           | Yes — shows empty CTA before first dated task |
| `backlog`         | Backlog indicator              | `Tasks.md` §4.2 (item 3)       | **Conditional** — hidden when backlog is empty |
| `memento_mori`    | Memento Mori current-week strip | `MementoMori.md` §4.5         | Yes — shows empty CTA before birthday is set  |

**Single source of truth rule.** This file does not redefine any widget's contents, data shape, polling cadence, or interaction model — for those, follow the cross-reference. If a widget owner spec changes its behavior, the Dashboard inherits the change automatically.

**Adding a widget post-v1** is a two-step process: (1) the owning feature spec declares a `### N.X Dashboard widget` subsection, (2) the widget is added to the table above with a new ID and a default position in §4.2's order array. No schema migration required (the order array on `UserDashboardPrefs` grows by one).

---

## 4. Layout

### 4.1 Single-column stack

All widgets render in a **single vertical column**, top-to-bottom, at every viewport size. No multi-column grid, no responsive column-stacking. Each widget owns its own internal layout and shrinks/reflows on narrow screens (see §11 Responsive).

- Column **max-width**: 960px, centered horizontally. Below 960px viewport the column fills available width minus a uniform side padding (16px mobile, 24px tablet, 32px desktop).
- Widget **vertical spacing**: 16px gap between cards.
- Widget **card chrome**: rounded corners, subtle border, header strip (title + collapse chevron + reorder handle when in edit mode), body. Border / corner radius / shadow inherit from the existing `UI_Design/` design tokens.
- Each widget card is **individually collapsible** (click the chevron in its header). Collapse state is **per-user** (persists across devices — see §6).
- The Conditional `backlog` widget is hidden entirely (not just empty-state'd) when `backlogCount = 0` — no card chrome rendered.

### 4.2 Default widget order

Used when a user has no stored preferences yet, and when they click "Reset to default" in edit mode.

```
1. focus_session        ← action-first hero
2. todays_tasks         ← today's actionable list
3. todays_activity      ← passive but immediately interesting
4. ongoing_tasks        ← secondary action list
5. routine_chart        ← consistency signal (global routine)
6. dated_chart          ← consistency signal (global dated)
7. backlog              ← (conditional render)
8. memento_mori         ← reflective anchor at bottom
```

Rationale: action-first at the top (Focus Session → today's lists), trend signals in the middle (charts), reflective wrap-up at the bottom (Memento Mori). Backlog sits second-from-bottom so it doesn't grab attention when empty (and is hidden entirely when there's nothing in it).

### 4.3 Empty / loading at the column level

- **Page load**: each widget renders its own skeleton (matching the widget's final dimensions, so the column height doesn't jump as widgets resolve). No full-page loader.
- **Error per widget**: each widget shows its own inline error banner (with a retry button) inside its card; sibling widgets are unaffected.
- **All-widgets-hidden state** (user has hidden every widget — see §5): the column renders a centered "Your dashboard is empty. Add widgets back from edit mode." with a `Customize dashboard` CTA. This is the dashboard's only top-level empty state.

---

## 5. Customization (hide / reorder)

### 5.1 Model

Every user has a **`UserDashboardPrefs`** record (see §9 Data Model) that captures two pieces of state:

| Field           | Type       | Meaning                                                                                 |
| --------------- | ---------- | --------------------------------------------------------------------------------------- |
| `widgetOrder`   | `string[]` | Ordered list of widget IDs (the §3 IDs). Renders top-to-bottom in this order.            |
| `hiddenWidgets` | `string[]` | Widget IDs that are hidden. Rendered as a subset of `widgetOrder` (not duplicated).      |

A widget is **visible** iff `widgetOrder.includes(id) && !hiddenWidgets.includes(id)`. A widget is **rendered with a card** iff visible AND (not conditional OR its render-condition is true).

When the server returns prefs to the client, it merges in any v1-known widget IDs that are missing from `widgetOrder` (appended to the end, so newly-shipped widgets show up automatically without a migration) and silently drops any unknown IDs (so removing a widget in a future version doesn't error users out). See §9.3 for the merge rule.

### 5.2 Two entry points for editing prefs

The user has two equivalent ways to customize the dashboard. Both surfaces write to the same `UserDashboardPrefs` record.

**A. Inline "Edit dashboard" mode on `/`** (primary)
- A small `Customize` button at the top of the dashboard (just below the page header).
- Clicking it flips the dashboard into **edit mode**: each widget card gets a drag handle on the left and an eye-toggle (`👁` / `👁‍🗨`) on the right of its header.
- Drag a widget by its handle to reorder; click the eye to hide / show.
- Hidden widgets remain rendered (greyed out, dimmed to ~40% opacity) so the user can still see and re-show them in edit mode. Outside edit mode, hidden widgets are skipped entirely.
- A `Reset to default` link and `Done` button in the edit-mode toolbar. `Done` exits edit mode and persists the changes (single PATCH at exit, not per-keystroke).

**B. Settings panel** (mirror)
- `/settings` → "Dashboard" section (see `Settings.md` §4.3).
- Same two controls in a list form: a sortable list of widget IDs (drag to reorder) with a checkbox to hide / show each.
- Useful for users who'd rather configure once and forget, and for keyboard-only users who find the inline edit mode awkward (though edit mode is also keyboard accessible — see §10).

Both surfaces stay in sync via TanStack Query (a PATCH from either invalidates the `dashboard-prefs` query).

### 5.3 Persistence semantics

- **Default order = client-side constant** matching §4.2. The server doesn't seed a default `widgetOrder` into the DB on user creation; instead, `GET /v1/me/dashboard-prefs` returns the default-merged order when no row exists yet. First write creates the row.
- **Per-user, not per-device.** A user with two browsers / a desktop / a phone sees the same dashboard layout everywhere.
- **Per-widget collapse state** (see §4.1) is stored on the same record as a third field, `collapsedWidgets: string[]`, with the same merge / drop semantics as `hiddenWidgets`.
- **Hidden ≠ collapsed.** Hidden means the card is not rendered at all (outside edit mode). Collapsed means the card chrome is rendered but the body is hidden behind a chevron — the user can still click to expand without entering edit mode.

### 5.4 Reset to default

- "Reset to default" clears `widgetOrder` and `hiddenWidgets` to the client-side defaults (full v1 inventory, all visible) and `collapsedWidgets` to `[]`. Confirmation modal ("Reset dashboard to default? This will undo your customizations.") to prevent accidental reset.
- Implemented as a single PATCH with the default values, not a DELETE — so the row stays, just with default contents.

---

## 6. Cross-route Sticky Session Bar

When a Focus Session is `running` or `paused`, a thin sticky bar renders at the top of every route EXCEPT `/focus` (where the full-page session controls already cover it). The bar surfaces the same state the dashboard's `focus_session` widget shows, but app-wide, so the user is reminded a session is active even when working in `/tasks`, `/calendar`, etc.

### 6.1 Visual treatment

- **Sticky position** at the top of the viewport, above the route's main content. Height: 40px on desktop, 48px on mobile (taller for thumb hit targets).
- **Background**: subtle accent color tied to session state — green for `running`, amber for `paused`. Subtle enough not to compete with the page's own header.
- **Content** (left → right):
  - Status dot + label (`● Focus Session — running` or `❚❚ Focus Session — paused (3m 12s)`).
  - Live elapsed time (`23:45`), updated locally every second, snapped to server truth on each `/v1/focus-sessions/current` poll (5s — see `FocusSession.md` §9.6).
  - Optional task / label snippet if the session is linked to a task (truncate with ellipsis at narrow widths).
  - Quick controls on the right: `Pause` / `Resume` button + `Stop` button. These reuse the same actions as the Dashboard widget (`POST /v1/focus-sessions/{id}/pause`, `/resume`, `/end` — see `FocusSession.md` §10).
- **Click anywhere on the bar** (outside the controls) → navigates to `/focus` for the full session view.

### 6.2 Where it renders

- Visible: every route in `PROJECT.md` §8.1 **except** `/focus`.
- Suppressed: `/focus` (covered by the page), `/login` (not authenticated), any error / 404 routes if added later.
- **Not** suppressed on `/` — the minor visual redundancy with the dashboard widget is acceptable in exchange for a single global rule (and a hidden `focus_session` widget on `/` would otherwise leave the user with no in-view session control at all).

### 6.3 Polling reuse

- The bar listens to the same TanStack Query result as the Dashboard widget (`GET /v1/focus-sessions/current`, 5s poll while the tab is visible — `FocusSession.md` §9.6). No new endpoint, no extra request.
- When the polled response transitions from `running` / `paused` to `completed` / `aborted` / `null`, the bar **auto-dismisses** with a brief slide-up animation (respects `prefers-reduced-motion`). A small toast confirms ("Session ended — view summary?") with a link to `/focus/{id}`.
- Tab hidden → polling pauses (per `FocusSession.md` §9.6). The bar's elapsed timer keeps ticking locally; the next visible-tab poll snaps it to truth.

<!-- §6.4 (Interaction with auto-pause) intentionally removed — auto-pause-on-idle is not in v1. Every pause is user-triggered via the Pause button. Section number preserved to avoid cross-reference churn. -->

---

## 7. Empty States (per widget)

The user chose per-widget empty CTAs over an overarching onboarding stack. Each widget renders its own friendly empty state with a relevant CTA pointing to the action that would populate it. Below is the v1 inventory; each entry should also be documented in the owning feature spec.

| Widget            | Empty condition                                  | Empty CTA                                                                       |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `focus_session`   | No active session                                | "No session running. **Start one** to label what your attention is on." → button (same as the existing No-active-session state in `FocusSession.md` §8.1). |
| `todays_tasks`    | No dated tasks today AND no routine instances    | "Nothing scheduled for today. **Add a dated task** or **set up a routine**." → two buttons to `/tasks`. |
| `todays_activity` | No telemetry events ingested yet (any source)    | "No activity yet. **Pair a device** to start tracking." → button to `/settings#devices`. |
| `ongoing_tasks`   | No tasks with `kind = 'ongoing'`                 | "No ongoing tasks. **Add one** to track open-ended work." → button to `/tasks?kind=ongoing`. |
| `routine_chart`   | No `TaskInstance` rows ever                      | "No routine history yet. **Create your first routine** to see consistency build over time." → button to `/tasks?kind=routine`. |
| `dated_chart`     | No single-day dated tasks ever come due          | "No dated history yet. **Add a dated task** to start your consistency chart." → button to `/tasks?kind=dated`. |
| `backlog`         | `backlogCount = 0`                               | Card not rendered at all (no chrome, no CTA — see §3 and §4.1).                  |
| `memento_mori`    | Birthday not set on User profile                 | "Set your birthday in **Settings** to see your life in weeks." → button to `/settings`. |

If a feature spec already declares an empty state matching the above, that wording wins; this table is a backstop / reference.

---

## 8. Behavior

### 8.1 Inline actions

The user chose to allow only:
- **Checkbox tick / untick** in `todays_tasks`, `ongoing_tasks` (uses the same `PATCH /v1/tasks/{id}` or `PATCH /v1/task-instances/{id}` calls as `/tasks` — see `Tasks.md` §7).
- **Focus Session controls** in the `focus_session` widget AND the cross-route sticky bar (start / pause / resume / end — see `FocusSession.md` §10).

Everything else — adding a task, editing a section, changing a task's priority, viewing session history, drilling into Activity by app, opening a Memento Mori cell — navigates to the relevant route. The Dashboard stays a glance-surface.

### 8.2 Data fetching

- Each widget owns its own query keys / polling cadence. The Dashboard does not orchestrate fetching beyond mounting the widgets and letting TanStack Query's default behavior (parallel fetches, dedupe, stale-while-revalidate) do the rest.
- On mount, 8 parallel queries fire (or fewer if widgets are hidden — hidden widgets don't subscribe to their queries). TanStack Query batches automatically; no manual coordination.
- The `dashboard-prefs` query is its own; it gates the render order (the layout effect waits one tick for prefs before rendering widgets, falling back to defaults if prefs haven't resolved within 200ms — avoiding a perceptible flash of default order on slow networks).

### 8.3 Loading / error
- Per-widget skeletons during initial load (matched to final dimensions; column height doesn't jump).
- Per-widget retry banners on error.
- Customization controls remain available even if some widgets are erroring — editing prefs doesn't require widget data.

### 8.4 Optimistic updates
- Ticking a checkbox on the Dashboard optimistically updates the relevant TanStack Query cache; the same task on `/tasks` reflects the change immediately if the user navigates there (TanStack Query shares the cache).
- Starting / pausing / ending a Focus Session optimistically updates the `/v1/focus-sessions/current` cache so the bar AND the widget both reflect the new state without waiting for the 5s poll.

### 8.5 Navigation from widgets

Clicking on a widget (outside its interactive controls) navigates to its primary route:

| Widget            | Click destination                          |
| ----------------- | ------------------------------------------ |
| `focus_session`   | `/focus`                                   |
| `todays_tasks`    | `/tasks`                                   |
| `todays_activity` | `/activity`                                |
| `ongoing_tasks`   | `/tasks?kind=ongoing` (or the Ongoing panel scrolled into view) |
| `routine_chart`   | `/tasks` (Routine panel)                   |
| `dated_chart`     | `/tasks` (Dated panel)                     |
| `backlog`         | `/backlog`                                 |
| `memento_mori`    | `/life`                                    |

Clicking inside an interactive control (checkbox, button, etc.) does not navigate.

---

## 9. Data Model additions

A single new entity stores per-user dashboard preferences.

```prisma
model UserDashboardPrefs {
  userId            String   @id
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  widgetOrder       String[] // widget IDs in render order (see Dashboard.md §3)
  hiddenWidgets     String[] // subset of widgetOrder that should not render
  collapsedWidgets  String[] // subset of widgetOrder rendered with body collapsed (see §5.3)
  updatedAt         DateTime @updatedAt
}
```

### 9.1 Defaults

- No DB row is created on user signup. The server returns a default-merged response when no row exists.
- Default order is a client-shared constant (also known by the server for the default-merged response) matching §4.2.
- Default `hiddenWidgets = []`, default `collapsedWidgets = []`.

### 9.2 Merge / drop rules on read

When `GET /v1/me/dashboard-prefs` resolves, the server:
1. Loads the stored row (or treats as empty if none).
2. Filters `widgetOrder` to remove any IDs the server doesn't recognize (i.e. widgets that were retired in a later version).
3. Appends any v1-known widget IDs missing from the result to the end of `widgetOrder` (so newly-shipped widgets appear automatically).
4. Filters `hiddenWidgets` and `collapsedWidgets` to remove any unknown IDs and any IDs not present in the final `widgetOrder`.
5. Returns the merged result. The client sees a clean, consistent set every time.

### 9.3 Write semantics

`PATCH /v1/me/dashboard-prefs` accepts a partial payload (`widgetOrder?`, `hiddenWidgets?`, `collapsedWidgets?`) and upserts the row. The server validates that:
- Every ID in the payload is in the v1 known-widget set (unknown IDs → 400 with a clear error).
- `widgetOrder` contains no duplicates.
- `hiddenWidgets` and `collapsedWidgets` are subsets of `widgetOrder`.

### 9.4 Single-user note (per `PROJECT.md` §1.1)

`UserDashboardPrefs` is `userId`-keyed from day one (multi-user-ready) even though v1 ships with one user. No special handling.

---

## 10. API Surface (sketch — full shape goes in `PROJECT.md` §7)

| Method | Path                              | Purpose                                                        |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| GET    | `/v1/me/dashboard-prefs`          | Get the merged dashboard prefs for the current user (see §9.2) |
| PATCH  | `/v1/me/dashboard-prefs`          | Partial update (see §9.3)                                      |

No `POST` (the row is upserted by `PATCH`). No `DELETE` (use PATCH with default values to reset; the row stays).

No Dashboard-specific data endpoints — every widget reads from its owning feature's endpoints (`Tasks.md` §7, `TaskCharts.md` §7, `Activity.md` §6, `FocusSession.md` §10, `MementoMori.md` §7).

---

## 11. Accessibility

- **Keyboard navigation**: Tab moves focus through widget cards in render order. Inside a card, Tab continues into the card's interactive elements (checkboxes, buttons) — defined by each owning spec.
- **Skip link**: a "Skip to main content" link at the very top of the page, focusable on Tab, jumps focus past the sticky session bar to the first widget.
- **Edit mode** is keyboard-accessible:
  - Each card's drag handle is a focusable button with `aria-label="Move {widget name}"`. Activate with Space → arrow up/down to reorder → Space again to drop.
  - The eye toggle is a `<button aria-pressed={hidden}>` with `aria-label="{Hide|Show} {widget name}"`.
  - Tab order respects the visual order of cards (including hidden / dimmed cards during edit mode).
- **Sticky session bar**: announced via `role="status"` on state transitions (e.g. session ends → bar slides out with an accompanying status message). Controls (`Pause`, `Stop`) are standard buttons with `aria-label`s.
- **Reduced motion**: bar slide-in/out animations and edit-mode card transitions respect `prefers-reduced-motion: reduce` (instant transitions instead of animated).
- **Color** is never the sole indicator on the session bar — the state label and icon (`●` for running, `❚❚` for paused) carry the same information.
- **Empty-state CTAs** are real `<button>` or `<a>` elements with descriptive text — no icon-only buttons.

---

## 12. Mobile / Responsive

The user chose fully responsive — every widget designed to be usable on phone-sized screens, not just desktop.

### 12.1 Column behavior
- The single-column stack is identical at every viewport size. The column simply narrows to fit, with side padding scaling (16px mobile, 24px tablet, 32px desktop).
- Max-width 960px on desktop keeps line lengths readable; mobile fills the viewport minus padding.
- No layout reflow as the viewport changes width — only the widgets' internals reflow.

### 12.2 Widget responsibilities (cross-references)

Each owning spec is responsible for declaring how its widget responds to narrow viewports. Below is a v1 checklist of what each widget needs to handle on phone-sized screens (~360px wide). Items marked **TBD** need their owning spec updated.

| Widget            | Mobile behavior to spec                                                                                | Status               |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------- |
| `focus_session`   | Timer dial scales down; controls remain min 44pt touch targets                                          | TBD in `FocusSession.md` |
| `todays_tasks`    | List items wrap at narrow widths; checkbox / title / priority badge stay aligned                        | TBD in `Tasks.md`        |
| `todays_activity` | "Top 3 apps + top 3 sites" stack vertically instead of side-by-side; hourly silhouette scales to width | TBD in `Activity.md`     |
| `ongoing_tasks`   | Same wrapping rules as `todays_tasks`                                                                   | TBD in `Tasks.md`        |
| `routine_chart`   | Recharts is responsive by default; reduce x-axis label density on narrow widths                         | TBD in `TaskCharts.md`   |
| `dated_chart`     | Same as `routine_chart`                                                                                 | TBD in `TaskCharts.md`   |
| `backlog`         | Badge + priority stripe scale down; remain tappable                                                     | TBD in `Tasks.md`        |
| `memento_mori`    | Current-week row may wrap to two lines at very narrow widths (26 + 26 cells); minimum cell size 6px    | TBD in `MementoMori.md`  |

### 12.3 Sticky session bar on mobile
- Taller (48px vs 40px) for thumb-friendly hit targets.
- Quick controls remain visible; the optional task/label snippet truncates first when space is tight.
- The status dot + label stays leftmost; controls stay rightmost; the elapsed time stays center.

### 12.4 Touch / hover
- All hover-only affordances (e.g. chart tooltips) gain a tap-to-show fallback on touch devices. Owning feature specs should document this where relevant.
- Drag-and-drop in edit mode uses pointer events (works for mouse, touch, and pen via `@dnd-kit/core`).

---

## 13. Dependencies

- **All feature specs** (`Tasks.md`, `Calendar.md`, `MementoMori.md`, `FocusSession.md`, `Activity.md`, `TaskCharts.md`) — each contributes one or more widgets. Changes there are reflected here automatically (single source of truth — see §3).
- **`@dnd-kit/core`** — **new dependency for v1**. Used for drag-to-reorder in edit mode and on the Settings panel. Chosen because:
  - Small (~10kb gzipped, modular packages).
  - Fully accessible (keyboard nav, screen reader announcements out of the box).
  - Touch / pointer / mouse / keyboard all unified.
  - Modern API, actively maintained.
  - Alternative considered: `@hello-pangea/dnd` (formerly `react-beautiful-dnd`) — more mature but larger and not as accessible by default. Defer to v2 if `@dnd-kit/core` is insufficient.
- **TanStack Query** (already in `PROJECT.md` §2.1) — for all widget data + the prefs query.
- **TanStack Router** (already in `PROJECT.md` §2.1) — for the click-to-navigate behavior in §8.5.
- **Zustand** (already in `PROJECT.md` §2.1) — for edit-mode local state (which widget is being dragged, etc. — not persisted).
- **Settings page** (`Features Markdown/Settings.md` §4.3) — hosts the mirror customization UI (see §5.2 entry point B). Both edit surfaces (inline on `/` and Settings → Dashboard) PATCH the same `/v1/me/dashboard-prefs` endpoint and share TanStack Query invalidation.

---

## 14. Open Questions / TODOs

- **Edit-mode entry button placement.** A top-of-page `Customize` button is the obvious place, but where exactly — left of the page title, right? An icon-only `⚙` button? Decide during component design.
- **Per-widget settings.** Some widgets have settings the user may want to tweak from a single place (e.g. routine-chart default range — 30 or 90 days; today's-activity top-N — 3 or 5). v1 keeps these in each owning feature's `/settings` section, not on the Dashboard itself. Revisit if "I want to configure my dashboard widgets" becomes a real user task.
- **All-hidden state UX.** §4.3 says the dashboard shows a "Your dashboard is empty" message when every widget is hidden. Should `Customize dashboard` instead auto-open edit mode from that state? Yes, leaning toward auto-open.
- **`UserDashboardPrefs` cascade on user delete.** Spec uses `onDelete: Cascade` (v1 has one user so it's moot). When multi-user is real, cascade is correct since prefs have no value detached from a user.
- **Mobile responsiveness for the Memento Mori strip.** A 52-cell row at minimum 6px cells = 312px, which fits in a 360px viewport. But cells at 6px lose all internal markers (session overlay, milestone icons). Two-row wrapping (26 + 26) gives roughly 13px cells but visually breaks the "current week's row" framing. Owning spec (`MementoMori.md`) should resolve this — probably "single row at all widths, scrolls horizontally if needed."
- **Sticky bar interaction with Tasks.md transfer toast.** When a dated task transfers at end of day (via the nightly job), the next-day dashboard load typically shows a one-time toast ("3 tasks transferred from yesterday"). Should that toast share UI space with the sticky session bar if both are present? Currently the toast lives at bottom-right (Sonner default), bar at top — no conflict. Document the rule: bar at top, transient toasts at bottom-right, persistent banners (Settings warnings, version updates) inline below the bar.
- **Reset prompt phrasing.** "Reset dashboard to default? This will undo your customizations." — fine for v1; revisit if users actually run into "I accidentally reset and now I lost my collapse states."
- **Adding a 9th+ widget post-v1** — process in §3 notes the two steps but doesn't say where the v1 known-widget set lives. Recommendation: a single constant in `packages/shared` (the existing shared TS package per `PROJECT.md` §12.7) so server, web, and Settings UI all agree.
- **Whether `collapsedWidgets` should be local UI prefs after all.** It's the lightest of the three states and arguably shouldn't follow a user across devices. Counterargument: consistency — all dashboard preferences in one place. Defer; ship as server-persisted, revisit if it feels heavy.
