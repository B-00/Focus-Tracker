//! Tauri commands invoked from React via `@tauri-apps/api/core#invoke`.
//!
//! Each `#[tauri::command]` here corresponds 1:1 to one of the typed
//! wrappers in `apps/desktop/src/lib/tauri.ts`. Keep them in sync —
//! command names and field names are stringly-typed on the wire.

use crate::{
    config::{config_path, DesktopConfig},
    daemon::Daemon,
    errors::{AppError, AppResult},
    events::PairingCodePollResponse,
    keychain,
    pairing::{PairingClient, PairingHandle},
};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::State;
use time::format_description::well_known::Rfc3339;

/// Mirrors `DesktopState` in `apps/desktop/src/lib/tauri.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopState {
    pub config_path: String,
    pub api_base_url: String,
    pub paired: bool,
    pub device_id: String,
    pub label: String,
    pub last_flush_at: Option<String>,
    // Daemon-driven runtime state. Present whether or not the daemon is
    // currently running; consumers should still gate UI on `paired`.
    pub daemon_running: bool,
    pub paused: bool,
    pub track_titles: bool,
    pub queue_depth: usize,
}

/// `poll_pairing` return shape — matches the TS `PairingStatus`
/// discriminated union. We don't pass the API key back to JS — it's
/// already been written to the keychain by the time this returns.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PairingStatusForFrontend {
    Pending,
    Claimed {
        #[serde(rename = "deviceId")]
        device_id: String,
        label: String,
    },
    Expired,
}

/// Tauri-managed shared state. All mutations go through `Mutex` since
/// commands run on the Tauri command pool (multiple OS threads).
pub struct AppState {
    pub config: Mutex<DesktopConfig>,
    pub pairing_handle: Mutex<Option<PairingHandle>>,
    pub pairing_client: PairingClient,
    pub daemon: Arc<Daemon>,
}

impl AppState {
    pub fn new(config: DesktopConfig, daemon: Arc<Daemon>) -> AppResult<Self> {
        Ok(Self {
            config: Mutex::new(config),
            pairing_handle: Mutex::new(None),
            pairing_client: PairingClient::new()?,
            daemon,
        })
    }
}

fn snapshot(state: &AppState) -> AppResult<DesktopState> {
    let cfg = state
        .config
        .lock()
        .map_err(|e| AppError::Internal(format!("config mutex poisoned: {e}")))?
        .clone();
    let paired = keychain::read()?.is_some();
    let path = config_path()?;
    let daemon = &state.daemon;
    let last_flush_at = daemon
        .last_flush_at()
        .and_then(|t| t.format(&Rfc3339).ok())
        .or(cfg.last_flush_at.clone());
    Ok(DesktopState {
        config_path: path.display().to_string(),
        api_base_url: cfg.api_base_url,
        paired,
        device_id: cfg.device_id,
        label: cfg.label,
        last_flush_at,
        daemon_running: daemon.is_running(),
        paused: daemon.is_paused(),
        track_titles: daemon.track_titles(),
        queue_depth: daemon.queue_depth(),
    })
}

#[tauri::command]
pub fn get_state(state: State<'_, AppState>) -> AppResult<DesktopState> {
    snapshot(&state)
}

#[tauri::command]
pub fn set_api_base_url(url: String, state: State<'_, AppState>) -> AppResult<DesktopState> {
    let trimmed = url.trim().to_string();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(AppError::Precondition(
            "API base URL must start with http:// or https://".into(),
        ));
    }
    if keychain::read()?.is_some() {
        return Err(AppError::Precondition(
            "Unpair this device before changing the API base URL.".into(),
        ));
    }
    {
        let mut cfg = state
            .config
            .lock()
            .map_err(|e| AppError::Internal(format!("config mutex poisoned: {e}")))?;
        cfg.api_base_url = trimmed;
        cfg.save()?;
    }
    snapshot(&state)
}

#[tauri::command]
pub async fn start_pairing(state: State<'_, AppState>) -> AppResult<PairingHandle> {
    if keychain::read()?.is_some() {
        return Err(AppError::Precondition(
            "Device is already paired. Unpair before requesting a new code.".into(),
        ));
    }
    let cfg = {
        let guard = state
            .config
            .lock()
            .map_err(|e| AppError::Internal(format!("config mutex poisoned: {e}")))?;
        guard.clone()
    };
    let handle = state.pairing_client.create_code(&cfg).await?;
    {
        let mut held = state
            .pairing_handle
            .lock()
            .map_err(|e| AppError::Internal(format!("pairing mutex poisoned: {e}")))?;
        *held = Some(handle.clone());
    }
    Ok(handle)
}

