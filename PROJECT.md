# Focus Tracker — Project Specification

> A personal productivity dashboard combining tasks, a calendar, focus-session time tracking, an always-on activity viewer, and a Memento Mori life calendar — fed by continuous attention telemetry from a companion browser extension and desktop app.
> The `UI_Design/` folder (`dashboard_UI.png`, `Focus Tracker.html`, `styles.css`, `app.js`) is **visual reference only** (color palette, typography, spacing). Anything implied about features by the mockup is superseded by §6 below.

---

## 1. Overview

Focus Tracker is a personal web application for managing tasks, tracking focused work, and reflecting on time. The v1 feature set is intentionally small and centers on four surfaces:

- A **Calendar** showing dated tasks and past focus sessions, with the ability to create dated tasks directly from it.
- A **Tasks** module with user-defined Sections and simple checkbox completion (some tasks have dates or date-ranges; others are ongoing).
- A **Memento Mori life calendar** — a weeks-of-life grid shaded by total active telemetry minutes, overlaid with a marker on weeks containing Focus Sessions, annotated with milestones, with a writable journal note per week.
- A **Focus Session** runner — a labeled time window that stamps active telemetry events with a session id so the user can later see what their attention went to during the session. Telemetry runs **always** (see below); sessions are a labeling overlay, not a gate.
- An **Activity** viewer — the always-on telemetry surface. Shows app and site usage continuously, independent of sessions.

A compact home **Dashboard** stitches these together; each feature also has its own full-screen route.

**Status:** Specification in progress. Tech stack is finalized; this is the first batch of app features — more will be added later. Data model, API, and roadmap continue to evolve.

### 1.1 Scope

| Aspect              | Decision                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Users               | **Single-user (just me)** for v1. No signup, no multi-tenant features.                            |
| Deployment          | **Local-first** for v1 — API, DB, and web app all run on my own machine.                          |
| Future              | Possible self-host on a small VPS / home server later. Schema and architecture must not block it. |
| User schema         | **Multi-user-ready** — `user_id` columns and a real `users` table from day one, just with one row. |
| Auth on the web app | **Full email/password + JWT + refresh tokens** (same as a real app — for learning + future-proofing). |
| Privacy concerns    | Self-only — no GDPR / multi-user data-isolation work needed. Privacy controls still apply to *me*. |

---

## 2. Tech Stack

### 2.1 Frontend

| Concern              | Choice                                   | Notes                                                              |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Framework            | **React 18+** with **TypeScript**        | Strict mode enabled                                                |
| Build tool / dev srv | **Vite**                                 | Fast HMR, ESM-native                                               |
| Routing              | **TanStack Router**                      | Type-safe routes, pairs naturally with TanStack Query              |
| Server state         | **TanStack Query (React Query)**         | Caching, refetching, optimistic updates                            |
| Client/UI state      | **Zustand**                              | Minimal store for ephemeral UI state (timer, modals, theme)        |
| Styling              | **Tailwind CSS**                         | Existing `UI_Design/styles.css` will be migrated to utility classes |
| UI primitives        | **shadcn/ui** (Radix UI + Tailwind)      | Copy-paste components, full design control                         |
| Forms                | **React Hook Form** + **Zod**            | Type-safe forms with schema validation                             |
| Charts               | **Recharts**                             | Light use — post-session summary breakdowns; deeper analytics deferred past v1 |
| Icons                | **Lucide React**                         | Matches the stroke style used in the design                        |
| Dates & time         | **date-fns**                             | Tree-shakeable, functional API                                     |
| Toasts               | **Sonner**                               | Lightweight, modern toast notifications                            |
| Animations           | **Framer Motion** (a.k.a. Motion)        | For the timer dial, modals, list transitions                       |
| Drag & drop          | **`@dnd-kit/core`**                      | Dashboard widget reorder (`Features Markdown/Dashboard.md` §5 / §13) — fully accessible, modular, ~10kb gzipped |

### 2.2 Backend

| Concern         | Choice                                                  | Notes                                              |
| --------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Framework       | **NestJS** (TypeScript)                                 | Modular architecture, decorator-based              |
| Database        | **PostgreSQL**                                          | Relational model fits sections / tasks / focus sessions / telemetry events |
| ORM             | **Prisma**                                              | Type-safe queries, migrations, great DX            |
| Authentication  | **JWT + Passport.js** (email/password, local strategy)  | Access + refresh token flow with per-use rotation. Full spec in `Features Markdown/Auth.md`. |
| Password hashing | **`argon2`** (argon2id variant)                        | OWASP-recommended in 2026; replaces bcrypt. See `Features Markdown/Auth.md` §7.1. |
| CLI commands    | **`nest-commander`** (or raw `CommandFactory`)          | Powers `pnpm api:seed-user` / `api:reset-password` / `api:list-users` per `Features Markdown/Auth.md` §6. |
| Validation      | **class-validator** + **class-transformer**             | NestJS-idiomatic decorator-based DTO validation    |
| API style       | **REST** with hand-written DTOs                         | No auto-generated OpenAPI in v1; add later only if a real consumer needs it. |
| Real-time       | _None for now_                                          | Client polls / refetches on focus (revisit later)  |

### 2.3 Repo, Tooling & Quality

| Concern         | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Repo layout     | **pnpm monorepo** — `apps/web` (React) + `apps/api` (NestJS) + `packages/*` (shared types, etc.) |
| Package manager | **pnpm**                                                     |
| Linting         | **ESLint** + **Prettier** (no git hooks for now)             |
| Unit tests      | **Jest**, opt-in — write tests where behavior is non-obvious (nightly job, scoring math, auth flows). No mandate to cover everything. |
| E2E tests       | _None for v1_ — personal project; manual smoke-test is enough. Add Playwright later only if regressions become a real pain. |
| Deployment      | _To be decided_ — focus on building first                    |

### 2.4 Proposed Folder Structure

