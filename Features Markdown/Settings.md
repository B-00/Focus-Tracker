# Focus Tracker — Settings (Feature Spec)

> User preferences, account controls, paired devices, and diagnostics. Lives at `/settings` with a left-rail tab layout and `#anchor` deep-links per section. Hosts the mirror UIs for several other features (dashboard customization, auto-pause on idle, milestones management).

**Status:** Specification in progress. v1 first batch (see `PROJECT.md` §6).

---

## 1. Overview

`/settings` is the single Settings surface in the web app. It collects every user preference, account control, and lightweight ops view into one route, organised by a left-rail of categories. Each category has a deep-linkable `#anchor` so other surfaces can drop the user directly into the right panel (e.g. the Dashboard's "Set your birthday" empty-state CTA links to `/settings#profile`).

Settings does not own any *new* feature behavior — it's the place where preferences for behavior owned elsewhere get edited, plus a few operational read-only views (Diagnostics, API base URL display). Each section cross-references its owning feature spec for the actual semantics.

### What Settings is NOT
- An admin console — single-user, no role / user management UI.
- A categorization manager — per-app / per-domain category rules are out of v1 (see `Activity.md` §2 Non-Goals and §9 Open Questions).
- A theme / appearance toggle — light/dark and other appearance tweaks are out of v1 (see `PROJECT.md` §6.1).
- An import / export hub — data portability is deferred to v2.

---

## 2. Goals & Non-Goals

### Goals
- One discoverable place for every preference. No "Settings sprinkled across feature routes."
- Mirror surfaces for preferences that are *also* editable inline elsewhere (Dashboard layout) so the user has both flows.
- Surface paired-device management and the 6-digit pairing flow — the only place a user can pair / revoke a source client.
- Give an honest diagnostics view so the user can self-service "why doesn't my activity show up?" type questions without reading server logs.

### Non-Goals (v1)
- Multi-user features (no roles, no invites, no SSO config).
- Theme / appearance toggle.
- App-level keyboard shortcut customization.
- Localisation / language selection (en only; no string externalisation work in v1).
- A separate "Privacy Centre" / GDPR-style data control panel (single-user local-first per `PROJECT.md` §1.1; out of scope for v1).
- Profile picture / avatar.
- Notification preferences (no in-app notifications in v1).

---

## 3. Page Structure

### 3.1 Left-rail tabs + `#anchor` deep-links

`/settings` is a single route with a fixed left-rail listing six categories. Clicking a category scrolls/swaps the right pane to that section AND updates the URL hash. Loading `/settings#devices` directly lands the user on the Devices section without an extra click.

```
┌──────────────────────────────────────────────────────────────┐
│ Settings                                                     │
├──────────────┬───────────────────────────────────────────────┤
│ • Profile    │  Profile                                      │
│ ▸ Memento M. │  ─────────────────────────────────────────    │
│ ▸ Dashboard  │  Display name  [____________]                 │
│ ▸ Devices    │  Email         someone@example.com (read-only) │
│ ▸ Telemetry  │  ...                                          │
│ ▸ About      │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

- Left rail is sticky on scroll (desktop). On mobile / narrow viewports it collapses into a horizontal scrollable strip above the content (see §10 Mobile).
- The active category is visually marked (filled accent dot, bold label). Keyboard nav: Up/Down arrows move within the rail; Enter/Space activates.
- Hash deep-links use kebab-case IDs matching the section IDs in §4: `#profile`, `#memento-mori`, `#dashboard`, `#devices`, `#telemetry`, `#about`.
- Default landing tab (when navigating to `/settings` with no hash): **Profile**.
- Hash updates use `history.replaceState` (not `pushState`) so the back button doesn't get cluttered by tab switches.

### 3.2 Section header bar

Each section has a header bar with:
- Section title and a one-line description.
- A "last saved {timestamp}" indicator if any auto-save has happened in this session (see §5).
- For sections with explicit Save / Discard buttons (§5), those buttons live in a sticky footer of the right pane, visible only when the section is dirty.

---

## 4. Sections (the inventory)

Eight sections in v1, each with an `#anchor` ID.

### 4.1 `#profile` — Profile

User identity, the values Memento Mori needs, timezone, password, sign-out.

| Field                              | Type / control                                       | Save semantics              | Source / notes                                                                                  |
| ---------------------------------- | ---------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| Display name                       | Text input                                           | Explicit Save               | `User.displayName`. Used in greeting / future UI; defaults to email local-part on first signup.  |
| Email                              | Read-only text                                       | n/a                         | `User.email`. v1 doesn't support email change; defer to v2.                                      |
| Password change                    | Form: current password + new + confirm + "Sign out all other devices" checkbox (default ✓) | Explicit Save (own button)  | Calls `POST /v1/me/password` (see §7 and `Auth.md` §4.7). Re-verifies current password; `signOutOtherDevices: true` (the default) revokes every refresh-token row except this device's. argon2id strength validation per `Auth.md` §7.2 (min 8 chars; `zxcvbn` strength indicator). |
| Birthday                           | Date picker                                          | Explicit Save               | `User.birthday`. **Required for Memento Mori to render** (see §4.2 / `MementoMori.md` §3.3).      |
| Life expectancy (years)            | Number input (default 80, min 1, max 130)            | Explicit Save               | `User.lifeExpectancyYears`. Drives Memento Mori grid extent (see `MementoMori.md` §3.3).          |
| Timezone                           | Dropdown of IANA timezones                           | Auto-save                   | `User.timezone`. Auto-detected from `Intl.DateTimeFormat().resolvedOptions().timeZone` on first login; this field shows the current value and lets the user override. See §4.1.1. |
| Sign out                           | Primary button + secondary "Sign out everywhere" link below | Action                      | Primary: `POST /v1/auth/logout` (revokes this device's refresh-token row only). Secondary: `POST /v1/auth/logout-all` (revokes every row for this user; use after suspected leak). Both clear localStorage and redirect to `/login`. See `Auth.md` §4.6 for revocation semantics; other tabs in the same browser fail their next refresh and redirect to `/login` on their own (no multi-tab sync in v1). |

#### 4.1.1 Timezone auto-detect + override

- On first login (or first time the User row has `timezone = null`), the web app POSTs the browser's detected timezone to `PATCH /v1/me/profile` as a transparent backfill. The user sees the detected value already populated.
- Editing the dropdown in Settings sets a flag `User.timezoneOverridden = true`. Once set, the auto-detect logic no longer runs on subsequent logins.
- A small inline hint when `timezoneOverridden = false`: *"Auto-detected from this browser. Pick a different timezone to override."*
- A small inline hint when `timezoneOverridden = true`: *"You've overridden the auto-detected timezone. [Revert to auto-detect]"* — clicking Revert clears the override and re-detects on next login.

### 4.2 `#memento-mori` — Memento Mori

Milestones management + read-only display of the inputs that drive the grid (which actually live in Profile).

- **Inputs preview** (read-only summary at the top): `Born: 1990-01-01 · Life expectancy: 80 years · You are in week 1,742 of 4,160 (41.9% lived)`. A small `Edit in Profile` link jumps to `/settings#profile`. If birthday is unset, the preview is replaced with an empty-state CTA: `Set your birthday in Profile to see your life calendar.` (links to `/settings#profile`).
- **Milestones list** — a sortable list (by date), each row showing:
  - Icon swatch (colored circle with milestone glyph)
  - Label
  - Date (relative: "Past · 3 years ago", "Future · in 5 years")
  - `Edit` / `Delete` icon buttons
- **Add milestone** button → opens an inline form OR a modal (component decision; see §11): label, date, color picker, icon picker. On save, POSTs to `/v1/milestones` (see `MementoMori.md` §7). Each create / edit / delete is its own atomic auto-save action.
- Each milestone CRUD action invalidates the `/v1/milestones` query so the Memento Mori grid (if open in another tab) sees the change on next focus.

This section is the **single management surface** for milestones — the `/life` page can also open a milestone editor inline (per `MementoMori.md` §5.4) but the canonical "list of all my milestones" lives here.

### 4.3 `#dashboard` — Dashboard customization (mirror)

Mirrors the inline edit mode on `/` (see `Dashboard.md` §5.2 entry point B). Same backing data (`UserDashboardPrefs`), same widget set, equivalent interactions in a list-form layout suited to mouse / keyboard / screen reader users who prefer it over the inline drag mode.

Layout:
- A vertical list of all known widgets in current `widgetOrder` order.
- Each row: drag handle (left) · widget name · short description · hide/show toggle (right).
- Hidden widgets are dimmed; not removed from the list.
- A `Save layout` button (explicit save — see §5) activates when the order is dirty. Hide/show toggles auto-save individually.
- A `Reset to default` button at the bottom of the section with a confirmation modal (matching the inline mode's reset; same wording — see `Dashboard.md` §5.4).
- A small inline hint: *"You can also reorder widgets directly on the dashboard \u2014 [Customize on dashboard]"* (link to `/?edit=dashboard` query param, which auto-enters Dashboard's inline edit mode on mount).

State stays in sync with the inline mode via TanStack Query — a PATCH from either flow invalidates the `dashboard-prefs` query.

### 4.4 `#devices` — Paired devices

The single management surface for device pairing and revocation (per `PROJECT.md` §12.3).

Top of the section:
- A `Pair new device` button — opens a modal containing a single 6-digit code input field. The user obtains the code from their extension or desktop app (which is what calls `POST /v1/devices/pairing-codes`; see `Auth.md` §5.1), types it into the modal, and clicks Pair. The web app calls `POST /v1/devices/pairing-codes/{code}/claim` with the user's JWT (the JWT is what binds the device to *this* user). On success the modal closes and the new device appears in the list below with a brief highlight.
- The modal shows:
  - A short paragraph: *"Open the Focus Tracker extension or desktop app and click 'Pair this device' to get a 6-digit code."*
  - The 6-digit code input — `inputMode="numeric"`, `maxLength=6`, digits-only mask.
  - The set of possible errors from the claim call, surfaced inline above the Pair button: `pairing_code_invalid` → "That code wasn't recognized. It may have expired (codes are valid for 5 minutes). Get a fresh code from your device and try again." `pairing_code_already_claimed` → "That code has already been used to pair another device."
  - A `Cancel` button (also Escape to close).
  - The device, once paired, won't show activity in the list until it polls its API key and starts ingesting. This is normal — `lastSeen` will read "Never" until the first authenticated request.
- A short inline reminder of the API base URL (with a `[Copy]` button) — same content as the §4.5 Telemetry section's display, surfaced here because users almost always need it during pairing setup.

Below: the list of paired devices. Each row shows:
- Device label (auto-generated: `{Browser} on {OS}` or `{Hostname}` — desktop apps set this from their environment when pairing).
- Source type icon: 🌐 browser / 🖥️ desktop.
- `lastSeen` (relative time: "2 minutes ago", "3 days ago", "Never").
- `clientVersion`.
- A `Revoke` button (with confirmation modal — *"Revoke {device}? It will stop sending data until paired again."*). Confirmed revocation calls `DELETE /v1/devices/{deviceId}` (see `PROJECT.md` §12.6).
- An expandable detail row (click chevron) reveals: device ID, paired at, **last successful ingest** (relative time; "Never" if no batch has been accepted yet). A device whose `lastSuccessfulIngestAt > 24h ago` shows a small ⚠ pill next to its row ("No recent ingest"). This is the entirety of the v1 ops view — no separate Diagnostics tab in v1; the per-device sync info lives here on the same screen the user already visits to manage devices.

Empty state: *"No devices paired yet. Pair your first device above to start tracking."* with prominent `Pair new device` button.

This section also resolves the `PROJECT.md` §12.8 question about how the server tracks "last seen" — `Device.lastSeen` bumps on any authenticated request, `Device.lastSuccessfulIngestAt` bumps only on non-empty accepted batches. See §6.2 below for the schema.

### 4.5 `#telemetry` — Telemetry

A single read-only panel for v1.

**API base URL.** Read-only display showing the URL the source clients should be configured to talk to. Default: `http://localhost:3000`; configurable via the API's own env config and surfaced here for the user to copy.

- Display: `{URL}` in a monospace pill + `[Copy]` button.
- A short note: *"Paste this into your extension and desktop app when pairing. The clients are not bound to a fixed origin (see `PROJECT.md` §12)."*
- No edit affordance here — the URL is a property of the deployment, not the user's profile.

That's it for v1. Capture controls (which apps/domains get sent to the server at all) live inside the extension and desktop app themselves — see `Sources Markdown/Extension.md` and `Sources Markdown/DesktopApp.md`. There is no display-side filter on the web app in v1.

### 4.6 `#about` — About

Minimal v1 informational panel:
- App version (from build metadata: git short hash + semver).
- Server version (from API health endpoint).
- Link to the project's README / spec folder (relative link to the repo root).
- Open-source / license note (TBD by user later).
- A `Reset all preferences to defaults` button at the bottom (extreme caution — confirmation modal; resets Dashboard prefs and the timezone-override flag; does **not** delete milestones, devices, or any user data). Useful for "I customized too much, start over."

---

## 5. Save Semantics (mixed model)

Per the shaping decision, controls fall into three save categories. The right pane's behavior depends on which categories its controls use.

| Category                                  | Behavior                                                                                                                            | Used in                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Auto-save** (toggles, dropdowns)         | PATCH fires on change. Small inline `Saved ✓` indicator next to the control fades after 2s. Network error → toast + revert local state. | Timezone (§4.1), Dashboard hide/show toggles (§4.3).                                          |
| **Explicit Save** (text, date, number, password) | The section has a sticky footer with `Save changes` + `Discard changes` buttons that activate when any field is dirty. Save → PATCH → success toast / inline; Discard → revert to last loaded values. Navigating away (incl. tab switch) with unsaved changes shows a confirm dialog ("Discard unsaved changes?"). | Display name, password change, birthday, life expectancy (§4.1); Milestone label / date / color / icon during create or edit (§4.2). |
| **Drag-reorder explicit Save** (single specialised case) | The Dashboard section's `Save layout` button activates when the widget order has changed; clicking PATCHes the new `widgetOrder`. Reset to default is a separate immediate-action button with its own confirmation. | Dashboard widget reorder (§4.3). |

Atomic list operations (add a milestone, revoke a device, delete a milestone) are auto-saved as their own single-action requests, never batched into the "explicit Save" flow.

### 5.1 Dirty-state indicators

- Explicit-save fields show a small accent dot next to their label when their value differs from the last loaded value.
- The section's `Save changes` button is disabled when there are no dirty fields; primary-styled when there are.
- The Settings header bar shows a global "Unsaved changes" pill if any section in the current view has dirty fields.

### 5.2 Optimistic updates

- Auto-save controls update local TanStack Query cache optimistically; on error, the cache is reverted AND a toast appears.
- Explicit-save forms hold dirty state locally (React state) and only update the cache after a successful PATCH response.

### 5.3 Conflict handling

- Server returns updated timestamps; client compares against last-known. v1 is single-user so conflicts are extremely rare (only possible across two open tabs editing the same field simultaneously). Last-write-wins; on detecting a conflict the affected field shows an inline warning *"Updated in another tab; latest value re-loaded."* and re-renders with the server value.

---

## 6. Data Model additions

### 6.1 New fields on `User`

```prisma
model User {
  // ...existing fields (email, passwordHash — see Auth.md §10.1)...
  displayName          String
  birthday             DateTime?    @db.Date
  lifeExpectancyYears  Int          @default(80)
  timezone             String?      // IANA tz name; null until first detected
  timezoneOverridden   Boolean      @default(false)
}
```

Cross-references:
- `birthday`, `lifeExpectancyYears` — drive `MementoMori.md` grid extent.
- `timezone`, `timezoneOverridden` — drive `Tasks.md` §5.5 nightly job timezone + every "today" computation.

### 6.2 Extended fields on `Device`

```prisma
model Device {
  // ...existing fields per PROJECT.md §5 entities...
  label                  String         // user-facing name; defaults from the device on pair
  lastSeen               DateTime?      // any authenticated request bumps this
  lastSuccessfulIngestAt DateTime?      // only non-empty accepted batches bump this
  clientVersion          String?        // last reported value
}
```

`lastSeen` and `lastSuccessfulIngestAt` are written by the server on every authenticated request / ingest. They drive the Devices §4.4 list (the expandable detail row shows both).

### 6.3 No new entities for milestones or dashboard prefs

- `Milestone` already in `PROJECT.md` §5 / `MementoMori.md` §7.
- `UserDashboardPrefs` already in `Dashboard.md` §9 / `PROJECT.md` §5.

Settings reads/writes those existing entities; no new server-side tables are introduced by this spec.

---

## 7. API Surface (sketch — full shape goes in `PROJECT.md` §7)

| Method | Path                                              | Purpose                                                                                                                  |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/me/profile`                                  | Returns User profile fields (displayName, email, birthday, lifeExpectancyYears, timezone, timezoneOverridden)             |
| PATCH  | `/v1/me/profile`                                  | Partial update of any profile field. Validates IANA timezone format if `timezone` is set                                  |
| POST   | `/v1/me/password`                                 | Change password: `{ currentPassword, newPassword, signOutOtherDevices, refreshToken }`. Verifies current via argon2id; returns 401 on mismatch. See `Auth.md` §4.7. |
| POST   | `/v1/auth/logout`                                 | Revoke the supplied refresh-token row ("this device"). See `Auth.md` §4.6.                                                |
| POST   | `/v1/auth/logout-all`                             | Revoke every refresh-token row for the user ("everywhere"). See `Auth.md` §4.6.                                           |
| GET    | `/v1/devices`                                     | (already exists per `PROJECT.md` §12.6) — driver of §4.4                                                                  |
| POST   | `/v1/devices/pairing-codes`                       | (already exists per §12.6) — initiates the pair flow                                                                      |
| GET    | `/v1/devices/pairing-codes/{code}`                | (already exists per §12.6) — Settings polls this every 2s while the pairing modal is open                                  |
| DELETE | `/v1/devices/{deviceId}`                          | (already exists per §12.6) — revoke action                                                                                |
| GET    | `/v1/milestones`                                  | (already exists per `MementoMori.md` §7) — drives §4.2 list                                                                |
| POST   | `/v1/milestones`                                  | (already exists)                                                                                                          |
| PATCH  | `/v1/milestones/{id}`                             | (already exists)                                                                                                          |
| DELETE | `/v1/milestones/{id}`                             | (already exists)                                                                                                          |
| GET    | `/v1/me/dashboard-prefs`                          | (already exists per `Dashboard.md` §10) — drives §4.3                                                                      |
| PATCH  | `/v1/me/dashboard-prefs`                          | (already exists)                                                                                                          |

No `/v1/diagnostics` endpoint — `lastSeen` / `lastSuccessfulIngestAt` ride along with `GET /v1/devices`. Privacy controls live entirely inside the source clients (see `Sources Markdown/Extension.md` and `Sources Markdown/DesktopApp.md`).

---

## 8. Behavior

### 8.1 Initial load

- On mount, fetch in parallel:
  - `/v1/me/profile` (drives §4.1)
  - `/v1/milestones` (drives §4.2)
  - `/v1/me/dashboard-prefs` (drives §4.3)
  - `/v1/devices` (drives §4.4)
- Each section renders its own skeleton during its individual query's loading state. The left rail renders immediately with all tabs visible.

### 8.2 Hash-driven section switch

- `hashchange` event listener swaps the right pane; if the user has unsaved explicit-save fields in the current section, a confirm dialog appears before navigating.
- Direct visits to `/settings#devices` etc. respect the hash on mount; if the hash isn't a known section, fall back to `#profile`.

### 8.3 Polling

- Pairing modal polls `/v1/devices/pairing-codes/{code}` every 2s while open (per §4.4).
- The `/v1/devices` query (which now also surfaces `lastSeen` / `lastSuccessfulIngestAt`) refetches when the Devices tab gains focus. No interval polling — visiting the tab is enough.
- No other settings poll — preferences are write-mostly.

### 8.4 Cross-feature invalidations

- `PATCH /v1/me/profile` invalidates: the `dashboard-prefs` query (in case Memento Mori's empty state was showing on the dashboard and now resolves), the Memento Mori grid (`/v1/me/profile` is its data source for birthday + life expectancy).
- `POST/DELETE` on `/v1/milestones` invalidates `/v1/milestones` (covers `/life` view).
- `PATCH /v1/me/dashboard-prefs` invalidates dashboard widgets' query (in case a hidden widget is shown again).
- `DELETE /v1/devices/{id}` invalidates `/v1/devices` AND the `todays_activity` widget (in case the revoked device was the sole source of data).

---

## 9. Accessibility

- Left-rail is a `<nav>` with `aria-label="Settings categories"`. Each item is a button or link with `aria-current="page"` when active.
- Each right-pane section is a `<section aria-labelledby="{section}-heading">`. Headings are real `<h2>` elements for screen-reader landmarks.
- Form controls all have associated `<label>`; error messages use `aria-describedby` linking to the explanation.
- Auto-save `Saved ✓` indicator is `aria-live="polite"` so screen readers announce it without interrupting.
- Confirmation modals use focus trapping (existing Radix Dialog from shadcn/ui per `PROJECT.md` §2.1) and `aria-labelledby` / `aria-describedby`.
- Drag handles in §4.3 (Dashboard) are keyboard-accessible per `Dashboard.md` §11 (the same `@dnd-kit/core` keyboard model — Space to pick up, arrows to move, Space to drop).
- All buttons have visible focus rings (default Tailwind ring utilities).
- Color is never the sole indicator (e.g. "no recent ingest" ⚠ pills carry text labels, not just color).

---

## 10. Mobile / Responsive

The user chose full responsiveness app-wide (per Dashboard.md). Settings handles narrow viewports as follows.

### 10.1 Left-rail behavior
- **Desktop (≥ 1024px)**: sticky left rail (240px wide) + content right (fills the rest).
- **Tablet (768–1024px)**: left rail shrinks to icon-only (40px wide) with text tooltips on hover; can be expanded by clicking a hamburger toggle.
- **Mobile (< 768px)**: left rail becomes a horizontal scrollable strip pinned to the top of the content area; active section highlighted; tapping a tab swaps the content below.

### 10.2 Form layouts
- Multi-column form fields collapse to single-column stacks below 640px.
- The sticky `Save changes` / `Discard changes` footer (for explicit-save sections) shifts to a bottom-of-viewport bar on mobile (above safe-area inset).
- The Devices list (§4.4) becomes vertical card stacks below 640px — each device gets its own card with stacked label-value rows.

### 10.3 Pairing modal on mobile
- Full-screen on mobile instead of centered modal (more room for the large 6-digit code and instructions).
- The code uses a large, finger-readable monospace font.

### 10.4 Touch targets
- All interactive elements ≥ 44pt hit area on touch devices (per WCAG / Apple HIG).

---

## 11. Dependencies

- **All feature specs** referenced by Settings sections (`MementoMori.md`, `Dashboard.md`, `Activity.md`, `Auth.md`, `Sources Markdown/Extension.md`, `Sources Markdown/DesktopApp.md`). Source-of-truth rule: Settings hosts the **edit UI**; each feature's spec defines the **semantics** of the value being edited.
- **`@dnd-kit/core`** (already added to `PROJECT.md` §2.1 by Dashboard spec) — used in §4.3 Dashboard customization mirror.
- **React Hook Form + Zod** (already in `PROJECT.md` §2.1) — used for all explicit-save forms (§4.1 password change, birthday, life expectancy; §4.2 milestone create/edit).
- **shadcn/ui** components (already in `PROJECT.md` §2.1): Tabs (for left rail on tablet+), Dialog (for confirm modals + pairing modal), Form, Input, Switch (toggles), Select, Calendar (date picker for birthday).
- **TanStack Query** for all data fetches + cross-section invalidation per §8.4.
- **`Intl.DateTimeFormat().resolvedOptions().timeZone`** (browser built-in) for the timezone auto-detect path (§4.1.1).
- **IANA timezone list** — bundled (likely as a static constant generated from `@vvo/tzdb` or similar; defer the exact library choice).

---

## 12. Open Questions / TODOs

- **Milestone editor: inline expanding row vs modal.** §4.2 leaves this as a component-design choice. Modal is safer for the date picker; inline is faster for simple edits. Probably modal in v1.
- **`timezoneOverridden` cleanup on revert.** When the user clicks "Revert to auto-detect" in §4.1.1, the flag clears but the existing `timezone` value stays until the next login re-detects. Acceptable; document if confusing.
- **"Never ingested" hint on Devices rows (§4.4).** When a device has never ingested, `lastSuccessfulIngestAt = null`; show "Never" with a small troubleshooting hint (re-pair, check outbox). Wire up once Extension.md / DesktopApp.md grow a troubleshooting section.
