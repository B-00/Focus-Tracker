# Focus Tracker — Activity (Feature Spec)

> The always-on telemetry viewer. Shows what your devices have been doing — app and site usage — independent of Focus Sessions.
> Lives at `/activity` (dedicated route) and as a compact "Today's activity" widget on the dashboard.

**Status:** Specification in progress. v1 first batch (see `PROJECT.md` §6).

---

## 1. Overview

The browser extension and desktop app send telemetry events **continuously**, regardless of whether a Focus Session is active (see `Sources Markdown/Extension.md`, `Sources Markdown/DesktopApp.md`, and `FocusSession.md` §1). The Activity feature is the surface for that always-on stream — it shows the user "what did my time actually go to" *today*, *this week*, etc., without needing them to explicitly start a session first.

Focus Sessions and Activity are complementary, not redundant:
- **Activity** = the unfiltered picture. Every event lives here.
- **Focus Sessions** = a labeled slice. Events stamped with a `focusSessionId` show what happened during intentional deep-work windows.

Most users will glance at Activity daily (passive consumption) and start Focus Sessions occasionally (active commitment).

---

## 2. Goals & Non-Goals

### Goals
- Answer "where did my day go?" at a glance, without needing to start a session.
- Surface both apps (desktop source) and sites (browser source) side-by-side.
- Stay reasonably live — recent activity should be visible within minutes of it happening, not the next day.
- Be useful even if no Focus Session has ever been started.

