//! Daemon orchestrator.
//!
//! Owns the lifecycle of the three long-running tokio tasks (capture +
//! flush + heartbeat) and the cross-task signal channels (paused flag,
//! queue-depth counter, stop watch).
//!
//! Lifecycle:
//!   * `start` — spawn the tasks, emit `session_start`. Idempotent: a
//!     second `start` while already running is a no-op.
//!   * `stop` — emit `session_end`, signal the stop watch, await joiners.
//!     Idempotent in the other direction.
//!
//! Wired in `lib.rs`:
//!   * on startup, if `keychain::read()` returns a key, call `start`.
//!   * on successful pairing (`poll_pairing` claimed), call `start`.
//!   * on unpair, call `stop`.
//!   * on tray Quit, call `stop`.

use crate::{
    capture::{CaptureFlags, CaptureLoop, IdleSource, LiveFocusSource, LiveIdleSource, FocusSource},
    config::DesktopConfig,
    errors::{AppError, AppResult},
    events::{new_event_id, EmptyTarget, EventKind, StoredEvent, TargetPayload, TelemetryEvent},
    flusher::{FlushLoop, FlushSignals, HttpUploader, TelemetryUploader, FLUSH_INTERVAL},
    outbox::Outbox,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex,
};
use std::time::Duration;
use time::OffsetDateTime;
use tokio::{sync::watch, task::JoinHandle};
use tracing::{debug, error, info, warn};

/// Heartbeat cadence. Same as `Sources Markdown/DesktopApp.md` §7.1.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60);

/// Whether `start()` has been called and tasks are running.
pub struct Daemon {
    state: StdMutex<Option<RunningHandle>>,
    outbox: Arc<Outbox>,
    paused: Arc<AtomicBool>,
    flush_signals: FlushSignals,
    capture_flags: CaptureFlags,
}

struct RunningHandle {
    stop_tx: watch::Sender<bool>,
    capture: JoinHandle<()>,
    flush: JoinHandle<()>,
    heartbeat: JoinHandle<()>,
}

impl Daemon {
    pub fn new(outbox: Arc<Outbox>, track_titles: bool, paused_initial: bool) -> Self {
        let flags = CaptureFlags::new(track_titles, paused_initial);
        let flush_signals = FlushSignals::new(flags.paused.clone());
        // Seed the queue depth from whatever is already on disk so the UI
        // shows the right count before the daemon has flushed once.
        if outbox.path().exists() {
            if let Ok(s) = std::fs::read_to_string(outbox.path()) {
                let n = s.lines().filter(|l| !l.is_empty()).count();
                flush_signals.queue_depth.store(n, Ordering::Relaxed);
            }
        }
        Self {
            state: StdMutex::new(None),
            outbox,
            paused: flags.paused.clone(),
            flush_signals,
            capture_flags: flags,
        }
    }

    pub fn is_running(&self) -> bool {
        self.state.lock().expect("daemon state poisoned").is_some()
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
    }

    pub fn set_track_titles(&self, on: bool) {
        self.capture_flags.track_titles.store(on, Ordering::Relaxed);
    }

    pub fn track_titles(&self) -> bool {
        self.capture_flags.track_titles.load(Ordering::Relaxed)
    }

    pub fn queue_depth(&self) -> usize {
        self.flush_signals.queue_depth.load(Ordering::Relaxed)
    }

    pub fn last_flush_at(&self) -> Option<OffsetDateTime> {
        *self
            .flush_signals
            .last_flush_at
            .lock()
            .expect("last_flush_at mutex poisoned")
    }

