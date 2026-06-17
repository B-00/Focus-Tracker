# Focus Tracker — Browser Extension (Source Spec)

> Companion browser extension for the Focus Tracker web app.
> Captures **website focus events** (which domain/tab is active and for how long) and pushes them to the Focus Tracker API.
> One of two telemetry sources alongside the desktop app.

**Status:** Specification in progress. Will be built and shipped as a **separate project / repo**. The contract with the main app is captured here so the two repos stay in sync.

---

## 1. Overview

The extension runs continuously in the background of the browser. It observes which tab/window is currently focused, records that as a stream of `focus_change` events, and ships those events in batches to the main Focus Tracker API.

It does **not** require a web page or content script — capture is done entirely from the background service worker using the browser's tab/window/idle APIs.

### 1.1 Scope

Mirrors the main project (see `PROJECT.md` §1.1):

- **Single-user** (just me). No multi-tenant concerns.
- **Local-first.** Default API base URL is `http://localhost:3000`; the user (me) can change it in the options page if/when the API moves to a self-hosted URL later.
- **Pairing flow stays** even though there's only one user — it's still the cleanest way to bootstrap a per-device API key, and good practice for the future.
- **Lives inside the main pnpm monorepo** as `apps/extension/`, not a separate repo. Imports event/batch/response shapes from `@focus-tracker/shared` (see `PROJECT.md` §12.7) so types stay in sync with the API automatically.

---

## 2. Goals & Non-Goals

### Goals
- Measure website usage with second-level accuracy.
- Survive offline periods, browser restarts, service-worker death, and unexpected crashes.
- Respect privacy: domain-only by default, incognito always off.
- Cross-browser: Chrome, Firefox, Edge from one codebase.
- Minimal footprint — no content scripts, no DOM injection, no telemetry from page content.

### Non-Goals (v1)
- Tracking inside iframes or specific page elements.
- Reading page content, form data, or DOM state.
- Productivity scoring on the client (the server categorizes/aggregates).
- Local-only mode with no sync.
- Mobile browsers.

---

## 3. Tech Stack

| Concern         | Choice                                                  | Notes                                                            |
| --------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| Manifest        | **Manifest V3 (MV3)**                                   | Required by Chrome. Firefox MV3 is mature as of 2025.            |
| Language        | **TypeScript** (strict)                                 |                                                                  |
| Build tool      | **Vite** with `@crxjs/vite-plugin`                      | HMR for the popup; bundles the service worker properly.          |
| Popup UI        | **React 18 + TypeScript**                               | Reuse shadcn/ui + Tailwind patterns from the main web app.       |
| Local storage   | **IndexedDB** via the `idb` wrapper (~3 KB)             | Outbox pattern.                                                  |
| Settings store  | `chrome.storage.local`                                  | Pairing state, API key, user prefs.                              |
| Cross-browser   | **`webextension-polyfill`**                             | Single codebase → Chrome, Firefox, Edge.                         |
| Icons           | **Lucide React**                                        | Matches the main app's stroke style.                             |
| Tests           | **Vitest** for unit (opt-in, where logic is non-obvious); no E2E in v1 (per `PROJECT.md` §2.3) |                                                                  |
| Lint / format   | ESLint + Prettier                                       |                                                                  |

---

## 4. Required Permissions (`manifest.json`)

| Permission                          | Why                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `storage`                           | Settings, API key, pairing state                                                   |
| `unlimitedStorage`                  | Removes the 10 MB cap on the IndexedDB outbox (free, no extra install prompt)      |
| `tabs`                              | Read active tab metadata (`url`, `title`)                                          |
| `idle`                              | Detect AFK transitions via `chrome.idle.onStateChanged`                            |
| `alarms`                            | Drive the flush timer (`setInterval` does **not** survive service-worker death)    |
| `host_permissions: <all_urls>`      | Required to read the URL of the focused tab on any domain                          |
| `host_permissions: http://localhost/*` (dev) / configured API URL (later) | Required for `fetch()` to the Focus Tracker API |

