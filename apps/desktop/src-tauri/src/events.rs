//! Wire-protocol shapes mirrored from `packages/shared/src/{telemetry,pairing}.ts`.
//!
//! The desktop daemon is Rust; it can't import the TS shared package. Per
//! `PROJECT.md` §4.1 and `DesktopApp.md` §1.1, we hand-mirror the shapes
//! here. Cross-reference comments point at the TS source — when one side
//! changes, update the other.
//!
//! Time fields are RFC3339 strings on the wire (matching `z.string().datetime()`
//! in `shared/telemetry.ts`); we round-trip them through `time::OffsetDateTime`
//! so we don't lose sub-second precision or drop timezone info.

use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use ulid::Ulid;

// ---------------------------------------------------------------------------
//  Pairing (DesktopApp.md §10 / Auth.md §5.1) — already used in slice 4.
// ---------------------------------------------------------------------------

/// Mirrors `DeviceProposal` in `packages/shared/src/pairing.ts`.
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

/// Mirrors `PairingCodeCreateResponse` in `pairing.ts`.
#[derive(Debug, Clone, Deserialize)]
pub struct PairingCodeCreateResponse {
    pub code: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

/// Mirrors `PairingCodePollResponse` in `pairing.ts`. Discriminated by the
/// `status` field; `apiKey` + `device` are present only when claimed.
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

// ---------------------------------------------------------------------------
//  Telemetry (DesktopApp.md §7 / shared/telemetry.ts).
// ---------------------------------------------------------------------------

/// Mirrors `TelemetryEventKind` in `shared/enums.ts`. String-only on the wire
/// so we don't churn the protocol if we reshuffle these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    FocusChange,
    Heartbeat,
    SessionStart,
    SessionEnd,
}

/// Mirrors `desktopFocusTargetSchema` in `shared/telemetry.ts`. We always
/// emit this shape (even for heartbeat/session_* the server only validates
/// per-kind shape; we put a small `{}` placeholder for non-focus events
/// using `TargetPayload::Empty`).
#[derive(Debug, Clone, Serialize)]
pub struct DesktopFocusTarget {
    #[serde(rename = "appName")]
    pub app_name: String,
    #[serde(rename = "appBundleId", skip_serializing_if = "Option::is_none")]
    pub app_bundle_id: Option<String>,
    /// None when the privacy toggle "Track window titles" is off
    /// (DesktopApp.md §11) or when the OS denies window-title access.
    #[serde(rename = "windowTitle", skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
}

/// `target` field is heterogeneous-by-kind. We carry it as an enum so the
/// rest of the daemon doesn't have to deal with raw JSON values.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum TargetPayload {
    Focus(DesktopFocusTarget),
    /// Heartbeat / session_* events ship `{}` as the target.
    Empty(EmptyTarget),
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct EmptyTarget {}

/// Mirrors `telemetryEventSchema` in `shared/telemetry.ts`. Wire fields are
/// camelCase; Rust fields are snake_case via `#[serde(rename)]`.
#[derive(Debug, Clone, Serialize)]
pub struct TelemetryEvent {
    pub id: String,
    pub kind: EventKind,
    pub source: &'static str, // always "desktop" — typed at compile time
    pub target: TargetPayload,
    #[serde(rename = "startedAt", with = "rfc3339")]
    pub started_at: OffsetDateTime,
    #[serde(rename = "endedAt", skip_serializing_if = "Option::is_none", with = "rfc3339_opt")]
    pub ended_at: Option<OffsetDateTime>,
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(rename = "clientVersion")]
    pub client_version: String,
}

/// Round-trip shape used by the outbox file. Same as `TelemetryEvent` but
/// deserialisable too (the live struct is serialise-only because some
/// fields are `&'static str`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEvent {
    pub id: String,
    pub kind: EventKind,
    pub source: String,
    pub target: serde_json::Value,
    #[serde(rename = "startedAt", with = "rfc3339")]
    pub started_at: OffsetDateTime,
    #[serde(rename = "endedAt", default, skip_serializing_if = "Option::is_none", with = "rfc3339_opt")]
    pub ended_at: Option<OffsetDateTime>,
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(rename = "clientVersion")]
    pub client_version: String,
}