```
focus-tracker/
├── apps/
│   ├── web/                  # Vite + React + TS — the main dashboard / routes
│   │   ├── src/
│   │   │   ├── routes/       # TanStack Router route files
│   │   │   ├── components/
│   │   │   ├── features/     # dashboard, tasks, calendar, life, focus, activity, ...
│   │   │   ├── lib/          # api client, query keys, utils
│   │   │   ├── stores/       # Zustand stores
│   │   │   └── styles/
│   │   └── tailwind.config.ts
│   ├── api/                  # NestJS
│   │   ├── src/
│   │   │   ├── modules/      # auth, users, sections, tasks, focus-sessions, telemetry, activity, devices, life, ...
│   │   │   ├── common/       # guards, interceptors, pipes, filters
│   │   │   └── main.ts
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   ├── extension/            # Browser extension source client (see Sources Markdown/Extension.md)
│   └── desktop/              # Tauri desktop source client (see Sources Markdown/DesktopApp.md)
├── packages/
│   └── shared/               # Shared TS types / Zod schemas (telemetry events, batch envelope, DTOs)
├── Features Markdown/        # Per-feature standalone specs (Tasks, Calendar, MementoMori, FocusSession, Activity, TaskCharts)
├── Sources Markdown/         # Per-source-client standalone specs (Extension, DesktopApp)
├── package.json
├── pnpm-workspace.yaml
└── PROJECT.md                # this file
```

---

## 3. Documentation Convention

Feature-level specs in `Features Markdown/` (and `Sources Markdown/` for the source clients) are the source of truth for intent. They cover the *what* and *why* of each user-facing capability.

Per-component, per-hook, per-module `.md` files are **optional, not required**. Add one only when:
- The unit has non-obvious logic that's worth explaining (e.g. a complex state machine or scoring formula).
- The unit's shape changed in ways that surprised you and you want to leave breadcrumbs for future-you.

The default is: code is its own documentation. Names, types, and small comments where intent isn't clear from the code. Don't write a `.md` just to restate the function signature.

When code drifts from a feature spec in `Features Markdown/`, update the spec in the same commit. The specs are how design decisions stay coherent across features; the per-unit code is just code.

---

## 4. Architecture

### 4.1 Block diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          USER'S MACHINE                              │
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐                        │
│  │  Browser tab(s)  │    │  Browser ext.    │  ← Sources Markdown/   │
│  │  (apps/web)      │    │  (apps/extension)│       Extension.md     │
│  │                  │    │  IndexedDB outbox│                        │
│  │  React + TS      │    └────────┬─────────┘                        │
│  │  TanStack Router │             │                                  │
│  │  TanStack Query  │             │ Bearer ft_live_...               │
│  │  Zustand         │             │ POST /v1/telemetry/batch         │
│  │  Tailwind        │             ▼                                  │
│  │                  │    ┌──────────────────┐                        │
│  │  localStorage:   │    │  Desktop daemon  │  ← Sources Markdown/   │
│  │   accessToken    │    │  (apps/desktop)  │       DesktopApp.md    │
│  │   refreshToken   │    │  Tauri / Rust    │                        │
│  └────────┬─────────┘    │  JSONL outbox    │                        │
│           │              └────────┬─────────┘                        │
│           │                       │                                  │
│           │ Bearer <JWT>          │ Bearer ft_live_...               │
│           │ /v1/* (user routes)   │ POST /v1/telemetry/batch         │
│           ▼                       ▼                                  │
│  ─────────────────────────────────────────────────────  HTTP(S)  ─── │
│           │                                                          │
│           ▼                                                          │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                       apps/api  (NestJS)                      │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │   │
│  │  │ JwtAuthGuard│  │ApiKeyGuard  │  │ Module routers       │  │   │
│  │  │ (user:*)    │  │(telemetry:* │  │  auth / users / me   │  │   │
│  │  └─────────────┘  └─────────────┘  │  sections / tasks    │  │   │
│  │         │                │         │  focus-sessions      │  │   │
│  │         └────────┬───────┘         │  telemetry / activity│  │   │
│  │                  ▼                 │  devices / milestones│  │   │
│  │           Service layer            │  dashboard-prefs     │  │   │
│  │                  │                 └──────────────────────┘  │   │
│  │                  ▼                                            │   │
│  │           Prisma client                                       │   │
│  │                  │                                            │   │
│  │  ┌───────────────┴───────────────┐                            │   │
│  │  │ Scheduled jobs (@nestjs/      │                            │   │
│  │  │  schedule):                   │                            │   │
│  │  │  - nightly task maintenance   │                            │   │
│  │  │  - token cleanup              │                            │   │
│  │  │  - week-activity refresh      │                            │   │
│  │  │  - aborted-session sweeper    │                            │   │
│  │  │  - timer-session completer    │                            │   │
│  │  └───────────────┬───────────────┘                            │   │
│  └──────────────────┼────────────────────────────────────────────┘   │
│                     ▼                                                │
│              ┌─────────────┐                                         │
│              │ PostgreSQL  │  (Docker container in dev;              │
│              │             │   managed service in prod TBD)          │
│              └─────────────┘                                         │
└──────────────────────────────────────────────────────────────────────┘

         packages/shared  ←  TypeScript types + Zod schemas
              ↑   ↑   ↑       (telemetry event, batch envelope,
              │   │   │        DTOs). Imported by apps/web,
       apps/web  apps/api   apps/extension.
                       apps/extension  apps/desktop hand-mirrors the
                                        same shapes in Rust (events.rs).
```

### 4.2 Web-app request flow (user routes)

1. User opens the SPA. Auth bootstrap (route guard in `Features Markdown/Auth.md` §12.4, Zustand store in §12.5): if `accessToken` is missing or expired, redirect to `/login`; otherwise hydrate the auth Zustand store from `localStorage`.
2. Subsequent fetches go through an axios instance with two interceptors:
   - **Request:** attach `Authorization: Bearer <accessToken>`.
   - **Response (401):** trigger the refresh flow (`POST /v1/auth/refresh` with `refreshToken`), get a new pair, write to `localStorage`, retry the original request once. On refresh failure: clear `localStorage`, reset store, navigate to `/login`. In-flight queue to prevent N parallel 401s firing N rotations (`Auth.md` §12.3).
3. NestJS `JwtAuthGuard` verifies the JWT signature and expiry, attaches `req.user = { userId, email }`. Controllers read from `req.user`.
4. Service layer translates DTO → Prisma calls. Returns plain JS objects; NestJS serializes to JSON.
5. TanStack Query caches per-route; mutations invalidate the relevant keys (each feature spec lists its own invalidation rules).

### 4.3 Source-client telemetry flow

1. Source captures events locally (extension → IndexedDB, desktop → JSONL). See `Sources Markdown/Extension.md` §7 and `Sources Markdown/DesktopApp.md` §8.
2. Flush trigger: every 60s, ≥50 queued events, or on reconnect/wake/shutdown — whichever comes first. Batch up to 50 events into the standard envelope.
3. `POST /v1/telemetry/batch` with `Authorization: Bearer ft_live_<random>`.
4. NestJS `ApiKeyAuthGuard` recognises the `ft_live_` prefix (`Auth.md` §5.3), hashes the token, looks up the row in `ApiKey`, verifies `revokedAt == null` and scope contains `telemetry:write`, attaches `req.apiKey = { userId, deviceId, scope }`, bumps `Device.lastSeen = now()`.
5. The ingest handler:
   - Upserts each event by client-generated ID (idempotent — duplicate batches are safe).
   - For each event, looks up the active `FocusSession` at `event.startedAt` and stamps `focusSessionId` (or null) per `FocusSession.md` §7.
   - Upserts the per-minute bucket in `activity_minute_rollup` for read-side aggregation per `Activity.md` §3.2.
   - On non-empty accepted batch: bumps `Device.lastSuccessfulIngestAt = now()`.
   - Returns `{ accepted: [ids], duplicates: [ids], rejected: [{id, reason}] }`.
6. Source client deletes locally only what the server confirms (`accepted` + `duplicates`); leaves the rest in the outbox for the next flush.

### 4.4 Background jobs (`@nestjs/schedule`)

Five jobs, all in-process (no separate worker). All cron schedules are server-local time unless noted otherwise.

| Job                              | Schedule           | What it does                                                                   | Source of truth                       |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------ | ------------------------------------- |
| Nightly task maintenance         | `15 3 * * *` user-local | Materialize today's `TaskInstance` rows from active routine tasks; transfer / backlog yesterday's missed single-day dated tasks; compute `routine_section_daily_score` and `dated_section_daily_score` rows for yesterday. **Strict ordering matters** — see `Tasks.md` §5.5. | `Tasks.md` §5.5                       |
| Token cleanup                    | `0 4 * * *`        | Delete `RefreshToken` rows where `expiresAt < now() - 7 days`; delete unclaimed `PairingCode` rows where `expiresAt < now()`. | `Auth.md` §13                          |
| Week-activity refresh            | `*/15 * * * *`     | Refresh `week_activity_minutes` for the current and previous ISO-weeks from `activity_minute_rollup`. Older weeks are immutable. | `MementoMori.md` §6.2                  |
| Aborted-session sweeper          | `*/30 * * * *`     | Find `FocusSession` rows still `running` / `paused` for >24h with no recent activity; mark `aborted` with bounded `endedAt`. | `FocusSession.md` §9.8                |
| Timer-session completer          | `*/10 * * * * *`   | Find timer-mode sessions whose `running` time has reached `plannedDurationMs`; auto-complete with `endReason = 'timer_complete'`. (Every 10s — clients run countdown locally too; server is authoritative for the end.) | `FocusSession.md` §9.5                 |

The `activity_minute_rollup` upsert is **not** a scheduled job — it runs inline inside the telemetry ingest handler (cheap upsert per event). Hour / day / week views are computed on-demand at read time.

### 4.5 Deployment topology (v1)

Single machine, localhost-first:

```
machine
├── Node process — NestJS API + scheduled jobs + (in dev) Vite dev server proxy
│     listens on :3000
├── Docker container — postgres:16
│     listens on :5432 (mapped); volume-mounted for persistence
└── Static SPA build (apps/web) — served by NestJS in prod via `ServeStaticModule`,
                                  or by Vite dev server in dev