The install screen should explain plainly **why** each permission is requested — especially `<all_urls>`, which sounds scarier than it is.

> **Note on the API host permission.** While the API lives on `http://localhost:3000` in local-first mode, Chrome/Firefox will allow `fetch()` from the service worker to that origin if it's covered by `host_permissions`. When the API later moves to a real URL, the options page either prompts the user to grant the new host (via `chrome.permissions.request`) or the new URL ships in a bumped manifest. Either approach is documented in §17.

---

## 5. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ Background Service Worker (MV3)                                │
│  ├── Capture: chrome.tabs.*, chrome.windows.*, chrome.idle.*   │
│  ├── Outbox: IndexedDB (idb)                                   │
│  ├── Flusher: chrome.alarms (60s) + threshold trigger          │
│  ├── Auth:  device API key in chrome.storage.local             │
│  └── HTTP:  fetch() with Bearer token                          │
└────────────────────────────────────────────────────────────────┘
          ▲                                       ▲
          │ messages                              │ messages
          ▼                                       ▼
┌──────────────────────┐                ┌──────────────────────┐
│ Popup (React)        │                │ Options Page (React) │
│  - current site      │                │  - pairing flow      │
│  - queue depth       │                │  - privacy controls  │
│  - pause toggle      │                │  - permissions help  │
│  - last sync time    │                │                      │
└──────────────────────┘                └──────────────────────┘
```

**No content scripts** in v1. All capture is event-driven from the background.

---

## 6. Data Captured

### 6.1 Event Types

| Type              | Emitted when                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `focus_change`    | Active tab or focused window changes                                |
| `heartbeat`       | Every 60s while extension is awake (liveness signal)                |
| `session_start`   | Service worker spins up                                             |
| `session_end`     | Service worker is shutting down (best-effort)                       |

**Idle handling is internal-only — not a wire event.** The service worker subscribes to `chrome.idle.onStateChanged` (`idle` / `locked` / `active`) purely to bound the `endedAt` of the in-flight `focus_change` event. On transition to `idle` or `locked`, finalise the current event with `endedAt = idle-detection-time` and stop tracking; on `active`, start a fresh `focus_change` event. This prevents a left-open browser tab from accumulating phantom time while the user is away.

### 6.2 Raw Event Shape

```jsonc
{
  "id": "01J9X...ULID",            // client-generated; ULID/UUID v7 (sortable)
  "source": "browser",
  "deviceId": "uuid-of-this-install",
  "type": "focus_change",
  "startedAt": "2026-06-10T15:04:00.000Z",  // ISO 8601 UTC
  "endedAt":   "2026-06-10T15:07:42.000Z",  // ISO 8601 UTC
  "durationMs": 222000,
  "target": {
    "kind": "website",
    "domain": "github.com",
    "url": null,                    // full URL is opt-in; null by default
    "tabTitle": "PROJECT.md — Focus-Tracker"
  },
  "category": null,                 // server-side categorization
  "focusSessionId": null,           // server-side correlation (see §15)
  "clientVersion": "1.0.0"
}
```

---

## 7. Local Storage — IndexedDB Outbox

- **Database:** `focus_tracker_outbox`
- **Object store:** `outbox`
  - `keyPath: "id"`
  - Index `by_startedAt` for FIFO drain and cap enforcement
- **Append on capture:** `store.put(event)` (one row per event)
- **Drain on flush:** `store.index("by_startedAt").getAll(null, 50)`
- **Delete on ack:** server returns accepted + duplicate IDs → single transaction deletes them
- **Backpressure cap:** 30 days **OR** 100,000 events
  - When exceeded: drop oldest events silently (no synthetic gap-marker event in v1 — see `PROJECT.md` §12.2 / §12.4)
- **Settings store:** `chrome.storage.local` (separate from the outbox)
  - Pairing state, device API key, user preferences

**Known limitation (documented, not fixed in v1):** `chrome.storage.local` is unencrypted on disk. The device API key sitting there is industry-standard for extensions but worth disclosing in the privacy notes.

---

## 8. Sync / Flush State Machine

### Triggers
1. **Time-based:** `chrome.alarms` firing every 60s.
2. **Buffer threshold:** ≥50 events queued in the outbox.
3. **Lifecycle:** on `chrome.runtime.onSuspend` (best-effort under MV3).
4. **Reconnect:** when `navigator.onLine` flips true → fire an immediate flush.

### Per-flush logic
1. Acquire the flush mutex (single-flight; alarms can race).
2. Read up to 50 events from the outbox ordered by `startedAt`.
3. Wrap in a batch envelope (see §9.2) and POST `/v1/telemetry/batch`.
4. Handle response:
   | Status                     | Action                                                                |
   | -------------------------- | --------------------------------------------------------------------- |
   | `2xx` with body            | Delete `accepted` + `duplicates` IDs from outbox; log `rejected`      |
   | `401 Unauthorized`         | Token revoked → halt flushing, show "Re-pair device" in popup         |
   | `429 Too Many Requests`    | Back off; honor `Retry-After`                                         |
   | `5xx` / network error      | Exponential backoff with jitter; cap at 5 min                         |
5. Release the mutex.

### Permanently-rejected events
Move to a small `dead_letter` store with the server's reason. **Never** retry forever — a single poison event would otherwise block the queue.

---

## 9. Authentication

### 9.1 Pairing Flow (6-digit code)

```
┌────────────┐                  ┌──────────┐                  ┌──────────────┐
│ Extension  │                  │  Server  │                  │   Web App    │
└─────┬──────┘                  └────┬─────┘                  └──────┬───────┘
      │ POST /v1/devices/pairing-codes (deviceId, platform)  │       │
      ├────────────────────────────────────────────────────►│        │
      │                          │                          │        │
      │   { code: "482913", expiresAt }                     │        │
      │◄─────────────────────────┤                          │        │
      │                          │                          │        │
      │  show "482913" in popup  │                          │        │
      │                          │                          │        │
      │                          │   user types 482913 in   │        │
      │                          │   Settings → Devices     │        │
      │                          │◄─────────────────────────┘        │
      │                          │                                   │
      │                          │  mint ft_live_… key bound to      │
      │                          │  (user, deviceId, telemetry:write)│
      │                          │                                   │
      │ poll GET /v1/devices/pairing-codes/482913 (every 3s)         │
      ├─────────────────────────►│                                   │
      │ { apiKey: "ft_live_..." }│                                   │
      │◄─────────────────────────┤                                   │
      │                                                              │
      │ store key in chrome.storage.local; delete pairing code       │
      │                                                              │