impl From<TelemetryEvent> for StoredEvent {
    fn from(e: TelemetryEvent) -> Self {
        StoredEvent {
            id: e.id,
            kind: e.kind,
            source: e.source.to_string(),
            target: serde_json::to_value(&e.target)
                .unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
            started_at: e.started_at,
            ended_at: e.ended_at,
            duration_ms: e.duration_ms,
            client_version: e.client_version,
        }
    }
}

/// Mirrors `telemetryBatchSchema` in `shared/telemetry.ts`.
#[derive(Debug, Clone, Serialize)]
pub struct TelemetryBatch<'a> {
    #[serde(rename = "deviceId")]
    pub device_id: &'a str,
    pub events: &'a [StoredEvent],
}

/// Mirrors `telemetryBatchResponseSchema` in `shared/telemetry.ts`.
#[derive(Debug, Clone, Deserialize)]
pub struct TelemetryBatchResponse {
    #[serde(rename = "acceptedCount")]
    pub accepted_count: u64,
    #[serde(rename = "duplicateCount")]
    pub duplicate_count: u64,
}

/// Cheap helper for fresh event IDs. ULIDs are timestamp-sortable, 26-char
/// Crockford base32, and ~50% smaller than UUIDs without losing uniqueness.
pub fn new_event_id() -> String {
    Ulid::new().to_string()
}

// ---------------------------------------------------------------------------
//  Custom serde adapters for `time::OffsetDateTime` ↔ RFC3339 strings.
//  (We can't use `#[serde(with = ...)]`-style alias for Option<T> without
//   wrapping; hence two adapter modules.)
// ---------------------------------------------------------------------------

mod rfc3339 {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(
        dt: &OffsetDateTime,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        let formatted = dt
            .format(&Rfc3339)
            .map_err(serde::ser::Error::custom)?;
        s.serialize_str(&formatted)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<OffsetDateTime, D::Error> {
        let s = String::deserialize(d)?;
        OffsetDateTime::parse(&s, &Rfc3339).map_err(serde::de::Error::custom)
    }
}

mod rfc3339_opt {
    use super::*;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(
        dt: &Option<OffsetDateTime>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match dt {
            Some(d) => {
                let formatted = d
                    .format(&Rfc3339)
                    .map_err(serde::ser::Error::custom)?;
                s.serialize_str(&formatted)
            }
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<OffsetDateTime>, D::Error> {
        let opt = Option::<String>::deserialize(d)?;
        match opt {
            Some(s) => OffsetDateTime::parse(&s, &Rfc3339)
                .map(Some)
                .map_err(serde::de::Error::custom),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn roundtrip_stored_event() {
        let e = StoredEvent {
            id: "01J9X000000000000000000000".into(),
            kind: EventKind::FocusChange,
            source: "desktop".into(),
            target: serde_json::json!({
                "appName": "Cursor",
                "windowTitle": "events.rs"
            }),
            started_at: datetime!(2026-06-17 21:00:00 UTC),
            ended_at: Some(datetime!(2026-06-17 21:01:30 UTC)),
            duration_ms: Some(90_000),
            client_version: "0.0.1".into(),
        };
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"startedAt\":\"2026-06-17T21:00:00Z\""));
        assert!(s.contains("\"endedAt\":\"2026-06-17T21:01:30Z\""));
        assert!(s.contains("\"durationMs\":90000"));
        let back: StoredEvent = serde_json::from_str(&s).unwrap();
        assert_eq!(back.id, e.id);
        assert_eq!(back.started_at, e.started_at);
        assert_eq!(back.ended_at, e.ended_at);
    }

    #[test]
    fn skips_optional_fields_when_absent() {
        let e = StoredEvent {
            id: new_event_id(),
            kind: EventKind::Heartbeat,
            source: "desktop".into(),
            target: serde_json::json!({}),
            started_at: datetime!(2026-06-17 21:00:00 UTC),
            ended_at: None,
            duration_ms: None,
            client_version: "0.0.1".into(),
        };
        let s = serde_json::to_string(&e).unwrap();
        assert!(!s.contains("endedAt"));
        assert!(!s.contains("durationMs"));
    }
}
