// Typed wrappers around the Tauri `invoke` bridge. Keeps the React side from
// stringly-typed command names and centralises the marshalling shapes so
// the Rust side (src-tauri/src/commands.rs) and TS side share one contract.
//
// Each function here matches one `#[tauri::command] fn ...` in commands.rs;
// keep the names in sync.

import { invoke } from '@tauri-apps/api/core';

/// State the React app needs to render the right screen on launch.
/// Mirrors `DesktopState` in commands.rs.
export interface DesktopState {
  /// Path to the on-disk config file (informational; shown in the UI).
  configPath: string;
  /// Currently-configured API base URL.
  apiBaseUrl: string;
  /// True if a device record + API key are present.
  paired: boolean;
  /// Persistent UUIDv4 this install uses to identify itself.
  deviceId: string;
  /// User-editable display label (default: hostname).
  label: string;
  /// Last reported by the daemon — null on a fresh install.
  lastFlushAt: string | null;
  /// True iff the capture + flush + heartbeat tokio tasks are running.
  /// Implies `paired === true`. False during the brief window between
  /// pair-claim and daemon spawn, and after a 401/403-induced shutdown.
  daemonRunning: boolean;
  /// Capture loop currently paused (via Settings or tray). Persisted.
  paused: boolean;
  /// Number of events currently sitting in the outbox waiting to flush.
  queueDepth: number;
}

/// Returned by `start_pairing` — opaque handle the React side polls against.
export interface PairingHandle {
  code: string;
  expiresAt: string;
}

/// `poll_pairing` returns one of these.
export type PairingStatus =
  | { status: 'pending' }
  | { status: 'claimed'; deviceId: string; label: string }
  | { status: 'expired' };

/// Returns the current desktop daemon state. Called on startup + after every
/// successful command that mutates the state.
export async function getState(): Promise<DesktopState> {
  return invoke<DesktopState>('get_state');
}

/// Persists the API base URL the daemon will pair against. Refuses when a
/// device is already paired (Rust side enforces — DesktopApp.md §19).
export async function setApiBaseUrl(url: string): Promise<DesktopState> {
  return invoke<DesktopState>('set_api_base_url', { url });
}

/// Hits the configured API's `POST /v1/devices/pairing-codes` and returns
/// the freshly-minted 6-digit code. Pairing state is persisted in-memory
/// in the Rust daemon and finalised when the user runs `poll_pairing` and
/// gets `claimed`.
export async function startPairing(): Promise<PairingHandle> {
  return invoke<PairingHandle>('start_pairing');
}

/// Polls `GET /v1/devices/pairing-codes/:code` and either returns `pending`
/// / `expired`, or — on `claimed` — atomically writes the API key to the
/// OS keychain and the device row to disk before returning.
export async function pollPairing(): Promise<PairingStatus> {
  return invoke<PairingStatus>('poll_pairing');
}

/// Cancels any in-flight pairing handle (no API call — server-side codes
/// expire on their own).
export async function cancelPairing(): Promise<void> {
  return invoke<void>('cancel_pairing');
}

/// Wipes the API key from the keychain and the device row from disk.
/// The Device row in the API DB is NOT revoked from this side — that lives
/// in the web app's Settings → Devices. If the user wants a full unpair,
/// they should also revoke via the web app.
export async function unpairLocal(): Promise<DesktopState> {
  return invoke<DesktopState>('unpair_local');
}

/// Toggles the capture loop. When paused, no new focus_change events are
/// recorded; any in-flight event is finalised. Persisted to disk.
export async function setPaused(paused: boolean): Promise<DesktopState> {
  return invoke<DesktopState>('set_paused', { paused });
}

/// Opens the configured dashboard URL in the user's default browser. In
/// dev, the Rust side rewrites `:3000` → `:5173` so this lands on the Vite
/// dev server for the web app.
export async function openDashboard(): Promise<void> {
  return invoke<void>('open_dashboard');
}

/// One row of the "Recent activity" live feed shown under the Capture
/// section of the Paired view. Flattened from the wire `StoredEvent`
/// shape; mirrors `RecentEventForFrontend` in commands.rs.
export interface RecentEvent {
  id: string;
  kind: 'focus_change' | 'heartbeat' | 'session_start' | 'session_end';
  /// `appName` for desktop / `domain` for browser focus_change events.
  /// `null` for non-focus events (heartbeats and session lifecycle).
  app: string | null;
  /// RFC3339 timestamp of when the foreground app switched to this target
  /// (or when the lifecycle event fired).
  startedAt: string;
  /// Bounded duration in ms. `null` for events that are pure timestamps
  /// (heartbeats, session_start, session_end).
  durationMs: number | null;
}

/// Returns up to 25 of the most recent events the daemon has captured,
/// newest first. Independent of flush state — events stay in the buffer
/// even after the outbox flushes them to the API.
export async function getRecentEvents(): Promise<RecentEvent[]> {
  return invoke<RecentEvent[]>('get_recent_events');
}
