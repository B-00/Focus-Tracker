# `@focus-tracker/extension`

Firefox extension that captures per-tab focus events and ships them in batches to the Focus Tracker API. Same event shape as the desktop client — one pipeline on the API side, two sources of events.

- **Target browser:** Firefox Developer Edition only. Not Chrome, not Safari.
- **Scope:** single user, local-first. Default API URL is `http://localhost:3000`.
- **Monorepo path:** `apps/extension/`. Shares event / batch / response shapes with `@focus-tracker/shared`.

Original design brief: [`../../Sources Markdown/Extension.md`](../../Sources%20Markdown/Extension.md). Every non-trivial module also has a co-located `spec.md`.

---

## Current state

All slices + follow-up features done. Feature-complete for personal use.

| Slice | Scope | Status |
| --- | --- | --- |
| 1 | Event-page skeleton + capture stub + spec files | ✅ |
| 2 | ULID + outbox (IndexedDB) + heartbeat + session events | ✅ |
| 3 | Toolbar popup — pairing + local stats (donut + top-N) | ✅ |
| 4 | Background flusher — batch upload with retries + auth handling | ✅ |
| — | Durable daily rollup so Stats view shows full day (not just session) | ✅ |
| — | Pause toggle, live interpolation, API-reachability pill | ✅ |
| — | Icons + unsigned `.xpi` packaging for Developer Edition install | ✅ |

Not built yet, per [`Sources Markdown/Extension.md`](../../Sources%20Markdown/Extension.md):