```

- **Pairing code:** 6 numeric digits (e.g. `482913`).
- **Code lifetime:** 5 minutes; one-shot.
- **Poll interval:** every 3s from the extension; server returns `202` until claimed.

### 9.2 Request Format

Every request from the extension:

```
POST /v1/telemetry/batch HTTP/1.1
Authorization: Bearer ft_live_a1b2c3...
Content-Type:  application/json
X-Client:      focus-tracker-extension/1.0.0
```

Body (batch envelope):

```jsonc
{
  "batchId":  "01J9X...ULID",
  "deviceId": "uuid",
  "clientNow": "2026-06-10T15:08:00.000Z",
  "events":   [ /* ≤50 raw events */ ]
}
```

### 9.3 Token Lifecycle
- Long-lived (no expiry by default).
- Stored in `chrome.storage.local` (see §7 limitation note).
- On `401`: flushing halts; popup shows a "Re-pair device" CTA. Outbox is preserved.
- Revocation is one-click from the web app's Settings → Devices.

---

## 10. Privacy Controls

| Control                       | Default     | Notes                                                            |
| ----------------------------- | ----------- | ---------------------------------------------------------------- |
| Domain-only URL capture       | **On**      | `url` field is `null` unless the user opts in to full-URL mode   |
| Incognito / private windows   | **Never**   | Hard rule; not user-toggleable                                   |
| Pause toggle                  | Off         | While paused: no capture, no flush, queue preserved              |

---

## 11. Cross-Browser Support

| Browser  | Status (v1) | Notes                                                  |
| -------- | ----------- | ------------------------------------------------------ |
| Chrome   | Primary     | MV3 native                                             |
| Edge     | Primary     | Same Chromium build; ships to Edge Add-ons separately  |
| Firefox  | Primary     | Via `webextension-polyfill`; MV3 mature as of 2025     |
| Safari   | Out of v1   | Different toolchain (Xcode-based)                      |

---

## 12. Distribution

- **Chrome Web Store** (primary)
- **Firefox Add-ons (AMO)**
- **Edge Add-ons** (secondary)
- Auto-updates handled by each store; no custom updater.

---

## 13. Documentation Convention

Mirrors the main project's rule: **every non-trivial unit ships with a co-located `.md` spec.** See `PROJECT.md` §3 for the full list of what each spec must contain (purpose, public API, internal behavior, data flow, error states, accessibility, testing notes, open questions).

For the extension specifically, expect spec files for:
- The background service worker
- The outbox module (IndexedDB layer)
- The flusher / state machine
- The capture engine
- Each React route in the popup and options page
- The pairing flow

---

## 14. Telemetry of the Telemetry

The extension must not fail silently. Required signals:
- Local error log (last N errors), visible in the options page for bug reports.
- Dead-letter count surfaced in the popup if non-zero.
- Optional anonymous error reporting (opt-in) — TBD whether Sentry or a custom `/v1/telemetry/diagnostics` endpoint.

---

## 15. Server-side Correlation Hooks

The extension does **not** know if a focus session is currently active in the main app. Two options exist:

1. **Server-side correlation (recommended):** the server stamps `focusSessionId` at ingest time by looking up the user's active session at `event.startedAt`. Extension stays dumb. ← default plan.
2. **Client-side polling:** extension polls `GET /v1/focus-sessions/current` every minute and stamps events itself. More chatty; only worth it if the popup needs to show "you're in a focus session right now".

---

## 16. Open Questions / TODOs

- Does the popup show **today's top sites** locally, or via an API call? (Affects whether we keep a read-side cache in addition to the outbox.)
- Should the flush interval be user-configurable, or fixed at 60s?
- Diagnostics: opt-in error reports, just local log files, or both?
- Bug-report UX: bundle the local error log + last batch + extension version into a downloadable JSON?
- Migration path if we ever switch from `chrome.storage.local` for the API key to something more secure.
- Should the extension visibly show "you're in a focus session right now" in the popup? (Requires either §15 option 2 or a push channel.)
- Detailed key-rotation strategy if a device is compromised.

---

## 17. API Base URL Configuration

Because this is a local-first project (see §1.1), the extension must not hard-code its target API origin.

| Mode                       | API base URL example         | How it's set                                   |
| -------------------------- | ---------------------------- | ---------------------------------------------- |
| Local dev (default)        | `http://localhost:3000`      | Default value baked into the build             |
| Other localhost port       | `http://localhost:XXXX`      | Editable in the options page before pairing    |
| Self-hosted later          | `https://focus.mydomain.tld` | Editable in the options page before pairing    |

Rules:

- The URL is stored in `chrome.storage.local` under `apiBaseUrl`.
- It can only be changed when **no device is paired**. To switch URLs after pairing, the user re-pairs against the new server (the old API key is invalidated locally).
- On startup, the service worker validates the URL is reachable (HEAD `/v1/health`) and surfaces a clear error in the popup if not.
- When the URL changes to a new host, the extension calls `chrome.permissions.request({ origins: [newUrl + "/*"] })` to acquire the host permission at runtime, so the manifest doesn't need to ship with every possible URL pre-listed.
- Mixed-content rules apply normally: an `https://` web app cannot talk to an `http://` API. For localhost, both should be HTTP in dev.
