# Focus Tracker — Desktop App (Source Spec)

> Companion desktop application for the Focus Tracker web app.
> Captures **foreground application usage** on the user's computer (which app/window has focus and for how long) and pushes it to the Focus Tracker API.
> One of two telemetry sources alongside the browser extension.

**Status:** Specification in progress. Will be built and shipped as a **separate project / repo**. The contract with the main app is captured here so the two repos stay in sync.

---

## 1. Overview

The desktop app runs continuously in the background of the OS, listening for foreground-window changes. It records which application (and optionally which window) is in focus and ships those events in batches to the main Focus Tracker API.

It has no main window in steady state — interaction happens through a system-tray icon and a small settings window for pairing and privacy controls.

### 1.1 Scope

Mirrors the main project (see `PROJECT.md` §1.1):

- **Single-user** (just me). No multi-tenant concerns.
- **Local-first.** Default API base URL is `http://localhost:3000`; configurable in the settings window if/when the API moves to a self-hosted URL later.
- **Pairing flow stays** even though there's only one user — it's still the cleanest way to bootstrap a per-device API key and good practice for the future.
- **Lives inside the main pnpm monorepo** as `apps/desktop/`, not a separate repo. The Tauri UI (React + TS) imports event/batch/response shapes from `@focus-tracker/shared`. The Rust core hand-mirrors the same shapes in `src-tauri/src/events.rs`, with comment-level cross-references on both sides (see `PROJECT.md` §12.7).

---

## 2. Goals & Non-Goals

### Goals
- Cross-platform: Windows, macOS, Linux from one codebase.
- Tiny footprint — low CPU when idle, ~10 MB binary, single-digit MB of RAM.
- Survive sleep/wake, network outages, crashes.
- Respect privacy: app-only tracking (no window titles, ever), never-captured list of sensitive event categories (see §11).
- Background-first UX: system tray + small settings window only.

