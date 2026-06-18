//! Pairing flow client.
//!
//! Owns the live state of the in-flight pairing handshake (which 6-digit
//! code, when it expires) and the HTTP calls to:
//!   * `POST /v1/devices/pairing-codes`               — mint a code
//!   * `GET  /v1/devices/pairing-codes/:code`         — poll for claim
//!
//! Spec: DesktopApp.md §10 + Auth.md §5.1.

use crate::{
    config::DesktopConfig,
    errors::{AppError, AppResult},
    events::{DeviceProposal, PairingCodeCreateResponse, PairingCodePollResponse},
};
use reqwest::Client;
use serde::Serialize;
use std::time::Duration;
use tracing::warn;

/// Owned by the Tauri AppState. Only one pairing handle can be in-flight
/// at a time; starting a new one drops the previous one.
#[derive(Debug, Clone, Serialize)]
pub struct PairingHandle {
    pub code: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

#[derive(Debug, Clone)]
pub struct PairingClient {
    http: Client,
}

impl PairingClient {
    pub fn new() -> AppResult<Self> {
        let http = Client::builder()
            .user_agent(format!(
                "focus-tracker-desktop/{}",
                env!("CARGO_PKG_VERSION")
            ))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(AppError::http)?;
        Ok(Self { http })
    }

    /// Hits `POST /v1/devices/pairing-codes` with this device's proposal.
    pub async fn create_code(&self, cfg: &DesktopConfig) -> AppResult<PairingHandle> {
        let url = format!(
            "{}/v1/devices/pairing-codes",
            cfg.api_base_url.trim_end_matches('/')
        );
        let body = DeviceProposal {
            device_id: &cfg.device_id,
            source: "desktop",
            platform: current_platform(),
            label: &cfg.label,
            client_version: Some(env!("CARGO_PKG_VERSION")),
        };
        let res = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(AppError::http)?;
        let status = res.status();
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            warn!(%status, %text, "pairing-code creation failed");
            return Err(AppError::Pairing {
                code: "pairing_code_unavailable".into(),
                message: format!("API returned {status}: {text}"),
            });
        }
        let parsed: PairingCodeCreateResponse = res.json().await.map_err(AppError::http)?;
        Ok(PairingHandle {
            code: parsed.code,
            expires_at: parsed.expires_at,
        })
    }

    /// Hits `GET /v1/devices/pairing-codes/:code`. Returns the typed
    /// discriminated response.
    pub async fn poll(
        &self,
        cfg: &DesktopConfig,
        code: &str,
    ) -> AppResult<PairingCodePollResponse> {
        let url = format!(
            "{}/v1/devices/pairing-codes/{}",
            cfg.api_base_url.trim_end_matches('/'),
            urlencode(code)
        );
        let res = self.http.get(&url).send().await.map_err(AppError::http)?;
        let status = res.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(PairingCodePollResponse::Expired);
        }
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            return Err(AppError::Pairing {
                code: "pairing_code_unavailable".into(),
                message: format!("API returned {status}: {text}"),
            });
        }
        let parsed: PairingCodePollResponse = res.json().await.map_err(AppError::http)?;
        Ok(parsed)
    }
}

/// Returns a short OS-string for the `platform` field of `DeviceProposal`.
/// Matches the rough convention used by the browser extension.
fn current_platform() -> String {
    if cfg!(target_os = "windows") {
        format!("windows-{}", std::env::consts::ARCH)
    } else if cfg!(target_os = "macos") {
        format!("macos-{}", std::env::consts::ARCH)
    } else if cfg!(target_os = "linux") {
        format!("linux-{}", std::env::consts::ARCH)
    } else {
        format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
    }
}

/// Bare-bones URL encoder for the 6-digit numeric pairing code. We don't
/// pull `urlencoding` in for one allocation; codes are ASCII digits.
fn urlencode(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}
