//! Plaintext on-disk config (`config.json`) next to the outbox file.
//!
//! Holds non-secret state the daemon needs across launches:
//!   * `api_base_url`     — where to ship telemetry (DesktopApp.md §19)
//!   * `device_id`        — UUIDv4 generated once at install
//!   * `label`            — user-visible name (default: hostname)
//!   * `last_flush_at`    — last successful batch ack (informational, in UI)
//!
//! The API key itself never lives here — it's in the OS keychain
//! (see `keychain.rs`). The `device_id` is plaintext fine; it has no auth
//! power on its own (the API key bound to it does).

use crate::errors::{AppError, AppResult};
use crate::outbox::{clamp_recent_capacity, DEFAULT_RECENT_CAPACITY};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub const QUALIFIER: &str = "app";
pub const ORG: &str = "Focus Tracker";
pub const APP: &str = "Focus Tracker";

pub const DEFAULT_API_BASE_URL: &str = "http://localhost:3000";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopConfig {
    #[serde(default = "default_api_base_url")]
    pub api_base_url: String,

    /// Persistent UUIDv4 — never changes after first launch.
    pub device_id: String,

    /// Display label shown in the web app's Settings → Devices. Mutable.
    pub label: String,

    /// ISO-8601. None until first successful batch ack.
    #[serde(default)]
    pub last_flush_at: Option<String>,

    /// Captured-paused toggle backed to disk so the daemon restores its
    /// last state across restarts.
    #[serde(default)]
    pub paused: bool,

    /// Size of the "Recent activity" ring buffer the daemon keeps in
    /// memory and the desktop UI renders. Persisted so the user's
    /// preference survives restarts. Reads are clamped via
    /// `clamp_recent_capacity` at load time, so an out-of-range value
    /// in a hand-edited config snaps to the nearest legal one.
    #[serde(default = "default_recent_capacity")]
    pub recent_capacity: usize,
}

fn default_api_base_url() -> String {
    DEFAULT_API_BASE_URL.to_string()
}

fn default_recent_capacity() -> usize {
    DEFAULT_RECENT_CAPACITY
}

impl DesktopConfig {
    /// Loads from disk, or initialises a fresh one and writes it through.
    pub fn load_or_init() -> AppResult<Self> {
        let path = config_path()?;
        if path.exists() {
            return Self::load_from(&path);
        }
        let cfg = Self::initial();
        cfg.save_to(&path)?;
        Ok(cfg)
    }

    fn initial() -> Self {
        let label = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "This computer".to_string());
        Self {
            api_base_url: DEFAULT_API_BASE_URL.to_string(),
            device_id: Uuid::new_v4().to_string(),
            label,
            last_flush_at: None,
            paused: false,
            recent_capacity: DEFAULT_RECENT_CAPACITY,
        }
    }

    pub fn load_from(path: &Path) -> AppResult<Self> {
        let bytes = fs::read(path)?;
        let mut cfg: Self = serde_json::from_slice(&bytes)?;
        // Defensive clamp: a hand-edited config with `recent_capacity: 0`
        // or `99999` shouldn't be able to break the UI or OOM the ring.
        cfg.recent_capacity = clamp_recent_capacity(cfg.recent_capacity);
        Ok(cfg)
    }

    pub fn save(&self) -> AppResult<()> {
        let path = config_path()?;
        self.save_to(&path)
    }

    fn save_to(&self, path: &Path) -> AppResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        // Atomic write: tmp + rename. Crash-safe on POSIX and Windows.
        let tmp = path.with_extension("json.tmp");
        let json = serde_json::to_vec_pretty(self)?;
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(&json)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, path)?;
        Ok(())
    }
}

/// Returns `<data_dir>/config.json`, where `<data_dir>` is the platform's
/// per-app data dir (DesktopApp.md §8.1):
///   * Windows  — `%APPDATA%\FocusTracker\`
///   * macOS    — `~/Library/Application Support/Focus Tracker/`
///   * Linux    — `~/.local/share/focus-tracker/`
pub fn config_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("config.json"))
}

/// Returns `<data_dir>/outbox.jsonl` — see DesktopApp.md §8.1.
pub fn outbox_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("outbox.jsonl"))
}

fn data_dir() -> AppResult<PathBuf> {
    let dirs = ProjectDirs::from(QUALIFIER, ORG, APP).ok_or_else(|| {
        AppError::config("could not resolve a per-user data directory on this platform")
    })?;
    Ok(dirs.data_dir().to_path_buf())
}