```

Source clients (extension, desktop daemon) live on whatever machines the user actually works on and reach the API at the configured base URL — `http://localhost:3000` by default, configurable per `Sources Markdown/*.md`.

When / if the API moves off localhost: HTTPS becomes mandatory (cert via Let's Encrypt or self-signed for LAN), and the source clients re-pair against the new origin. CORS gets a single allowed origin (the deployed web app's URL); the source clients aren't CORS-bound (they're not browsers in the same-origin sense).

No load balancer, no reverse proxy required in v1. Adding nginx / Caddy in front is a deployment-time decision, not an architecture-time one — the API doesn't care.

---

## 5. Data Model (TBD)

_To be filled in once feature specs settle. Expected v1 entities:_

- _`User` — `email`, `passwordHash` (argon2id parameterised string per `Features Markdown/Auth.md` §7.1 / §10.1), `displayName`, `birthday`, `lifeExpectancyYears`, `timezone`, `timezoneOverridden`. See `Features Markdown/Settings.md` §6.1._
- _`RefreshToken` — per-session opaque token (sha256-hashed); rotated on every use. See `Features Markdown/Auth.md` §10.2._
- _`ApiKey` — one per paired device, long-lived, scoped `telemetry:write`, hash stored. See `Features Markdown/Auth.md` §10.3._
- _`PairingCode` — short-lived 6-digit bootstrap token consumed by `POST /v1/devices/pairing-codes/{code}/claim`. See `Features Markdown/Auth.md` §10.4._
- _`UserDashboardPrefs` — per-user dashboard widget order, hidden set, collapsed set. See `Features Markdown/Dashboard.md` §9._
- _`Section`, `Task` (with `kind` discriminator: dated / ongoing / routine; required `priority` enum: `low | mid | high | extreme` on every task — see `Tasks.md` §3.6; plus `transferIfMissed`, `transferredFromDate`, `inBacklog` fields on dated tasks — see `Tasks.md` §3.5)._
- _`TaskInstance` — per-occurrence completion of routine tasks; **carries a `priority` snapshot** of the parent routine at materialisation time so historical chart scores stay honest._
- _`FocusSession`, `FocusSessionPause` — every pause is user-triggered in v1 (no `trigger` field; see `FocusSession.md` §3.2)._
- _`Milestone`, `WeekNote`._
- _`Device` — `label`, `lastSeen`, `lastSuccessfulIngestAt`, `clientVersion`. See `Features Markdown/Settings.md` §6.2._
- _`TelemetryEvent` — raw always-on event stream (see §12.5)._