- **Options page** (§7, §17). API base URL and per-domain excludes are currently editable only by poking at `storage.local` in devtools. The URL default (`http://localhost:3000`) works for local-dev so this hasn't bitten us.
- **Dead-letter badge** (§14). Flusher drops events on permanent-reject (4xx that isn't 401). No count surfaced in the popup.
- **Local error log** (§14). Flush failures go to the background-page devtools console only.
- **Opt-in full-URL capture.** Currently domain + title only.

---

## File layout

```
apps/extension/
├── manifest.json          MV3 non-persistent event page
├── popup.html             Popup root (loaded by action.default_popup)
├── vite.config.ts         Multi-entry build: background.js + popup.js
├── icons/
│   ├── icon.svg           Source of truth — rounded pink square + FT wordmark
│   └── icon-{16..128}.png Rasterized via `pnpm icons` (sharp devDep)
├── scripts/
│   └── build-icons.mjs    One-shot SVG → PNGs
├── src/
│   ├── background/        Event-page: capture, state, session, heartbeat,
│   │                      flusher, drain, index (wake-time wire-up)
│   ├── popup/             Preact UI: App, PairingView, StatsView, Donut
│   ├── api/               Typed fetch wrappers: pairing, telemetry
│   ├── events/            Shared event-shape builders
│   ├── id/                ULID generator
│   └── storage/           browser.storage.local + IndexedDB wrappers:
│                          device, outbox, rollup, preferences, health
└── web-ext-artifacts/     Build output (gitignored)
```

---

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | `vite build --watch`. Rebuilds `dist/` on every source change. Does **not** launch Firefox. |
| `pnpm build` | One-shot production build. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm icons` | Rasterizes `icons/icon.svg` → `icons/icon-{16,32,48,96,128}.png`. Only re-run when the SVG source changes; PNGs are committed. |
| `pnpm webext:lint` | `web-ext lint` over `dist/`. Non-launching. |
| `pnpm webext:build` | Packages `dist/` → `web-ext-artifacts/focus-tracker-<version>.xpi` — the installable file. |

---

## Install paths

### A — Development (temporary, reloads fast)

For rapid code → reload cycles. **Cleared on every Firefox restart**, intentional.

1. `pnpm dev` in `apps/extension/`.
2. In Firefox Developer Edition: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `apps/extension/dist/manifest.json`.
3. After every save: back to `about:debugging` → **Reload** on the Focus Tracker entry. Click **Inspect** for the background-page devtools console; `[focus-tracker]` log lines appear there.

### B — Personal install (permanent, unsigned)

For daily use. Survives restarts. Works because Firefox Developer Edition / Nightly / unbranded let you disable the signature check — Firefox Release does **not**, so this path only works on Developer Edition.

**One-time per Firefox profile:**

1. `about:config` → accept the warning.
2. Search `xpinstall.signatures.required` → toggle to **false**.

**Every release:**

```bash
cd apps/extension
pnpm build          # rebuild dist/
pnpm webext:build   # → web-ext-artifacts/focus-tracker-<version>.xpi
```

**Install on any PC:**

1. Copy the `.xpi` over.
2. If a temporary version is still loaded, remove it from `about:debugging` first (otherwise Firefox complains about an extension-ID conflict).
3. `about:addons` → gear icon (top-right) → **Install Add-on From File…** → pick the `.xpi` → **Add**.

**Updating an existing install:** same install steps, but **bump `version` in both `manifest.json` and `package.json` first** — Firefox refuses to install the same version over itself. Pairing + outbox are preserved across upgrades (same `storage.local` + IndexedDB, keyed by the stable extension ID `focus-tracker@local.dev`). *(ponytail: manifest version is kept manually in sync with package.json; if this ever bites us we'd add a `sync-manifest-version` script.)*

### What we explicitly chose NOT to do

- **No AMO signing.** Only needed for Firefox Release or non-technical users.
- **No `about:debugging` as a daily driver.** It's dev-only on purpose.

---

## Self-checks

Standalone assertion scripts — no test runner, each exits non-zero on regression:

```bash
# ULID generator (26-char alphabet + monotonicity on a 1000-id burst)
node --experimental-strip-types apps/extension/src/id/ulid.check.ts

# Flusher drain loop (all five branch outcomes with in-memory fakes)
node --experimental-strip-types apps/extension/src/background/flusher.check.ts

# StatsView live-interpolation helper (paused sentinel, sort stability, clock-skew clamp)
node --experimental-strip-types apps/extension/src/popup/interpolate.check.ts
```

---

## Design decisions worth remembering

### Durable daily rollup (`src/storage/rollup.ts`)

The popup originally read totals from the IndexedDB outbox. But the flusher drains the outbox every 60s, so the popup would only ever show the last ~minute. Fix: a separate rollup store in `browser.storage.local`, written on every `focus_change` close-out in `capture.ts`. Resets at local midnight. API is still authoritative — the rollup is a local convenience.

### Live interpolation (`src/popup/StatsView.tsx` + `src/background/state.ts`)

The rollup only has data for *closed* focus intervals. The tab the user is on *right now* hasn't closed out yet, so without interpolation its time is missing from today's totals. Fix: `state.ts` write-throughs `currentFocus` to `storage.local`; `StatsView` adds `(now − startedAt)` to that domain and re-sorts every second. Freezes when paused. Covered by `src/popup/interpolate.check.ts`.

### Pause toggle (`src/storage/preferences.ts`)

Persisted `paused` boolean in `storage.local`. Two consumers:

- `capture.ts` keeps an in-memory mirror via `subscribePreferences`. `transitionTo` refuses to open a NEW focus while paused but still allows transitions to `null` (so the pause-boundary close-out works, and idle handling still fires). On the pause boundary, capture calls `transitionTo(null)` to close the in-flight focus — otherwise unpausing after 2 hours would credit those 2 hours to whatever domain was active when pause hit.
- `flusher.ts` returns a `paused` summary without touching the API.

### API reachability (`src/storage/health.ts` + `src/background/flusher.ts`)

Piggybacks on real batch uploads instead of a dedicated HEAD probe — a full round-trip with auth is a strictly stronger signal than a HEAD, and the event page wakes constantly so a per-wake probe would be chatty. The flusher writes `apiHealth` after every upload attempt (`transient` → unreachable; `ok` / `permanent` / `auth_rejected` → reachable). On popup open, if the stored status is missing or > 5 min old, a one-shot HEAD `/v1/health` runs so the pill isn't blank.

### Popup lifecycle gotchas

- **Firefox popups are destroyed on click-away.** The pairing poll loop originally ran only while the popup was open — click away and the poll died, user got stuck on "waiting for code." Fix: persist `pendingPairing` to `storage.local` so the popup resumes the poll on reopen (`src/storage/device.ts`, `PairingView.tsx`).
- **Preact + SVG attribute casing.** Firefox requires kebab-case for SVG attrs (`stroke-width`, not `strokeWidth`) — the camelCase ones get silently ignored, which is what made the donut render as a thin circle. `Donut.tsx` carries a comment on this.

### `handleSuspend` removed

Original design emitted a `session_end` every time Firefox unloaded the event page. In practice that meant fragmented sessions for every tab-switch gap. Fix: removed `handleSuspend`; `session_end` now fires only via the 30-minute inactivity gap check on the next wake.

---

## Related services

- **API:** `apps/api` — pairing endpoints (`/v1/pairing/*`), telemetry batch (`/v1/telemetry/batch`), health (`/v1/health`).
- **Web dashboard:** `apps/web` — "Open dashboard" button in the popup opens here. In dev, URL rewrite swaps `localhost:3000` → `127.0.0.1:5173`.
- **Bring everything up:** `bash scripts/dev-up.sh` from the repo root. Launches Docker Desktop if needed, waits for Postgres healthy, then kicks off api / web / desktop in parallel.

---

## Related docs

- `src/background/spec.md` — event-page internals (capture, flusher, pause, reachability)
- `src/popup/spec.md` — popup rendering model + header signals
- `../../Sources Markdown/Extension.md` — original design brief; sections cross-referenced throughout code comments
