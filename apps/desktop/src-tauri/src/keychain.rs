//! Thin wrapper around the `keyring` crate for storing the per-device API
//! key (`ft_live_...`) in the OS keychain.
//!
//! Spec: DesktopApp.md §8.3 — *Device API key: OS keychain only. Never
//! written to the outbox file or any plaintext config.*
//!
//! Per-platform backend:
//!   * Windows  — Credential Manager
//!   * macOS    — Keychain (`apple-native`)
//!   * Linux    — Secret Service (sync-secret-service)

use crate::errors::{AppError, AppResult};
use keyring::Entry;

const SERVICE: &str = "Focus Tracker";
const ACCOUNT: &str = "api-key";

fn entry() -> AppResult<Entry> {
    Entry::new(SERVICE, ACCOUNT).map_err(AppError::keychain)
}

/// Reads the API key. Returns `Ok(None)` if no key is stored (vs an
/// IO/permission error, which propagates).
pub fn read() -> AppResult<Option<String>> {
    match entry()?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::keychain(e)),
    }
}

/// Writes (or overwrites) the API key.
pub fn write(api_key: &str) -> AppResult<()> {
    entry()?.set_password(api_key).map_err(AppError::keychain)
}

/// Removes the API key. Returns `Ok(())` whether or not one existed.
pub fn clear() -> AppResult<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::keychain(e)),
    }
}
