//! Telemetry batch flusher.
//!
//! Spec: DesktopApp.md §8 + §9 (same per-flush logic as the extension, see
//! Extension.md §8).
//!
//! Responsibilities:
//!   * Run on a 60s tokio interval *and* on a buffer-threshold trigger
//!     (≥ `MAX_BATCH_SIZE` events queued).
//!   * Drain the head of the outbox in batch-sized chunks.
//!   * POST each batch to `<base>/v1/telemetry/batch` with the keychain
//!     API key in `Authorization: Bearer ...`.
//!   * On success: remove the acked events.
//!   * On transport / 5xx errors: leave events in the outbox, back off,
//!     retry on the next tick.
//!   * On 401/403 (`AuthRejected`): pause the daemon — the user needs to
//!     re-pair.
//!   * On other 4xx (`PermanentReject`): drop the offending batch so it
//!     can't loop forever; v1 logs and moves on (DesktopApp.md §16 will
//!     add a real dead-letter file later).
//!
//! All HTTP sits behind the `TelemetryUploader` trait so unit tests can
//! pretend the API is up/down/slow/malicious without a real server.

use crate::{
    config::DesktopConfig,
    errors::{AppError, AppResult},
    events::{TelemetryBatch, TelemetryBatchResponse},
    outbox::{Outbox, MAX_BATCH_SIZE},
};
use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::Duration,
};
use time::OffsetDateTime;
use tokio::sync::{watch, Notify};
use tracing::{debug, error, info, warn};

/// Interval between scheduled flushes when nothing else triggers one
/// (DesktopApp.md §9 — *"time-based: tokio interval timer every 60s"*).
pub const FLUSH_INTERVAL: Duration = Duration::from_secs(60);

/// Floor on the back-off after a failed flush, before the next attempt.
pub const FLUSH_BACKOFF_MIN: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------
//  Trait abstraction for testability
// ---------------------------------------------------------------------------

#[async_trait]
pub trait TelemetryUploader: Send + Sync + 'static {
    async fn upload(
        &self,
        batch: TelemetryBatch<'_>,
    ) -> Result<TelemetryBatchResponse, UploadError>;
}

#[derive(Debug)]
pub enum UploadError {
    /// Network / DNS / TLS / 5xx / timeout — retry next tick.
    Transient(String),
    /// 401/403 — API key revoked or wrong key. Daemon should stop.
    AuthRejected,
    /// 4xx (other than 401/403) — bad event shapes. v1 drops the batch.
    PermanentReject(String),
}

// ---------------------------------------------------------------------------
//  Live HTTP uploader
// ---------------------------------------------------------------------------

pub struct HttpUploader {
    http: Client,
    base_url: String,
    api_key: String,
    client_version: String,
}

impl HttpUploader {
    pub fn new(base_url: String, api_key: String) -> AppResult<Self> {
        let http = Client::builder()
            .user_agent(format!(
                "focus-tracker-desktop/{}",
                env!("CARGO_PKG_VERSION")
            ))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(AppError::http)?;
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        })
    }

    pub fn from_config(cfg: &DesktopConfig, api_key: String) -> AppResult<Self> {
        Self::new(cfg.api_base_url.clone(), api_key)
    }
}

#[async_trait]
impl TelemetryUploader for HttpUploader {
    async fn upload(
        &self,
        batch: TelemetryBatch<'_>,
    ) -> Result<TelemetryBatchResponse, UploadError> {
        let url = format!("{}/v1/telemetry/batch", self.base_url);
        let res = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .header(
                "X-Client",
                format!("focus-tracker-desktop/{}", self.client_version),
            )
            .json(&batch)
            .send()
            .await
            .map_err(|e| UploadError::Transient(e.to_string()))?;

        let status = res.status();
        if status.is_success() {
            return res
                .json::<TelemetryBatchResponse>()
                .await
                .map_err(|e| UploadError::Transient(e.to_string()));
        }
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(UploadError::AuthRejected);
        }
        let body = res.text().await.unwrap_or_default();
        if status.is_client_error() {
            Err(UploadError::PermanentReject(format!("{status}: {body}")))
        } else {
            Err(UploadError::Transient(format!("{status}: {body}")))
        }
    }
}

// ---------------------------------------------------------------------------
//  Flush loop
// ---------------------------------------------------------------------------

/// Cross-task signals consumed by the flusher.
#[derive(Debug, Clone)]
pub struct FlushSignals {
    /// Bump by the capture loop after every append; if value crosses the
    /// batch threshold, the flusher gets a wake-up.
    pub queue_depth: Arc<AtomicUsize>,
    /// Asynchronous wake-up — capture loop calls `notify_one()` whenever
    /// it appends so we can react sub-interval if the queue gets big.
    pub poke: Arc<Notify>,
    /// Honoured at the start of each tick; same flag the capture loop reads.
    pub paused: Arc<AtomicBool>,
    /// Updated whenever a flush succeeds — used for the "last sync" UI.
    pub last_flush_at: Arc<StdMutex<Option<OffsetDateTime>>>,
}