### Non-Goals (v1)
- Quality scoring / "focus score" per app or site (e.g. labeling YouTube as "distraction").
- Goal-setting ("max 30m/day on Reddit") or limits / blocking.
- Manual time entries (the user can't add or edit telemetry events; the data is what the sources captured).
- Tagging apps/sites into categories (productivity vs leisure). Defer to v2.
- Comparison views (this week vs last week side-by-side). Today's totals + a simple weekly bar is enough for v1.
- Sharing or exporting (defer).
- Notifications ("you've been on X for 1h"). Out of scope.

---

## 3. Concepts

### 3.1 Activity event

For UI purposes, an "activity event" is a single `TelemetryEvent` row as ingested by `PROJECT.md` §12.5 — regardless of `focusSessionId` (null or not). Activity views read all telemetry events for the current user, period.

Shape (from the shared schema; see `PROJECT.md` §12.5 — paraphrased):

| Field             | Notes                                                              |
| ----------------- | ------------------------------------------------------------------ |
| `id`              | uuid                                                               |
| `userId`          | uuid (always the single user, in our scope)                        |
| `source`          | `'extension' \| 'desktop'`                                         |
| `kind`            | e.g. `'site_visit'`, `'app_focus'`                                 |
| `target`          | `domain` for extension events; `appName` / `windowTitle` for desktop |
| `startedAt`       | timestamptz                                                        |
| `endedAt`         | timestamptz?                                                       |
| `durationMs`      | int? (computed or sent by source)                                  |
| `focusSessionId`  | uuid? (null if no session was active when this happened)           |
| `deviceId`        | uuid (which Device sent it)                                        |

Idle periods are not represented by events in v1 — source clients perform internal idle detection purely to bound the `endedAt` of in-flight `focus_change` events (see `Sources Markdown/Extension.md` §6.1 and `Sources Markdown/DesktopApp.md` §7.1). The Activity view sees idle time as simple absence of data in the affected minute buckets.

### 3.2 Aggregations

Activity is rendered from a single rollup, computed server-side and refreshed on a short cadence:

| Rollup                          | Grain    | What it stores                                                  | Refresh cadence                                |
| ------------------------------- | -------- | --------------------------------------------------------------- | ---------------------------------------------- |
| **`activity_minute_rollup`**    | 1 minute | `(userId, source, target, minuteBucket) → durationMs`           | On each ingest batch; cheap upsert per event   |

Hour, day, and week views are computed on demand at read time via SQL aggregation over the minute table (e.g. `SUM(durationMs) GROUP BY date_trunc('hour', minuteBucket)`). The minute grain is fine enough that on-demand aggregation is cheap for personal-scale data volumes; no separate `hour` or `day` rollup tables in v1.

Downstream consumers — Memento Mori's weekly shading (`MementoMori.md` §4.2), the Dashboard `todays_activity` widget, and the per-source totals in `/activity` — all aggregate from this single table at read time.

This table lives in the same Postgres database as the raw events; no separate analytics store in v1.

---

## 4. Surfaces

### 4.1 `/activity` — dedicated route

The main view. Layout:

```
┌──────────────────────────────────────────────────────────────┐
│ Activity                                  [ Today ▾ ] [⟳]    │  ← range selector, manual refresh
│ Total active: 4h 32m  ·  apps: 2h 51m  ·  sites: 1h 41m      │  ← top summary band
├──────────────────────────────────────────────────────────────┤
│ HOURLY BREAKDOWN                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ ▓▓░░▓▓▓▓████▓▓▓░░░░▓▓████▓▓▓▓▓▓░░░░░░░░░░               │ │  ← stacked bar per hour
│  │ 0  2  4  6  8  10 12 14 16 18 20 22                      │ │     (apps + sites color-coded)
│  └─────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ TOP APPS (desktop)                  TOP SITES (browser)       │
│  Cursor          1h 48m              github.com      52m      │
│  Slack             34m               news.ycombinator 18m     │
│  Chrome            21m               youtube.com     15m      │
│  …                                   …                        │
├──────────────────────────────────────────────────────────────┤
│ RECENT SWITCHES (last 30 events)                             │
│  14:32  →  Cursor                                            │
│  14:18  →  github.com / pull/123                             │
│  14:11  →  Cursor                                            │
│  …                                                            │
└──────────────────────────────────────────────────────────────┘
```

Range selector options (`Today` is the default):
- `Today` — midnight (local) to now.
- `Yesterday` — full local day.
- `Last 7 days` — rolling.
- `Last 30 days` — rolling.
- `Custom range…` — date-picker (deferred to a later v1 iteration if time-boxed).

Behaviors:
- The page polls for fresh data every **60 seconds** while the tab is visible (paused on `visibilitychange`). No WebSocket in v1 (consistent with `PROJECT.md` §2.2).
- Manual refresh button forces an immediate refetch.
- Empty state for a brand-new account ("Once your extension or desktop app sends data, it'll show here. Pair a device in Settings.") with a link to `/settings`.
- "Recent switches" is the only raw-event surface in v1 — useful for "what was I just doing five minutes ago?" Capped at the last 30 events to keep payload small.

### 4.2 Dashboard widget — "Today's activity"

A compact panel on `/` showing:
- Total active time today (apps + sites combined).
- Top 3 apps, top 3 sites (with `→ /activity` link).
- A miniature hourly bar (no axis labels, just the silhouette of the day so far).
- Updates every 60s while the dashboard is open.

### 4.3 Not its own thing on `/calendar` or `/life`

`/calendar` and `/life` keep their existing roles — they consume *session-derived* aggregates only (see `Calendar.md` and `MementoMori.md`). Raw always-on telemetry is exposed on `/activity` and the dashboard widget; it does not duplicate into other surfaces. (Memento Mori shading does use always-on telemetry as its base layer — see `MementoMori.md` §4.2 — but it's reading the daily rollup, not surfacing event detail.)

---

## 5. Behavior

### 5.1 Data fetching
- `GET /v1/activity/summary?range=today` → top-line totals + top-N apps + top-N sites + hourly buckets in one payload. Drives both the dashboard widget and the `/activity` page's summary band.
- `GET /v1/activity/recent?limit=30` → most recent raw events for the "Recent switches" list.
- TanStack Query caches per `range`; the 60s poll just invalidates the `today` query.

### 5.2 Performance
- The minute and hour rollups are the workhorses. Reading "today" is `SELECT … WHERE userId = ? AND hourBucket >= today_start GROUP BY target` against the hour table — small and indexed.
- "Last 7/30 days" hits the day rollup. Also small (~30 rows per source per day worst case).
- Raw `TelemetryEvent` table is only read for the "Recent switches" list (`LIMIT 30` by `startedAt DESC`).
- The minute-rollup write path is the only hot edge: every ingested event upserts one minute-bucket row. Acceptable for personal-scale volume.

### 5.3 Time zones
- All timestamps stored UTC; bucketing happens in the user's local timezone (stored on `User`). "Today" means the user's local-day window.
- DST: handled by date-fns-tz for bucket boundary calculation. v1 does not deal with users changing timezones (see `Settings.md` §4.1.1 for the timezone source-of-truth).

### 5.4 Privacy / source-level capture controls

There is no display-side filter on the web app in v1. What the user sees in `/activity` is exactly what the source clients sent.

The user controls *what gets captured at all* via per-source settings inside the extension and desktop app themselves — see `Sources Markdown/Extension.md` and `Sources Markdown/DesktopApp.md`. If a domain or app is blocked at the source, it never reaches the server, never enters the rollup, and never appears here. This is the single privacy lever in v1: don't capture it, vs. capture-and-hide.

A small inline hint on `/activity`: *"Want to hide something? Adjust the capture rules in the extension or desktop app."*

---

## 6. API surface (sketch — full shape goes in `PROJECT.md` §7)

| Method | Path                                                | Purpose                                                                                                |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/activity/summary?range=...`                    | Range totals + top-N apps + top-N sites + hourly buckets.                                              |
| GET    | `/v1/activity/recent?limit=...`                     | Most recent raw telemetry events (capped, reverse chrono).                                              |
| GET    | `/v1/activity/by-day?from=...&to=...`               | Daily totals per source over a range — used by `MementoMori.md` §4.2.                                  |

The ingest endpoint (`POST /v1/telemetry/batch`) that *populates* these is owned by `PROJECT.md` §12, not by this feature.

No display-blocklist endpoints in v1 — capture controls live inside the source clients (see §5.4).

---

## 7. Accessibility

- Hourly breakdown bars include numeric values in adjacent text on focus / hover.
- Top-app / top-site lists are real `<ol>` lists with `<a>` rows (keyboard navigable).
- Color is never the sole indicator (app vs site distinction also conveyed by an icon and label).
- Range selector uses a real `<select>` with `aria-label="Time range"`.
- Auto-refresh respects `prefers-reduced-motion` (no animation on bar re-render; just a content swap).

---

## 8. Dependencies

- **Telemetry ingest** (`PROJECT.md` §12, `Sources Markdown/Extension.md`, `Sources Markdown/DesktopApp.md`) — provides every event this feature reads.
- **Postgres** rollup table `activity_minute_rollup` (see §3.2). Hour / day / week views are aggregated from this table on demand.
- **`MementoMori.md`** consumes the same minute rollup for its weekly base shading (§4.2 of that spec).
- **Recharts** — for the hourly stacked-bar component.
- **date-fns / date-fns-tz** — bucket math.

---

## 9. Open Questions / TODOs

- **Top-N cap.** Top 5 apps + top 5 sites on the page; top 3 + top 3 on the dashboard widget. Tunable later.
- **App/site categorization.** Not in v1, but the model should anticipate it — adding a `categoryId` to a future `app_meta` / `site_meta` table is straightforward.
- **Visible idle gaps.** v1 shows idle time as absence of data in the hourly bar. A future version could add explicit "idle" rendering (greyed segments, etc.) — would require re-introducing idle as a wire event from the source clients.
- **Same target via two sources.** When the user is on `chrome.exe` (desktop event) browsing `github.com` (extension event), both events arrive for overlapping time windows. v1 displays them side-by-side in the two "Top" lists; no de-duplication. A future "true active time" stat that picks one source per overlap is deferred — needs explicit user input on which source wins.
- **Catch-up on long offline periods.** When a device flushes a large backlog after being offline, the minute-rollup write path becomes a hot loop. Batch the upserts (group events by minute bucket before writing) inside the ingest handler.
- **On-demand aggregation cost.** Computing hour / day / week views from `activity_minute_rollup` at read time is cheap at personal-scale data volumes (single user, ≤1 row per minute per target). If aggregation latency ever becomes noticeable, materialize an hour or day rollup table at that point — not before.
- **"Workday view" presets.** Custom range presets like "Work hours today (9–6)" — deferred.
