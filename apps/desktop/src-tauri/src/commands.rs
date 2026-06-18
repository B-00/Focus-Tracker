//! Tauri commands invoked from React via `@tauri-apps/api/core#invoke`.
//!
//! Each `#[tauri::command]` here corresponds 1:1 to one of the typed
//! wrappers in `apps/desktop/src/lib/tauri.ts`. Keep them in sync —
//! command names and field names are stringly-typed on the wire.

use crate::{
    config::{config_path, DesktopConfig},
    errors::{AppError, AppResult},
    events::PairingCodePollResponse,
    keychain,
    pairing::{PairingClient, PairingHandle},
};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

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
#[derive(Debug)]
pub struct AppState {
    pub config: Mutex<DesktopConfig>,
    pub pairing_handle: Mutex<Option<PairingHandle>>,
    pub pairing_client: PairingClient,
}

impl AppState {
    pub fn new(config: DesktopConfig) -> AppResult<Self> {
        Ok(Self {
            config: Mutex::new(config),
            pairing_handle: Mutex::new(None),
            pairing_client: PairingClient::new()?,
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
    Ok(DesktopState {
        config_path: path.display().to_string(),
        api_base_url: cfg.api_base_url,
        paired,
        device_id: cfg.device_id,
        label: cfg.label,
        last_flush_at: cfg.last_flush_at,
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
            // Drop the stale handle; user must restart.
            let mut held = state
                .pairing_handle
                .lock()
                .map_err(|e| AppError::Internal(format!("pairing mutex poisoned: {e}")))?;
            *held = None;
            Ok(PairingStatusForFrontend::Expired)
        }
        PairingCodePollResponse::Claimed { api_key, device } => {
            // Persist the key in the OS keychain BEFORE clearing the
            // handle, so a crash between the two leaves us recoverable
            // (we'd see a paired state on next launch).
            keychain::write(&api_key)?;
            // Mirror the server-side label/deviceId into our local config.
            {
                let mut cfg = state
                    .config
                    .lock()
                    .map_err(|e| AppError::Internal(format!("config mutex poisoned: {e}")))?;
                cfg.label = device.label.clone();
                cfg.device_id = device.id.clone();
                cfg.save()?;
            }
            {
                let mut held = state
                    .pairing_handle
                    .lock()
                    .map_err(|e| AppError::Internal(format!("pairing mutex poisoned: {e}")))?;
                *held = None;
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
pub fn unpair_local(state: State<'_, AppState>) -> AppResult<DesktopState> {
    keychain::clear()?;
    snapshot(&state)
}