Derived / aggregated tables:
- _`activity_minute_rollup` — per-target time totals at 1-minute grain (see `Features Markdown/Activity.md` §3.2). Hour / day views are computed on demand via SQL aggregation; no separate hour or day tables in v1._
- _`week_activity_minutes` — per-week totals for Memento Mori base shading (see `Features Markdown/MementoMori.md` §6.2)._
- _`routine_section_daily_score` — per-Section daily score + cumulative running total for the Routine family. Includes `scheduledCount` (drives the base-score denominator), `completedCount`, `scheduledWeight` (informational), `completedWeight` (drives the numerator). The base score is a **mid-as-reference completion ratio** (`completedWeight / scheduledCount` with weights extreme=2.0 / high=1.5 / mid=1.0 / low=0.5 — see `Features Markdown/TaskCharts.md` §5.1), so daily scores fall in `[-1.000, +2.000]`. Globals are derived by GROUP BY aggregation at read time (see `Features Markdown/TaskCharts.md` §6.1)._
- _`dated_section_daily_score` — same shape as routine plus `backlogCount`, `backlogTopPriority`, `baseScore`, `backlogPenalty` columns. `backlogPenalty` uses a geometric-decay formula bounded near -3 with the backlog set sorted by descending priority. The Dated daily score is bounded in approximately `[-4, +2]`. See `Features Markdown/TaskCharts.md` §5.3 and §5.4._

_Prisma schema sketch to follow._

---

## 6. Core Features (v1 — First Batch)

The v1 app feature set is intentionally small. Each feature has its own dedicated spec under `Features Markdown/` and is treated as the source of truth for its behavior, data shape, and UI.

