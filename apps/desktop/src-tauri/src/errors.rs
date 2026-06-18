//! Error types surfaced to the React frontend via Tauri commands.
//!
//! Tauri serialises command return values with `serde_json`; for the error
//! channel it expects an `impl Serialize`. `thiserror` gives us cheap
//! `Display`/`Error` impls; the manual `Serialize` impl turns each variant
//! into a stable JSON shape the frontend can match on by string.

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("config: {0}")]
    Config(String),

    #[error("keychain: {0}")]
    Keychain(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("http: {0}")]
    Http(String),

    /// User-facing pairing failures map to specific PAIRING_ERROR_CODES
    /// values from packages/shared/src/pairing.ts so the React side can
    /// switch on `.code`.
    #[error("pairing: {code} — {message}")]
    Pairing { code: String, message: String },

    /// The user tried to do something that requires a paired device while
    /// one isn't present (or vice versa).
    #[error("precondition: {0}")]
    Precondition(String),

    #[error("internal: {0}")]
    Internal(String),
}

impl AppError {
    pub fn http<E: std::fmt::Display>(err: E) -> Self {
        AppError::Http(err.to_string())
    }

    pub fn keychain<E: std::fmt::Display>(err: E) -> Self {
        AppError::Keychain(err.to_string())
    }

    pub fn config<E: std::fmt::Display>(err: E) -> Self {
        AppError::Config(err.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        match self {
            AppError::Pairing { code, message } => {
                s.serialize_field("kind", "pairing")?;
                s.serialize_field("code", code)?;
                s.serialize_field("message", message)?;
            }
            AppError::Precondition(m) => {
                s.serialize_field("kind", "precondition")?;
                s.serialize_field("message", m)?;
            }
            AppError::Config(m) => {
                s.serialize_field("kind", "config")?;
                s.serialize_field("message", m)?;
            }
            AppError::Keychain(m) => {
                s.serialize_field("kind", "keychain")?;
                s.serialize_field("message", m)?;
            }
            AppError::Http(m) => {
                s.serialize_field("kind", "http")?;
                s.serialize_field("message", m)?;
            }
            AppError::Io(e) => {
                s.serialize_field("kind", "io")?;
                s.serialize_field("message", &e.to_string())?;
            }
            AppError::Serde(e) => {
                s.serialize_field("kind", "serde")?;
                s.serialize_field("message", &e.to_string())?;
            }
            AppError::Internal(m) => {
                s.serialize_field("kind", "internal")?;
                s.serialize_field("message", m)?;
            }
        }
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