    pub async fn start(&self, cfg: &DesktopConfig, api_key: String) -> AppResult<()> {
        {
            let st = self.state.lock().expect("daemon state poisoned");
            if st.is_some() {
                debug!("daemon: start called while already running, no-op");
                return Ok(());
            }
        }

        // Enforce backpressure once at boot before we start enqueuing new
        // events on top of a (potentially) overfilled outbox. Cheap — file
        // is bounded at 100k events.
        match self.outbox.enforce_caps().await {
            Ok(0) => {}
            Ok(n) => warn!(dropped = n, "outbox: caps enforcement dropped old events"),
            Err(e) => warn!(?e, "outbox: caps enforcement failed"),
        }

        // Live OS sources for the capture loop.
        let focus: Box<dyn FocusSource> = Box::new(LiveFocusSource);
        let idle: Box<dyn IdleSource> = Box::new(LiveIdleSource);
        let capture = Arc::new(CaptureLoop::new(
            self.outbox.clone(),
            focus,
            idle,
            self.capture_flags.clone(),
            cfg,
        ));

        // Live HTTP uploader.
        let uploader: Arc<dyn TelemetryUploader> =
            Arc::new(HttpUploader::from_config(cfg, api_key)?);
        let flush = Arc::new(FlushLoop::new(
            self.outbox.clone(),
            uploader,
            cfg.device_id.clone(),
            self.flush_signals.clone(),
        ));

        let (stop_tx, stop_rx_capture) = watch::channel(false);
        let stop_rx_flush = stop_tx.subscribe();
        let stop_rx_heart = stop_tx.subscribe();

        // Drop a session_start at the top of the outbox so the server-side
        // analytics can tell when the daemon was online.
        if let Err(e) = self.emit_lifecycle(EventKind::SessionStart).await {
            warn!(?e, "daemon: failed to emit session_start");
        }

        let capture_task = tokio::spawn(capture.clone().run(stop_rx_capture));
        let flush_task = tokio::spawn(flush.clone().run(stop_rx_flush));

        // Heartbeat task — inline; tiny.
        let outbox = self.outbox.clone();
        let signals = self.flush_signals.clone();
        let paused = self.paused.clone();
        let client_version = env!("CARGO_PKG_VERSION").to_string();
        let heartbeat_task = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            // Skip the first immediate tick — interval fires at t=0 by default.
            ticker.tick().await;
            let mut stop = stop_rx_heart;
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if paused.load(Ordering::Relaxed) { continue; }
                        let ev = lifecycle_event(EventKind::Heartbeat, &client_version);
                        if let Err(e) = outbox.append(&ev).await {
                            warn!(?e, "heartbeat append failed");
                        } else {
                            let new_depth = signals.queue_depth.fetch_add(1, Ordering::Relaxed) + 1;
                            if new_depth >= crate::outbox::MAX_BATCH_SIZE {
                                signals.poke.notify_one();
                            }
                        }
                    }
                    changed = stop.changed() => {
                        if changed.is_err() || *stop.borrow() {
                            break;
                        }
                    }
                }
            }
            debug!("heartbeat loop shutting down");
        });

        *self.state.lock().expect("daemon state poisoned") = Some(RunningHandle {
            stop_tx,
            capture: capture_task,
            flush: flush_task,
            heartbeat: heartbeat_task,
        });

        info!(
            flush_interval_s = FLUSH_INTERVAL.as_secs(),
            heartbeat_s = HEARTBEAT_INTERVAL.as_secs(),
            "daemon started"
        );
        Ok(())
    }

    pub async fn stop(&self) {
        let handle = {
            let mut st = self.state.lock().expect("daemon state poisoned");
            st.take()
        };
        let Some(handle) = handle else {
            return;
        };
        // session_end before stop so the event is in the outbox for the
        // final flush.
        if let Err(e) = self.emit_lifecycle(EventKind::SessionEnd).await {
            warn!(?e, "daemon: failed to emit session_end");
        }
        let _ = handle.stop_tx.send(true);
        // Best-effort wait; if a task is wedged we don't want to hang the UI.
        let join_timeout = Duration::from_secs(5);
        for (name, fut) in [
            ("capture", handle.capture),
            ("flush", handle.flush),
            ("heartbeat", handle.heartbeat),
        ] {
            match tokio::time::timeout(join_timeout, fut).await {
                Ok(Ok(())) => debug!(task = name, "joined"),
                Ok(Err(e)) => error!(task = name, ?e, "task panicked"),
                Err(_) => warn!(task = name, "join timed out"),
            }
        }
        info!("daemon stopped");
    }

    async fn emit_lifecycle(&self, kind: EventKind) -> AppResult<()> {
        let ev = lifecycle_event(kind, env!("CARGO_PKG_VERSION"));
        self.outbox.append(&ev).await?;
        let new_depth = self.flush_signals.queue_depth.fetch_add(1, Ordering::Relaxed) + 1;
        if new_depth >= crate::outbox::MAX_BATCH_SIZE {
            self.flush_signals.poke.notify_one();
        }
        Ok(())
    }
}

fn lifecycle_event(kind: EventKind, client_version: &str) -> StoredEvent {
    let live = TelemetryEvent {
        id: new_event_id(),
        kind,
        source: "desktop",
        target: TargetPayload::Empty(EmptyTarget {}),
        started_at: OffsetDateTime::now_utc(),
        ended_at: None,
        duration_ms: None,
        client_version: client_version.to_string(),
    };
    StoredEvent::from(live)
}

// We don't need to surface AppError here, but keeping the import groups
// honest so the module compiles cleanly on a path where `AppError::Internal`
// is the only AppError variant referenced.
#[allow(dead_code)]
fn _force_apperror_path(_: AppError) {}
