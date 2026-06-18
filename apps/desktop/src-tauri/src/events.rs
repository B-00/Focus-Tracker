//! Wire-protocol shapes mirrored from `packages/shared/src/{telemetry,pairing}.ts`.
//!
//! The desktop daemon is Rust; it can't import the TS shared package. Per
//! `PROJECT.md` §4.1 and `DesktopApp.md` §1.1, we hand-mirror the shapes
//! here. Cross-reference comments point at the TS source — when one side
//! changes, update the other.

use serde::{Deserialize, Serialize};

/// Mirrors `DeviceProposal` in `packages/shared/src/pairing.ts` §13-32.
/// Sent as the body of `POST /v1/devices/pairing-codes`.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceProposal<'a> {
    #[serde(rename = "deviceId")]
    pub device_id: &'a str,
    pub source: &'a str, // always "desktop" for us
    pub platform: String,
    pub label: &'a str,
    #[serde(rename = "clientVersion", skip_serializing_if = "Option::is_none")]
    pub client_version: Option<&'a str>,
}

/// Mirrors `PairingCodeCreateResponse` in `pairing.ts` §41-46.
#[derive(Debug, Clone, Deserialize)]
pub struct PairingCodeCreateResponse {
    pub code: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

/// Mirrors `PairingCodePollResponse` in `pairing.ts` §52-68. Discriminated
/// by the `status` field; `apiKey` + `device` are present only when
/// `status == "claimed"`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PairingCodePollResponse {
    Pending,
    Claimed {
        #[serde(rename = "apiKey")]
        api_key: String,
        device: PairingClaimedDevice,
    },
    Expired,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PairingClaimedDevice {
    pub id: String,
    pub label: String,
}