impl FlushSignals {
    pub fn new(paused: Arc<AtomicBool>) -> Self {
        Self {
            queue_depth: Arc::new(AtomicUsize::new(0)),
            poke: Arc::new(Notify::new()),
            paused,
            last_flush_at: Arc::new(StdMutex::new(None)),
        }
    }
}

pub struct FlushLoop {
    outbox: Arc<Outbox>,
    uploader: Arc<dyn TelemetryUploader>,
    device_id: String,
    signals: FlushSignals,
    interval: Duration,
}

impl FlushLoop {
    pub fn new(
        outbox: Arc<Outbox>,
        uploader: Arc<dyn TelemetryUploader>,
        device_id: String,
        signals: FlushSignals,
    ) -> Self {
        Self {
            outbox,
            uploader,
            device_id,
            signals,
            interval: FLUSH_INTERVAL,
        }
    }

    pub async fn run(self: Arc<Self>, mut stop: watch::Receiver<bool>) {
        let mut ticker = tokio::time::interval(self.interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        debug!(
            interval_s = self.interval.as_secs(),
            "flush loop running"
        );
        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if self.signals.paused.load(Ordering::Relaxed) { continue; }
                    self.flush_all().await;
                }
                _ = self.signals.poke.notified() => {
                    if self.signals.paused.load(Ordering::Relaxed) { continue; }
                    let depth = self.signals.queue_depth.load(Ordering::Relaxed);
                    if depth >= MAX_BATCH_SIZE {
                        self.flush_all().await;
                    }
                }
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() {
                        // One last best-effort drain before shutdown.
                        self.flush_all().await;
                        debug!("flush loop shutting down");
                        break;
                    }
                }
            }
        }
    }

    /// Drains the outbox in batch-sized chunks until empty or a transient
    /// failure tells us to back off until the next tick.
    pub async fn flush_all(&self) {
        loop {
            let batch = match self.outbox.drain_head(MAX_BATCH_SIZE).await {
                Ok(b) => b,
                Err(e) => {
                    error!(?e, "flush: outbox read failed");
                    return;
                }
            };
            if batch.is_empty() {
                return;
            }
            let acked_ids: Vec<String> = batch.iter().map(|e| e.id.clone()).collect();
            let envelope = TelemetryBatch {
                device_id: &self.device_id,
                events: &batch,
            };
            match self.uploader.upload(envelope).await {
                Ok(resp) => {
                    info!(
                        accepted = resp.accepted_count,
                        duplicates = resp.duplicate_count,
                        sent = acked_ids.len(),
                        "flush ok"
                    );
                    if let Err(e) = self.outbox.remove_acked(&acked_ids).await {
                        error!(?e, "flush: failed to drop acked events from outbox");
                        return;
                    }
                    let remaining = self.outbox.len().await.unwrap_or(0);
                    self.signals.queue_depth.store(remaining, Ordering::Relaxed);
                    *self
                        .signals
                        .last_flush_at
                        .lock()
                        .expect("last_flush_at mutex poisoned") =
                        Some(OffsetDateTime::now_utc());
                    // Always loop — the next `drain_head` returning empty
                    // is the only correct exit signal. Previously we early-
                    // exited when remaining < MAX_BATCH_SIZE, which left a
                    // partial-final-batch worth of events stranded.
                }
                Err(UploadError::Transient(msg)) => {
                    warn!(error = %msg, "flush: transient failure, retry next tick");
                    tokio::time::sleep(FLUSH_BACKOFF_MIN).await;
                    return;
                }
                Err(UploadError::AuthRejected) => {
                    error!(
                        "flush: API key rejected (401/403). Pausing until re-paired."
                    );
                    self.signals.paused.store(true, Ordering::Relaxed);
                    return;
                }
                Err(UploadError::PermanentReject(msg)) => {
                    error!(
                        error = %msg,
                        count = acked_ids.len(),
                        "flush: API rejected batch permanently, dropping events"
                    );
                    if let Err(e) = self.outbox.remove_acked(&acked_ids).await {
                        error!(?e, "flush: failed to drop dead-letter events");
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{new_event_id, EventKind, StoredEvent};
    use std::sync::Mutex as StdMutex;
    use tempfile::TempDir;
    use time::macros::datetime;

    fn make_event(id: &str) -> StoredEvent {
        StoredEvent {
            id: id.into(),
            kind: EventKind::FocusChange,
            source: "desktop".into(),
            target: serde_json::json!({"appName": "test"}),
            started_at: datetime!(2026-06-17 21:00:00 UTC),
            ended_at: None,
            duration_ms: None,
            client_version: "0.0.1".into(),
        }
    }

    fn fresh_outbox() -> (TempDir, Arc<Outbox>) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("outbox.jsonl");
        (
            dir,
            Arc::new(Outbox::new(path, crate::outbox::DEFAULT_RECENT_CAPACITY)),
        )
    }

    enum FakeBehaviour {
        Ok,
        Transient,
        Auth,
        Permanent,
    }

    struct FakeUploader {
        behaviour: StdMutex<FakeBehaviour>,
        calls: StdMutex<Vec<Vec<String>>>,
    }

    impl FakeUploader {
        fn new(behaviour: FakeBehaviour) -> Self {
            Self {
                behaviour: StdMutex::new(behaviour),
                calls: StdMutex::new(Vec::new()),
            }
        }
        fn call_count(&self) -> usize {
            self.calls.lock().unwrap().len()
        }
    }

    #[async_trait]
    impl TelemetryUploader for FakeUploader {
        async fn upload(
            &self,
            batch: TelemetryBatch<'_>,
        ) -> Result<TelemetryBatchResponse, UploadError> {
            self.calls
                .lock()
                .unwrap()
                .push(batch.events.iter().map(|e| e.id.clone()).collect());
            match *self.behaviour.lock().unwrap() {
                FakeBehaviour::Ok => Ok(TelemetryBatchResponse {
                    accepted_count: batch.events.len() as u64,
                    duplicate_count: 0,
                }),
                FakeBehaviour::Transient => {
                    Err(UploadError::Transient("simulated transient".into()))
                }
                FakeBehaviour::Auth => Err(UploadError::AuthRejected),
                FakeBehaviour::Permanent => {
                    Err(UploadError::PermanentReject("simulated reject".into()))
                }
            }
        }
    }

    #[tokio::test]
    async fn flush_ok_drains_outbox_and_records_last_flush() {
        let (_dir, ob) = fresh_outbox();
        for i in 0..3 {
            ob.append(&make_event(&format!("e{i}"))).await.unwrap();
        }
        let fake = Arc::new(FakeUploader::new(FakeBehaviour::Ok));
        let signals = FlushSignals::new(Arc::new(AtomicBool::new(false)));
        let uploader: Arc<dyn TelemetryUploader> = fake.clone();
        let f = FlushLoop::new(ob.clone(), uploader, "dev1".into(), signals.clone());
        f.flush_all().await;
        assert_eq!(ob.len().await.unwrap(), 0);
        assert_eq!(fake.call_count(), 1);
        assert!(signals.last_flush_at.lock().unwrap().is_some());
    }

    #[tokio::test]
    async fn flush_transient_leaves_outbox_alone() {
        let (_dir, ob) = fresh_outbox();
        ob.append(&make_event("a")).await.unwrap();
        let uploader: Arc<dyn TelemetryUploader> =
            Arc::new(FakeUploader::new(FakeBehaviour::Transient));
        let signals = FlushSignals::new(Arc::new(AtomicBool::new(false)));
        let f = FlushLoop::new(ob.clone(), uploader, "dev1".into(), signals.clone());
        f.flush_all().await;
        assert_eq!(ob.len().await.unwrap(), 1, "transient must NOT drop events");
        assert!(signals.last_flush_at.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn flush_auth_pauses_daemon() {
        let (_dir, ob) = fresh_outbox();
        ob.append(&make_event("a")).await.unwrap();
        let uploader: Arc<dyn TelemetryUploader> =
            Arc::new(FakeUploader::new(FakeBehaviour::Auth));
        let paused = Arc::new(AtomicBool::new(false));
        let signals = FlushSignals::new(paused.clone());
        let f = FlushLoop::new(ob.clone(), uploader, "dev1".into(), signals.clone());
        f.flush_all().await;
        assert_eq!(ob.len().await.unwrap(), 1, "auth-rejected events stay queued");
        assert!(paused.load(Ordering::Relaxed), "401/403 must flip paused=true");
    }

    #[tokio::test]
    async fn flush_permanent_drops_batch() {
        let (_dir, ob) = fresh_outbox();
        for i in 0..3 {
            ob.append(&make_event(&format!("e{i}"))).await.unwrap();
        }
        let uploader: Arc<dyn TelemetryUploader> =
            Arc::new(FakeUploader::new(FakeBehaviour::Permanent));
        let signals = FlushSignals::new(Arc::new(AtomicBool::new(false)));
        let f = FlushLoop::new(ob.clone(), uploader, "dev1".into(), signals.clone());
        f.flush_all().await;
        assert_eq!(
            ob.len().await.unwrap(),
            0,
            "permanent reject drops the offending batch (v1 behaviour)"
        );
    }

    #[tokio::test]
    async fn flush_chunks_large_outbox_into_batches() {
        let (_dir, ob) = fresh_outbox();
        for _ in 0..120 {
            ob.append(&make_event(&new_event_id())).await.unwrap();
        }
        let fake = Arc::new(FakeUploader::new(FakeBehaviour::Ok));
        let signals = FlushSignals::new(Arc::new(AtomicBool::new(false)));
        let uploader: Arc<dyn TelemetryUploader> = fake.clone();
        let f = FlushLoop::new(ob.clone(), uploader, "dev1".into(), signals);
        f.flush_all().await;
        assert_eq!(ob.len().await.unwrap(), 0);
        assert_eq!(fake.call_count(), 3, "120 events → 50+50+20");
    }
}