| Feature                       | Spec file                                        | One-line summary                                                                                          |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Dashboard                     | `Features Markdown/Dashboard.md`                 | Home composition surface at `/`. Single-column, fully responsive, fully customizable (hide/show + reorder, persisted server-side via `UserDashboardPrefs`). Stitches together the eight v1 widgets contributed by Focus Session, Tasks (Today's / Ongoing / Backlog), Activity, TaskCharts (two global), and Memento Mori. Also owns the **cross-route sticky session bar** that surfaces an active Focus Session on every route except `/focus`. |
| Tasks                         | `Features Markdown/Tasks.md`                     | User-defined Sections containing tasks of three kinds: **Dated**, **Ongoing**, **Routine**. Every task carries a required **priority** (`low / mid / high / extreme`) that drives sort order everywhere and powers the chart's weighted scoring. Single-day dated tasks support opt-in transfer-to-next-day + Backlog (Backlog defaults to grouping by priority). |
| Calendar                      | `Features Markdown/Calendar.md`                  | Displays dated tasks + past focus sessions; create/edit dated tasks directly from the calendar            |
| Memento Mori Life Calendar    | `Features Markdown/MementoMori.md`               | Weeks-of-life grid; past weeks shaded by total active telemetry minutes (base) + a marker on weeks containing Focus Sessions (overlay); configurable lifespan + milestones; clickable for stats + per-week journal note |
| Focus Session                 | `Features Markdown/FocusSession.md`              | Timer-bound or open-ended session that *labels* events in the always-on telemetry stream from §12; pause/resume with logged interruptions; cross-route sticky bar surfaces the active session everywhere. |
| Activity                      | `Features Markdown/Activity.md`                  | Always-on telemetry viewer: today / week / month app + site breakdowns and recent switches, independent of sessions; dedicated `/activity` route + dashboard widget. No display-side filtering in v1 — what the source clients capture is what the user sees. |
| Task Charts                   | `Features Markdown/TaskCharts.md`                | Consistency visualization for **routine** and **single-day dated** tasks. Three chart blocks: **Global Routine**, **Global Dated**, and **Per-Section Dated**. Globals appear at the top of `/tasks` and on the dashboard; per-Section Dated charts appear inline in the Dated panel of `/tasks`. All blocks use the same stock-style cumulative-score line chart with a **priority-weighted, mid-as-reference base score** (`completedWeight / scheduledCount` where weights are extreme=2 / high=1.5 / mid=1 / low=0.5; -1 floor for zero-completion days). Daily score range is `[-1, +2]` for Routine: a fully-completed extreme day reaches +2, a fully-completed mid day +1, a fully-completed low day +0.5 — completing high-priority work genuinely outscores completing low-priority work. The Dated family adds a geometric-decay **Backlog penalty** layered on top (-2 for the highest-priority task entering Backlog that day, then halving for each subsequent task in descending priority order — bounded near -3 total), giving a daily score range of `[-4, +2]`. A GitHub-style completion heatmap visual is deferred to v2 (see `TaskCharts.md` §11). |
| Settings                      | `Features Markdown/Settings.md`                  | One-stop user preferences surface at `/settings` with six tabbed sections (Profile / Memento Mori / Dashboard / Devices / Telemetry / About). Left-rail layout with `#anchor` deep-links. Hosts: profile basics + birthday + lifespan + timezone + password + logout, milestones management, the Dashboard customization mirror, the device pairing/revoke flow (with per-device sync status — `lastSeen` / `lastSuccessfulIngestAt` — inline on each row), and the API base URL display. Mixed save semantics: toggles/dropdowns auto-save, text/date/password inputs use explicit Save. |

In addition to the eight app features above, the two telemetry source clients (`Sources Markdown/Extension.md` and `Sources Markdown/DesktopApp.md`) are first-class components of this project — see §12.

### 6.1 Deliberately **out of scope for v1**

The following appeared in the original `UI_Design/` mockup or were discussed as ideas but are **not** part of v1: meetings, external calendar integrations (Google/Outlook), reminders/notifications, goal tracking, focus-over-time analytics chart, weekly project timeline, activity bars, project-distribution donut, arbitrary custom routine cadences (every-N-days etc.), free-form task tags (priority + Section cover v1), task subtasks, focus-session quality ratings, focus-session free-text notes, multi-user features, theme toggle (light/dark may come later), and any productivity scoring on the client side.

These can be revisited in v2+.

---

## 7. API Surface

This section defines the **rules of the road** for every endpoint. Concrete endpoint lists live in the feature specs (per §7.6 index below) — this is intentional, so that adding / changing an endpoint touches exactly one spec.

### 7.1 Conventions

- **Versioning.** Every endpoint is prefixed `/v1/`. No `/v2/` will be introduced for personal v1 — when a breaking change is needed, edit `/v1/` in place and migrate the source clients alongside the server.
- **Bodies.** JSON in and out. `Content-Type: application/json` required on every body-bearing request. Empty bodies (`POST` actions with no params) are allowed and need no `Content-Type`.
- **Timestamps.** ISO 8601 UTC strings on the wire (e.g. `"2026-06-13T18:04:00.000Z"`). Clients format to user-local for display. The server never accepts or returns a "naive" timestamp.
- **IDs.** Every primary key is a Prisma-generated `cuid` string (e.g. `clxv0m9pw0000abcd`) unless explicitly noted (e.g. `Device.id` is a UUID v4 — chosen by the source client at install time so the same ID can be used before and after pairing). Refer to per-entity Prisma fields in §5 for the exact ID type.
- **Date-only fields.** Birthdays, dated-task dates, and other "calendar day" values are sent as `"YYYY-MM-DD"` strings (no time component). The server stores them as `@db.Date` so they round-trip without timezone shifts.
- **Boolean partial updates.** `PATCH` endpoints accept partial bodies; only fields present in the body are mutated. Sending `null` explicitly clears a nullable field.

### 7.2 HTTP verbs and status codes

| Verb     | Use for                                              | Typical success status |
| -------- | ---------------------------------------------------- | ---------------------- |
| `GET`    | Read, list                                           | `200 OK`               |
| `POST`   | Create, action (pause/resume/stop/login/refresh/etc.)| `201 Created` for create, `200 OK` for action with body, `204 No Content` for action without body |
| `PATCH`  | Partial update                                       | `200 OK` (returns the updated row) |
| `DELETE` | Remove / revoke                                      | `204 No Content`       |

| Status | Meaning                                                                                       |
| ------ | --------------------------------------------------------------------------------------------- |
| `200`  | OK with body                                                                                  |
| `201`  | Created (returns the created row, with its server-assigned `id`)                              |
| `204`  | OK, no body                                                                                   |
| `400`  | Validation failure (Zod / class-validator). Body has the error code + field-level details.   |
| `401`  | Unauthenticated — no/invalid/expired token. Trigger the refresh flow on the web client; the source-client equivalent is `api_key_revoked` → re-pair. |
| `403`  | Authenticated but wrong scope — e.g. an API key with only `telemetry:write` hitting a `user:*` route. |
| `404`  | Not found (or belongs to a different user — never reveal "exists but you can't see it").     |
| `409`  | Conflict — currently only used by `POST /v1/focus-sessions` when another session is already active (`FocusSession.md` §9.1). |
| `413`  | Payload too large — used by `POST /v1/telemetry/batch` when a batch exceeds 50 events.        |
| `500`  | Unhandled server error. Body has a generic `internal_error` code; full stack lives in server logs only. |

### 7.3 Standard response shapes

**Success:** raw JSON. No wrapper / envelope.
- Single resource: an object (`{ id, ..., createdAt }`).
- List: an array (`[ {...}, {...} ]`). No pagination metadata in v1 (all list endpoints return small fixed-size sets — see §7.5).

**Error envelope (every non-2xx):**
```ts
{
  error: string;          // machine-readable code, e.g. "invalid_credentials", "session_in_progress"
  message?: string;       // human-readable; may be omitted in production
  details?: unknown;      // structured extras — e.g. Zod field issues, the conflicting session id
  hint?: string;          // dev-mode-only helpers (Auth.md §6.2 uses this for the no-user-seeded hint)
}
```

Per-endpoint specs may add extra fields *inside* the same envelope (e.g. `existingSessionId` on the 409 from focus-session start) — they don't introduce a different shape.

### 7.4 Authentication header

Single header, two token shapes — `Auth.md` §3 owns the discrimination rule:

```
Authorization: Bearer <token>
```

| Token shape                 | Guard                | Used by               | Scope tag         |
| --------------------------- | -------------------- | --------------------- | ----------------- |
| JWT (signed, header `eyJ…`) | `JwtAuthGuard`       | Web app               | `user:*`          |
| `ft_live_<random>`          | `ApiKeyAuthGuard`    | Source clients        | `telemetry:write` |

A handful of routes are deliberately **unauthenticated** (login, refresh, the device-side half of pairing-code polling, health). Those are explicitly listed in their owning specs and called out in the table below.

No cookies. No `X-CSRF-Token`. No basic auth.

### 7.5 Pagination

None in v1. Every list endpoint returns a bounded, fixed-size response by construction:

- `GET /v1/devices` — one row per paired device (personal scale: ≤ ~10).
- `GET /v1/milestones` — one row per user milestone (personal scale: dozens at most).
- `GET /v1/focus-sessions?from=...&to=...` — bounded by the date range the caller asks for; the UI never asks for more than 90 days at once.
- `GET /v1/activity/recent?limit=...` — explicit `limit` query param, capped at 200 server-side.
- `GET /v1/activity/by-day?from=...&to=...` — one row per day in the range; UI never asks for more than 365 days.

When / if any endpoint outgrows this rule, add **cursor-based pagination** (`?cursor=<opaque>&limit=<n>`, response includes `nextCursor`) — not offset-based. Update this section when that happens.

### 7.6 Module-to-spec index

Every endpoint is owned by exactly one spec. To find the definition for a route, find its module here and open that spec.

| Module / route prefix                          | Owning spec                                | Notes                                                                                   |
| ---------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `/v1/auth/*`                                   | `Features Markdown/Auth.md` §11.1          | `login`, `refresh`, `logout`, `logout-all`.                                             |
| `/v1/me/profile`, `/v1/me/password`            | `Features Markdown/Settings.md` §7         | Password change spec'd in `Auth.md` §4.7.                                               |
| `/v1/me/dashboard-prefs`                       | `Features Markdown/Dashboard.md` §10       | `GET` + `PATCH`. Per-user widget order / hidden / collapsed sets.                       |
| `/v1/devices/*`                                | `Features Markdown/Auth.md` §11.2 + `Features Markdown/Settings.md` §7 | Pairing flow in Auth; list / revoke in Settings. Same endpoints, two specs cover different aspects. |
| `/v1/sections/*`                               | `Features Markdown/Tasks.md` §7            | Section CRUD.                                                                            |
| `/v1/tasks/*`, `/v1/task-instances/*`          | `Features Markdown/Tasks.md` §7            | Task CRUD, completion toggles, backlog management.                                       |
| `/v1/task-charts/*`                            | `Features Markdown/TaskCharts.md` §7       | Per-section daily scores + global aggregations.                                          |
| `/v1/focus-sessions/*`                         | `Features Markdown/FocusSession.md` §10    | Lifecycle (start/pause/resume/stop), current, history, breakdown, summary.              |
| `/v1/telemetry/batch`                          | `PROJECT.md` §12.6 (this file)             | The single ingest endpoint. API-key auth only.                                          |
| `/v1/activity/*`                               | `Features Markdown/Activity.md` §6         | `summary`, `recent`, `by-day`. Also consumed by Memento Mori.                           |
| `/v1/milestones/*`                             | `Features Markdown/MementoMori.md` §7      | Milestone CRUD; consumed by both `/life` route and Settings.                            |
| `/v1/life/*`                                   | `Features Markdown/MementoMori.md` §7      | Grid data + week notes.                                                                  |
| `/v1/calendar/*`                               | `Features Markdown/Calendar.md` §7         | Per-month aggregated view (tasks + sessions).                                            |

### 7.7 Endpoints not owned by a feature spec

Two small utilities live here directly because they don't belong to any feature:

| Method | Path           | Guard | Purpose                                                                                              |
| ------ | -------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/v1/health`   | none  | Liveness probe. Returns `{ status: "ok", version: "<git short hash>", uptimeMs: <number> }`. Consumed by the Settings → About panel (`Settings.md` §4.6) and by any future external uptime check. |
| GET    | `/v1/me`       | JWT   | Returns the current user's identity in one trip: `{ id, email, displayName, timezone }`. Used by the auth bootstrap to validate the access token and hydrate the auth Zustand store on app boot (route guard in `Auth.md` §12.4; Zustand store in `Auth.md` §12.5). Profile *details* (birthday, lifespan, etc.) live on `/v1/me/profile` per `Settings.md` §7. |

### 7.8 Idempotency

- `POST /v1/telemetry/batch` is idempotent at the **event level** — upserts by client-generated event ID. Re-sending the same batch returns the same `accepted` + `duplicates` split.
- `POST /v1/auth/refresh` is **not** idempotent — each call rotates the refresh token. The web client's in-flight queue (`Auth.md` §12.3) is what makes parallel requests safe, not server-side idempotency.
- All other `POST` actions (session pause/resume/stop, task completion toggle, milestone create) are deliberately non-idempotent; clients must not auto-retry on network failure without surfacing the failure to the user.

### 7.9 Versioning the contract over time

When a field is added: backward-compatible by default (clients ignore unknown fields per Zod's `.passthrough()` on response schemas).

When a field is removed or changes semantics: this is a breaking change. Procedure:
1. Bump the source-client `clientVersion` constants in `packages/shared`.
2. Ship the server change.
3. Ship matching extension + desktop updates.
4. Stale clients will see ingest rejected with `error: "client_outdated"` and a hint to update.

No deprecation period in v1 — single user, you control all the clients, just ship them together.

---

## 8. Screens & UX Flows

### 8.1 Route map (v1)

| Route        | Purpose                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `/`          | **Dashboard** — single-column composition surface; eight widgets (Focus Session, Today's Tasks, Today's Activity, Ongoing, two global charts, Backlog indicator, Memento Mori strip); fully customizable hide/show + reorder. See `Features Markdown/Dashboard.md`. |
| `/tasks`     | Full Tasks management — all Sections, all tasks (Routine / Dated / Ongoing / Backlog panels), add/edit/delete; inline Task Charts (routine + dated) per Section |
| `/backlog`   | Dedicated Backlog view — dated tasks that were transferred forward and missed again; re-date back to today or pick a date |
| `/calendar`  | Full Calendar — month view by default; dated tasks (excluding backlogged) and past sessions; create dated tasks      |
| `/activity`  | Always-on telemetry viewer — today / week / month app + site breakdowns, hourly chart, recent switches               |
| `/life`      | Full Memento Mori grid — clickable past weeks, milestones overlay                                                    |
| `/focus`     | Focus Session history; current session controls when one is active                                                   |
| `/settings`  | **Settings** — left-rail tabbed surface with six sections (Profile / Memento Mori / Dashboard / Devices / Telemetry / About); `#anchor` deep-links from other surfaces (e.g. `/settings#devices`, `/settings#profile`). See `Features Markdown/Settings.md`. |
| `/login`     | Login screen (single-user)                                                                                           |

### 8.2 Cross-cutting

Empty / loading / error states, auth flow details, and onboarding are documented alongside each feature's spec under `Features Markdown/`. Anything that affects multiple features (e.g. global keyboard shortcuts, command palette) is deferred to v2.

One cross-cutting UI element ships in v1: the **sticky Focus Session bar**, rendered at the top of every route EXCEPT `/focus` whenever a session is `running` or `paused`. It surfaces the same state as the dashboard's `focus_session` widget (status, elapsed time, quick pause/resume/stop controls) so the user is reminded a session is active no matter where they've navigated. Reuses the same `GET /v1/focus-sessions/current` 5s poll the dashboard widget already runs — no extra requests. Full spec in `Features Markdown/Dashboard.md` §6; behavior cross-references `Features Markdown/FocusSession.md` §8.1 / §9.6 / §10.

A second cross-cutting convention: **`/settings#<section>` deep-links**. Empty-state CTAs and other surfaces that need to drop the user into a specific Settings panel use `#anchor`-style URLs (e.g. `/settings#devices` for "Pair a device", `/settings#profile` for "Set your birthday"). Anchors are stable: `#profile`, `#memento-mori`, `#dashboard`, `#devices`, `#telemetry`, `#about`. See `Features Markdown/Settings.md` §3.1.

---

## 9. Authentication & Authorization

Full spec: **`Features Markdown/Auth.md`**. This section is a summary.

Two parallel auth paths share the same `Authorization: Bearer <token>` header and are distinguished by token shape on the server:

- **Web app / user — JWT path.** Email + password → 15-min access JWT + 30-day refresh token. Refresh tokens are opaque, DB-backed, and rotated on every use (`Auth.md` §4.4); rotation is simple "revoke this row, issue a new one" — no family / reuse-detection machinery in v1. Both tokens live in `localStorage` (the chosen trade-off — XSS becomes the threat; compensating controls in `Auth.md` §9.1 require strict CSP + zero `dangerouslySetInnerHTML`). No CSRF concern (no cookies).
- **Source clients (extension / desktop) — API-key path.** Long-lived `ft_live_…` keys, one per paired device, scoped `telemetry:write`. Minted at pairing-claim time (§12.3); stored hashed on the server. Revoked from Settings → Devices.

**No signup endpoint.** The first (and, in v1, only) user is created via a CLI command:

```
pnpm api:seed-user --email <email> [--password <password>]
pnpm api:reset-password --email <email> [--password <new-password>]
pnpm api:list-users
```

See `Auth.md` §6 for the command surface and §6.2 for what `/login` shows when no user exists (production: opaque `401`; dev: hint banner with the seed command).

**Password handling.** `argon2id` (per `Auth.md` §7.1) with parameter auto-rehash on login when defaults change. Minimum 8 characters; no complexity rules (per NIST SP 800-63B); `zxcvbn` strength indicator on the change form.

**Logout.** `POST /v1/auth/logout` revokes this device's refresh token; `POST /v1/auth/logout-all` revokes every refresh token for the user. Both surfaced in Settings → Profile (primary + secondary actions).

**Password change.** `POST /v1/me/password` re-verifies the current password (independent of JWT) and accepts `signOutOtherDevices: boolean` (default `true`) which revokes every refresh token row except the current one.

**Out of scope for v1** (unchanged): self-service signup, password reset via email, OAuth / SSO, magic links, WebAuthn / passkeys, 2FA, per-route fine-grained permissions beyond the two scopes (`user:*` vs `telemetry:write`), active-session inspection UI (the schema supports it; the UI defers to v2), rate limiting (single-user localhost doesn't need it; add `@nestjs/throttler` later if the API is ever exposed publicly).

---

<!-- §10 (Non-Functional Requirements) and §11 (Roadmap & Milestones) intentionally removed: personal project, ship fast. Section §12 keeps its number to preserve cross-references throughout the spec set. -->

## 12. Edge Telemetry Clients (Overview)

Focus Tracker has **two companion clients** that feed real-world usage data into the main API. They live as **separate packages inside this monorepo** (`apps/extension/`, `apps/desktop/` — see §12.7) but are built, configured, and shipped independently of the web app. Each has its own standalone spec under `Sources Markdown/`.

Per §1.1 this is a single-user, local-first system for v1. In practice that means both clients talk to a configurable API base URL — `http://localhost:3000` by default while developing on the same machine, and whatever URL the API ends up at if it ever gets self-hosted later. The clients are not bound to a fixed origin.

| Client            | What it captures                                                 | Spec file                                      |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| Browser extension | Website focus events (domain, tab title, idle, sessions)         | `Sources Markdown/Extension.md`                |
| Desktop app       | Foreground application/window events (app name, window title)    | `Sources Markdown/DesktopApp.md`               |

### 12.1 Why two clients

The browser extension can see which **website** is in focus but not which **desktop app** is running. The desktop app can see which **app/window** is focused but not the **URL** inside the browser. Together they give a complete picture of user attention, and the main app correlates both streams against active focus sessions to produce per-session distraction and depth-of-work analytics.

### 12.2 Connection model (high level)

Both clients use the same pattern:

1. **Capture locally** to a durable outbox (IndexedDB in the extension, append-only JSONL file in the desktop app).
2. **Flush periodically** in batches via authenticated REST calls to a single ingest endpoint on this API.
   - Trigger: every 60s, or when ≥50 events queued, or on reconnect/wake/shutdown — whichever comes first.
3. **Wait for per-event acknowledgement** in the server response.
4. **Delete locally only what the server confirms** it accepted (or deduplicated).
5. **Survive offline periods** for up to 30 days / 100,000 events; beyond that, drop oldest events silently. No synthetic gap-marker event in v1 — the absence of data is the signal.

There is no WebSocket / push channel between server and clients in v1 — clients always initiate.

### 12.3 Authentication

Each install of either client is treated as a separate **device**. Devices authenticate with a long-lived, scoped API key (`telemetry:write`), bootstrapped via a **6-digit pairing code** entered in the web app's Settings → Devices screen.

- Keys are minted per-device, not per-user. A user with two browsers + one laptop has three keys.
- Keys are scoped — they can ingest telemetry events but cannot read tasks, projects, or any other user data.
- Keys are revocable per-device from the web app.
- Keys are stored in the OS keychain (desktop) or `chrome.storage.local` (extension, with documented limitation).

Full auth spec for both sides of the flow — the device's API-key path AND the web app's JWT requirement for the pairing claim — lives in `Features Markdown/Auth.md` §5. The JWT vs API-key guard separation, the `ft_live_` prefix format, the hash-only storage rule, and the rate-limit posture on the unauthenticated bootstrap endpoints are all defined there.

### 12.4 Data contract (high level — full schema TBD)

A **unified raw event shape** covers both sources, distinguished by `source: "browser" | "desktop"`. Events are sent as raw focus-change records, **not** pre-aggregated. Aggregation happens server-side in background jobs.

Each event carries:
- A stable **client-generated ID** (ULID/UUID v7) for idempotent ingest.
- A time window (`startedAt` / `endedAt`, both ISO 8601 UTC).
- A **target** discriminated by source: `{ kind: "website", domain, url?, tabTitle }` or `{ kind: "app", appName, appBundleId, windowTitle? }`.
- An **event type** from a small enum: `focus_change`, `heartbeat`, `session_start`, `session_end`. Source clients still perform internal OS-level idle detection to bound the `endedAt` of in-flight `focus_change` events (so a locked-screen laptop doesn't turn into a 14-hour "Cursor" event), but idle is not a wire-protocol event in v1.
- Client metadata: `deviceId`, `clientVersion`.

Events are POSTed in batches of up to 50 inside a small envelope (`batchId`, `deviceId`, `clientNow`, `events`). The server responds with the list of `accepted`, `duplicates`, and `rejected` IDs so the client knows exactly what to delete locally vs. retry.

### 12.5 What the server is responsible for

- **Always-on ingest.** Telemetry events are accepted regardless of whether a Focus Session is currently active. Sessions never gate ingest — they only add a label. See `Features Markdown/FocusSession.md` §1 and §7.
- **Idempotent ingest.** Upsert by client event ID; duplicate batch retries are safe.
- **Background aggregation.** Roll raw events into the `activity_minute_rollup` table via a scheduled job (`@nestjs/schedule`). Hour / day views are computed on-demand at read time via SQL aggregation over the minute table — no separate hour or day rollup tables in v1. See `Features Markdown/Activity.md` §3.2.
- **Focus-session correlation.** At ingest, stamp `focusSessionId` on each event by looking up the active session at `event.startedAt`. If no session covers that timestamp, `focusSessionId` stays `null` — the event still lands in the raw table and still gets rolled up into the Activity aggregates. Clients stay dumb; no polling for "is a session active right now?".
- **Category rules.** _Deferred to v2._ Per-app / per-domain categorization at aggregation time is out of v1 scope (see `Activity.md` §2 / §9). Mentioned here only so the schema doesn't paint into a corner — adding a future `categoryId` to a `target_meta` table is straightforward.
- **Device lifecycle.** Pairing code issuance/exchange, key minting/hashing, revocation. Per-device `lastSeen` (bumped on any authenticated request) and `lastSuccessfulIngestAt` (bumped only on non-empty accepted batches) are persisted on the `Device` row — drives the Settings → Devices list (`Settings.md` §4.4). Resolves the previous open question about how the server tracks "last seen".

**Downstream consumers of the always-on stream:**
- `Features Markdown/Activity.md` — primary surface; reads the minute rollup, aggregates on demand.
- `Features Markdown/MementoMori.md` §4.2 — base shading aggregated from the minute rollup over weekly windows.
- `Features Markdown/FocusSession.md` §8.4 — post-session breakdown reads events `WHERE focusSessionId = :id` (the labeled subset).

### 12.6 API surface (sketch — full shapes go in §7)

These endpoints will be the contract between the two source clients and this API:

| Method | Path                                          | Purpose                                          |
| ------ | --------------------------------------------- | ------------------------------------------------ |
| POST   | `/v1/telemetry/events`                        | Batch ingest of raw focus events                 |
| POST   | `/v1/devices/pairing-codes`                   | Device requests a 6-digit pairing code           |
| GET    | `/v1/devices/pairing-codes/{code}`            | Device polls for completed pairing → API key     |
| POST   | `/v1/devices/pairing-codes/{code}/claim`      | Web app confirms a pairing code for current user |
| GET    | `/v1/devices`                                 | List user's paired devices (web app)             |
| DELETE | `/v1/devices/{deviceId}`                      | Revoke a device's API key                        |
| GET    | `/v1/focus-sessions/current`                  | (optional) Used only if a client opts in to live session awareness |

Full request/response shapes, validation rules, error envelopes, and rate limits are deferred to §7 (API Surface) and will be defined when this slice is implemented.

### 12.7 Key design decisions (already locked in)

| Decision                                              | Choice                                                 |
| ----------------------------------------------------- | ------------------------------------------------------ |
| Push model                                            | Periodic batched POST from client → server             |
| Real-time channel                                     | None for v1                                            |
| Raw vs pre-aggregated events                          | Raw on the wire; aggregated server-side                |
| Local persistence (extension)                         | IndexedDB via `idb`                                    |
| Local persistence (desktop)                           | Append-only JSONL file                                 |
| Flush interval (default)                              | 60 seconds                                             |
| Max events per batch                                  | 50                                                     |
| Outbox backpressure cap                               | 30 days OR 100,000 events                              |
| Auth model                                            | Per-device, long-lived, scoped API key (`telemetry:write`) |
| Pairing UX                                            | 6-digit numeric code, 5-min lifetime                   |
| Event ID generation                                   | Client-side, ULID/UUID v7, server upserts idempotently |
| Focus-session correlation                             | Server-side at ingest                                  |
| Cross-project type sync                               | Single pnpm monorepo; `packages/shared` exports TS types for api, web, extension, and the desktop app's Tauri UI. The desktop Rust core hand-mirrors the same shapes in `events.rs`, with comment-level cross-references on both sides; the API's DTO validation acts as the runtime safety net for drift. |

### 12.8 Open questions to resolve before implementation

- API/data schema versioning strategy as the contract evolves over time (path-based `/v1/`, or a `schemaVersion` field in the envelope, or both). For personal-use v1, path-based `/v1/` only is fine; revisit when breaking changes loom.
- Concrete data-retention policy for raw events (e.g. keep raw events 90 days, the minute rollup forever). Single-user volume is low; "keep everything for now" is the v1 default.
- Client-side error reporting (extension or desktop app crashing before they can even send anything to the server) — likely a local rolling log file viewable from the source client's own UI, no third-party telemetry. See `Sources Markdown/DesktopApp.md` for the existing local-log mention. Not part of the web app.
- Once/if the API moves off localhost: HTTPS / cert strategy (self-signed for LAN, real cert via Let's Encrypt for VPS), and any required CORS / host-permission changes in the clients.