#[tauri::command]
pub async fn poll_pairing(
    state: State<'_, AppState>,
) -> AppResult<PairingStatusForFrontend> {
    let (cfg, code) = {
        let cfg_guard = state
            .config
            .lock()
            .map_err(|e| AppError::Internal(format!("config mutex poisoned: {e}")))?;
        let handle_guard = state
            .pairing_handle
            .lock()
            .map_err(|e| AppError::Internal(format!("pairing mutex poisoned: {e}")))?;
        let handle = handle_guard.as_ref().ok_or_else(|| {
            AppError::Precondition("No pairing in progress. Call start_pairing first.".into())
        })?;
        (cfg_guard.clone(), handle.code.clone())
    };
    let res = state.pairing_client.poll(&cfg, &code).await?;
    match res {
        PairingCodePollResponse::Pending => Ok(PairingStatusForFrontend::Pending),
        PairingCodePollResponse::Expired => {
            let mut held = state
                .pairing_handle
                .lock()
                .map_err(|e| AppError::Internal(format!("pairing mutex poisoned: {e}")))?;
            *held = None;
            Ok(PairingStatusForFrontend::Expired)
        }
        PairingCodePollResponse::Claimed { api_key, device } => {
            // Persist the key BEFORE clearing the handle, so a crash
            // between the two leaves us recoverable.
            keychain::write(&api_key)?;
            let cfg_clone = {
                let mut cfg = state
                    .config
                    .lock()
                    .map_err(|e| AppError::Internal(format!("config mutex poisoned: {e}")))?;
                cfg.label = device.label.clone();
                cfg.device_id = device.id.clone();
                cfg.save()?;
                cfg.clone()
            };
            {
                let mut held = state
                    .pairing_handle
                    .lock()
                    .map_err(|e| AppError::Internal(format!("pairing mutex poisoned: {e}")))?;
                *held = None;
            }
            // Fire up the capture + flush daemon now that we have a key.
            if let Err(e) = state.daemon.start(&cfg_clone, api_key).await {
                tracing::warn!(?e, "daemon failed to start after pairing");
            }
            Ok(PairingStatusForFrontend::Claimed {
                device_id: device.id,
                label: device.label,
            })
        }
    }
}

#[tauri::command]
pub fn cancel_pairing(state: State<'_, AppState>) -> AppResult<()> {
    let mut held = state
        .pairing_handle
        .lock()
        .map_err(|e| AppError::Internal(format!("pairing mutex poisoned: {e}")))?;
    *held = None;
    Ok(())
}

#[tauri::command]
pub async fn unpair_local(state: State<'_, AppState>) -> AppResult<DesktopState> {
    state.daemon.stop().await;
    keychain::clear()?;
    snapshot(&state)
}

#[tauri::command]
pub fn set_paused(paused: bool, state: State<'_, AppState>) -> AppResult<DesktopState> {
    state.daemon.set_paused(paused);
    {
        let mut cfg = state
            .config
            .lock()
            .map_err(|e| AppError::Internal(format!("config mutex poisoned: {e}")))?;
        cfg.paused = paused;
        cfg.save()?;
    }
    snapshot(&state)
}

#[tauri::command]
pub fn set_track_titles(enabled: bool, state: State<'_, AppState>) -> AppResult<DesktopState> {
    state.daemon.set_track_titles(enabled);
    {
        let mut cfg = state
            .config
            .lock()
            .map_err(|e| AppError::Internal(format!("config mutex poisoned: {e}")))?;
        cfg.track_titles = enabled;
        cfg.save()?;
    }
    snapshot(&state)
}

/// Opens the configured API base URL in the user's default browser. We
/// don't have a built-in dashboard URL — the API and the web app share an
/// origin in dev, and a self-hosted prod deployment will too.
#[tauri::command]
pub fn open_dashboard(state: State<'_, AppState>, app: tauri::AppHandle) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    // In dev, the React web app lives on a different port from the API.
    // Best-effort: rewrite localhost:3000 (API) → localhost:5173 (web) for
    // the dashboard link. In prod they share an origin.
    let url = {
        let cfg = state
            .config
            .lock()
            .map_err(|e| AppError::Internal(format!("config mutex poisoned: {e}")))?;
        if cfg.api_base_url.contains("localhost:3000")
            || cfg.api_base_url.contains("127.0.0.1:3000")
        {
            cfg.api_base_url
                .replace(":3000", ":5173")
        } else {
            cfg.api_base_url.clone()
        }
    };
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::Internal(format!("opener failed: {e}")))?;
    Ok(())
}