### Non-Goals (v1)
- **Never** captured: keystrokes, mouse paths, screenshots, clipboard contents.
- Mobile (iOS/Android) — separate surface, future.
- Browser-internal tracking — the browser extension owns that.
- Per-window-title / per-document tracking. v1 captures the app only. Rationale: titles fragment the rollup table (Notion's "Project A" vs "Project B" become distinct rows even though both are "Notion"), inflate storage, and leak document names. App-level granularity is what "time on tools" reporting needs anyway.

---

## 3. Tech Stack

| Concern         | Choice                                                                        | Notes                                                  |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Framework       | **Tauri 2.x**                                                                 | Rust core + small system webview UI; ~10 MB binary     |
| Core language   | **Rust**                                                                      | Capture loop, outbox, networking                       |
| UI language     | **TypeScript + React 18**                                                     | Reuses styling/components from the main web app        |
| Window capture  | `active-win-pos-rs` or platform-specific crate                                | Foreground window detection                            |
| Auto-launch     | `auto-launch` crate                                                           | Start at login (opt-in)                                |
| Local storage   | **Append-only JSONL file** in app-data dir                                    | Upgrade to embedded SQLite later if needed             |
| Secret storage  | **OS keychain** via `tauri-plugin-stronghold` or `tauri-plugin-keyring`       | API key never in plaintext on disk                     |
| HTTP client     | `reqwest`                                                                     |                                                        |
| System tray     | Tauri tray API                                                                |                                                        |
| Tests           | `cargo test` for Rust; Vitest for UI                                          |                                                        |
| Lint / format   | `clippy`, `rustfmt`, ESLint, Prettier                                         |                                                        |

---

## 4. Platform Support

| OS       | Status (v1)         | Foreground API                                              | Notes                                                |
| -------- | ------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Windows  | Primary             | `GetForegroundWindow` + `GetWindowText` + `GetWindowThreadProcessId` | Win 10 1809+ and Win 11 — see §4.1                   |
| macOS    | Primary             | `NSWorkspace.shared.frontmostApplication`                  | Window titles require **Accessibility** permission   |
| Linux    | Best-effort (X11)   | X11 `_NET_ACTIVE_WINDOW`                                    | Wayland deferred (no portable API as of 2026)        |

### 4.1 Windows version matrix

**Minimum:** Windows 10 build **1809** (October 2018) — Tauri 2's own floor, also the version where modern Win32 + WebView2 stabilised.

| Version              | Status            | Notes                                                       |
| -------------------- | ----------------- | ----------------------------------------------------------- |
| Windows 11 (any)     | Primary, tested   | Daily dev target. WebView2 pre-installed by the OS.         |
| Windows 10 22H2      | Tested            | Spot-checked on a VM before merging to `main`.              |
| Windows 10 1809+     | Supported         | All Win32 APIs we use are stable since 1809; not actively tested. |
| Windows 10 < 1809    | **Unsupported**   | Tauri 2 itself refuses to install.                          |
| Windows 7 / 8 / 8.1  | **Unsupported**   | EOL, no WebView2.                                           |

All foreground/idle/power APIs we use (§7.1, §7.2) are identical between Win 10 and Win 11. There are **no `cfg!(...)` branches between Win 10 and Win 11** anywhere in the Rust code — if there are, treat that as a bug.

### 4.2 WebView2 runtime distribution

The Tauri UI shell needs Microsoft's WebView2 runtime. Strategy: **`embedBootstrapper`** — the runtime installer is bundled inside our `.msi`.

| Property               | Value / Rationale                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `bundle.windows.webviewInstallMode.type` | `"embedBootstrapper"` (set in `tauri.conf.json`)                       |
| Installer size impact  | ~160 MB MSI (vs ~5 MB with `downloadBootstrapper`)                                      |
| Offline install        | Yes — works on a freshly-imaged Win 10 box with no internet                             |
| First-run experience   | No "downloading runtime…" delay                                                         |
| Trade-off accepted     | Larger download. Acceptable at personal-use scale (one user, infrequent installs).      |

---

## 5. OS-Level Permissions

### macOS
- **No special permissions required** in v1. App-name detection via `NSWorkspace.frontmostApplication` is unrestricted; we deliberately don't read window titles, so the Accessibility and Screen Recording prompts that title-reading would require are avoided.

### Windows
- No special permissions for foreground window detection (works identically on Win 10 1809+ and Win 11).
- Auto-launch uses HKCU `\Run` registry key — no admin required.
- WebView2 runtime requirement is handled by the bundled bootstrapper (§4.2) — no separate prompt or download.
- **Code signing strongly recommended** to avoid SmartScreen warnings on download/install.

### Linux
- X11: no extra permissions.
- Wayland: each compositor has its own (incompatible) protocol; treated as out-of-scope for v1.

---

## 6. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Rust Core (background, runs always)                                 │
│  ├── Capture loop  — polls foreground window every N ms             │
│  ├── Outbox        — append-only JSONL file                         │
│  ├── Flusher       — tokio task: 60s interval + threshold trigger   │
│  ├── Auth          — device API key in OS keychain                  │
│  ├── HTTP          — reqwest with Bearer token                      │
│  └── Power events  — listens for sleep/wake, network reconnect      │
└─────────────────────────────────────────────────────────────────────┘
        ▲                                       ▲
        │ Tauri command bridge                  │ Tauri command bridge
        ▼                                       ▼
┌──────────────────────┐                ┌─────────────────────────────┐
│ System Tray          │                │ Settings Window (React)     │
│  - current app       │                │  - pairing flow             │
│  - queue depth       │                │  - capture pause toggle     │
│  - pause toggle      │                │  - auto-launch toggle       │
│  - open dashboard    │                │  - recent activity feed     │
│  - settings…         │                │  - last sync, version       │
│  - quit              │                │                             │
└──────────────────────┘                └─────────────────────────────┘
```

---

## 7. Data Captured

### 7.1 Event Types

Same set as the browser extension:

| Type              | Emitted when                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `focus_change`    | Foreground app/window changes                                         |
| `heartbeat`       | Every 60s while running                                               |
| `session_start`   | Daemon process spins up                                               |
| `session_end`     | Daemon process is shutting down                                       |

**Idle handling is internal-only — not a wire event.** The daemon uses OS-level idle detection (no keyboard/mouse for ≥60s, screen-lock signal, sleep/wake) purely to bound the `endedAt` of the in-flight `focus_change` event. On idle-detected, finalise the current event with `endedAt = idle-detection-time` and stop tracking; on activity resume, start a fresh `focus_change` event. This prevents a closed laptop overnight from being recorded as a 9-hour "Cursor" event without paying the cost of a separate idle event stream on the wire.

### 7.2 Raw Event Shape

```jsonc
{
  "id": "01J9X...ULID",
  "source": "desktop",
  "deviceId": "uuid-of-this-install",
  "type": "focus_change",
  "startedAt": "2026-06-10T15:04:00.000Z",
  "endedAt":   "2026-06-10T15:07:42.000Z",
  "durationMs": 222000,
  "target": {
    "kind": "app",
    "appName": "Cursor",
    "appBundleId": "com.cursor.Cursor"             // macOS bundle id / Windows AUMID / Linux desktop-file id
    // windowTitle is deliberately NEVER emitted — see §2 Non-Goals and §11
  },
  "category": null,
  "focusSessionId": null,
  "clientVersion": "1.0.0"
}
```

---

## 8. Local Storage — JSONL Outbox

### 8.1 File location

| OS       | Path                                                            |
| -------- | --------------------------------------------------------------- |
| Windows  | `%APPDATA%\FocusTracker\outbox.jsonl`                           |
| macOS    | `~/Library/Application Support/FocusTracker/outbox.jsonl`       |
| Linux    | `~/.local/share/focus-tracker/outbox.jsonl`                     |

### 8.2 Operations

- **Append on capture:** `fs::OpenOptions::new().append(true).open(...)` + write one JSON object + `\n`.
  - Single-line writes are atomic at the filesystem level on every modern OS.
- **Drain on flush:** read up to 50 lines from the head of the file.
- **Delete acked events:** rewrite the file without the acked lines using the atomic-rename pattern:
  1. Write surviving lines to `outbox.jsonl.tmp`.
  2. `fs::rename("outbox.jsonl.tmp", "outbox.jsonl")` (atomic on POSIX and Windows).
- **Backpressure cap:** 30 days **OR** 100,000 events. On exceed: drop oldest silently (no synthetic gap-marker event in v1 — see `PROJECT.md` §12.2 / §12.4).
- **Concurrency:** single in-process `tokio::sync::Mutex` around all file ops; only one daemon runs per machine (singleton enforced on launch).

### 8.3 Secrets

- **Device API key:** OS keychain only (`tauri-plugin-stronghold` / `keyring`). Never written to the outbox file or any plaintext config.
- **Device ID:** plaintext is fine — it's just a UUID with no auth power on its own.

---

## 9. Sync / Flush State Machine

### Triggers
1. **Time-based:** tokio interval timer every 60s.
2. **Buffer threshold:** ≥50 events in the outbox file.
3. **Lifecycle:** on graceful shutdown — attempt one final flush.
4. **Power events:** on wake from sleep, fire an immediate flush.
5. **Reconnect:** on OS connectivity-up event, fire an immediate flush.

### Per-flush logic
Identical to the extension (see `Extension.md` §8). Same idempotent batch POST, same response handling, same single-flight mutex, same dead-letter rule for permanently-rejected events.

---

## 10. Authentication

Identical contract to the extension (see `Extension.md` §9).

- Pairing: 6-digit code, 5-min lifetime, polled every 3s.
- Token: long-lived `ft_live_...`, scoped `telemetry:write`, stored in the OS keychain.
- Request headers:
  ```
  POST /v1/telemetry/batch HTTP/1.1
  Authorization: Bearer ft_live_a1b2c3...
  Content-Type:  application/json
  X-Client:      focus-tracker-desktop/1.0.0
  ```
- Body envelope identical to the extension's (§9.2).

---

## 11. Privacy Controls

| Control                              | Default     | Notes                                                       |
| ------------------------------------ | ----------- | ----------------------------------------------------------- |
| App-only tracking                    | **Always on** | Window titles are never captured. Not user-toggleable — see §2 Non-Goals. |
| Pause toggle (tray + settings)       | Off         | While paused: capture and flush both halt; queue preserved  |
| Idle/sleep handling                  | Internal-only — used to bound `focus_change.endedAt`; not a wire event in v1 (see §7.1) |

Things the app **never** captures, regardless of settings:
- Keystrokes
- Mouse paths
- Clipboard contents
- Screenshots / screen content
- Audio / camera

---

## 12. Auto-Start

- Opt-in during onboarding.
- Toggle in Settings.
- Implementation via `auto-launch` crate (registry key on Windows, LaunchAgent plist on macOS, `.desktop` file on Linux).

---

## 13. Updates

- Tauri's built-in updater pointing at a self-hosted manifest URL.
- Check on startup + once per 24h.
- Updates are user-approved (no silent install).
- Signed manifests required.

---

## 14. Distribution & Code Signing

| OS       | Installer            | Signing                                               |
| -------- | -------------------- | ----------------------------------------------------- |
| Windows  | `.msi` (WiX/Tauri)   | EV code-signing cert recommended (avoid SmartScreen)  |
| macOS    | `.dmg`               | Apple Developer ID required; notarization required    |
| Linux    | `.AppImage`, `.deb`  | No signing infrastructure needed                      |

Code signing has real cost (Apple Developer Program, EV cert). If deferred, document the SmartScreen / Gatekeeper warnings users will see and how to bypass them, and budget for signing before public release.

---

## 15. Documentation Convention

Same rule as the main project: **every non-trivial module ships with a co-located `.md` spec** describing purpose, public API, internal behavior, dependencies, data flow, error states, testing notes, and open questions. See `PROJECT.md` §3.

Expected spec files include:
- The Rust capture loop
- The Rust outbox module (JSONL layer)
- The Rust flusher / state machine
- The Tauri command bridge
- The system-tray module
- Each React route in the settings window
- The pairing flow

---

## 16. Telemetry of the Telemetry

The daemon must not fail silently. Required signals:
- Local rolling error log file (last N MB), shown in Settings → Diagnostics for bug reports.
- Dead-letter count surfaced in the tray menu if non-zero.
- Optional anonymous error reporting (opt-in) — TBD whether Sentry, Tauri Plugin Log, or a custom `/v1/telemetry/diagnostics` endpoint.

---

## 17. Server-side Correlation Hooks

Same model as the extension: the desktop daemon does **not** know if a focus session is active in the main app. The **server** stamps `focusSessionId` at ingest time by looking up the user's active session at `event.startedAt`. Keeps the daemon dumb and avoids polling traffic.

---

## 18. Open Questions / TODOs

- Linux Wayland support strategy (or formal "X11-only" stance) for v1.
- Whether to ship Linux at all in v1 — depends on whether I actually use Linux for focus work.
- Tray-tooltip "today's stats" — local read-cache or API call?
- Should the desktop app expose a global hotkey to start/stop a focus session, or does that stay in the web app only?
- Crash reporting (Sentry, Tauri's logger, or just local files).
- Code-signing decision — defer until/unless this leaves my own machine.
- Singleton enforcement strategy (named pipe on Windows, lockfile on POSIX).
- Capture polling cadence vs OS-event subscriptions — start with polling, migrate to native events if CPU is noticeable.

---

## 19. API Base URL Configuration

Because this is a local-first project (see §1.1), the desktop app must not hard-code its target API origin.

| Mode                       | API base URL example         | How it's set                                   |
| -------------------------- | ---------------------------- | ---------------------------------------------- |
| Local dev (default)        | `http://localhost:3000`      | Default value baked into the build             |
| Other localhost port       | `http://localhost:XXXX`      | Editable in the settings window before pairing |
| Self-hosted later          | `https://focus.mydomain.tld` | Editable in the settings window before pairing |

Rules:

- The URL is stored in a small plaintext config file (e.g. `config.json` next to `outbox.jsonl`). The API key itself stays in the OS keychain — never in this config.
- It can only be changed when **no device is paired**. To switch URLs after pairing, the user re-pairs against the new server (the old API key is invalidated locally).
- On startup, the Rust core validates the URL is reachable (HEAD `/v1/health`) and surfaces a clear error in the settings window if not.
- `reqwest` accepts both HTTP and HTTPS; for localhost dev, HTTP is fine. For a self-hosted HTTPS endpoint with a self-signed cert (e.g. LAN deployment), the settings window will need an explicit "trust this certificate" toggle — deferred until that scenario exists.
