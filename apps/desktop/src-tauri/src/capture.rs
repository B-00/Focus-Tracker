//! Foreground-window capture loop.
//!
//! Spec: DesktopApp.md §6 (architecture), §7 (event types), §11 (privacy
//! controls).
//!
//! Polls the OS once per `POLL_INTERVAL` for:
//!   * which app is currently in the foreground (app-level only — we
//!     deliberately don't read window titles, per spec §2 Non-Goals)
//!   * how long since the last user input
//!
//! Behaviour:
//!   * **Active → Active, same app**: do nothing. Tab/document switches
//!     inside the same app are intentionally ignored — they'd fragment
//!     the rollup table and leak document names.
//!   * **Active → Active, different app**: emit a `focus_change` for the
//!     event we just ended (start..now), start a fresh in-flight event.
//!   * **Active → Idle** (no input ≥ `IDLE_THRESHOLD`): emit the in-flight
//!     event with `endedAt = lastInputTime` (clamped to ≥ startedAt), so we
//!     don't credit "user was in Cursor for 9 hours" to a closed laptop.
//!     Stop tracking until activity resumes (spec §7.1, "internal-only —
//!     not a wire event").
//!   * **Idle → Active**: start a fresh in-flight event for whatever is
//!     foregrounded now.
//!
//! All access to the OS sits behind the `FocusSource` / `IdleSource` traits
//! so unit tests can drive deterministic sequences without touching real
//! windows or input devices.

use crate::{
    config::DesktopConfig,
    errors::AppResult,
    events::{new_event_id, DesktopFocusTarget, EventKind, StoredEvent, TargetPayload, TelemetryEvent},
    outbox::Outbox,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::Duration,
};
use time::OffsetDateTime;
use tokio::sync::watch;
use tracing::{debug, warn};

/// How often to poll the OS. Spec doesn't pin a value; 1s is a sensible
/// floor that catches every realistic context switch without burning CPU.
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// No-input duration after which we consider the user idle and bound the
/// in-flight focus_change event (DesktopApp.md §7.1).
pub const IDLE_THRESHOLD: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------------------
//  Trait abstractions for testability
// ---------------------------------------------------------------------------

/// Snapshot of the foreground window at one instant.
///
/// Note: deliberately does NOT carry the window title. v1 captures at
/// app granularity only (DesktopApp.md §2 Non-Goals).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusSnapshot {
    pub app_name: String,
    /// Full process path on Windows; bundle id on macOS where available.
    /// Reused as `appBundleId` on the wire when present.
    pub app_bundle_id: Option<String>,
}

pub trait FocusSource: Send + Sync + 'static {
    fn current(&self) -> Option<FocusSnapshot>;
}

pub trait IdleSource: Send + Sync + 'static {
    fn since_last_input(&self) -> Duration;
}

// ---------------------------------------------------------------------------
//  Live (real-OS) implementations
// ---------------------------------------------------------------------------

pub struct LiveFocusSource;

impl FocusSource for LiveFocusSource {
    fn current(&self) -> Option<FocusSnapshot> {
        match active_win_pos_rs::get_active_window() {
            Ok(w) => Some(FocusSnapshot {
                // macOS gives a friendly `app_name`; Windows/Linux often
                // leave it empty. Fall back to the binary stem of the
                // process path (e.g. "Cursor" from "...\\Cursor.exe") and
                // finally to "Unknown" so we always have a non-empty value.
                app_name: if !w.app_name.is_empty() {
                    w.app_name.clone()
                } else if let Some(stem) = w.process_path.file_stem() {
                    stem.to_string_lossy().to_string()
                } else {
                    "Unknown".to_string()
                },
                // TODO(desktop): Win32 AUMID via IPropertyStore +
                // PKEY_AppUserModel_ID would give us a stable per-app
                // identifier; for now the process path is the most stable
                // thing active-win-pos-rs exposes.
                app_bundle_id: {
                    let p = w.process_path.to_string_lossy().to_string();
                    if p.is_empty() { None } else { Some(p) }
                },
            }),
            Err(_) => None,
        }
    }
}

pub struct LiveIdleSource;

impl IdleSource for LiveIdleSource {
    fn since_last_input(&self) -> Duration {
        match user_idle::UserIdle::get_time() {
            Ok(i) => i.duration(),
            Err(_) => Duration::ZERO,
        }
    }
}

// ---------------------------------------------------------------------------
//  Capture loop
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct InFlightFocus {
    app_name: String,
    app_bundle_id: Option<String>,
    started_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
enum CaptureState {
    Active(InFlightFocus),
    Idle,
}

/// Knobs the runtime can flip while the capture loop is running.
#[derive(Debug, Clone)]
pub struct CaptureFlags {
    /// `true` → loop ticks but emits nothing and finalises the in-flight
    /// event. Re-enabling resumes from whatever the foreground is then.
    pub paused: Arc<AtomicBool>,
}

impl CaptureFlags {
    pub fn new(paused: bool) -> Self {
        Self {
            paused: Arc::new(AtomicBool::new(paused)),
        }
    }
}

pub struct CaptureLoop {
    outbox: Arc<Outbox>,
    focus: Box<dyn FocusSource>,
    idle: Box<dyn IdleSource>,
    flags: CaptureFlags,
    client_version: String,
    poll_interval: Duration,
    idle_threshold: Duration,
    state: StdMutex<CaptureState>,
}

impl CaptureLoop {
    pub fn new(
        outbox: Arc<Outbox>,
        focus: Box<dyn FocusSource>,
        idle: Box<dyn IdleSource>,
        flags: CaptureFlags,
        cfg: &DesktopConfig,
    ) -> Self {
        let _ = cfg; // Reserved for per-user config knobs in later slices.
        Self {
            outbox,
            focus,
            idle,
            flags,
            client_version: env!("CARGO_PKG_VERSION").to_string(),
            poll_interval: POLL_INTERVAL,
            idle_threshold: IDLE_THRESHOLD,
            state: StdMutex::new(CaptureState::Idle),
        }
    }

    /// Long-running task. Drops when `stop.changed()` flips to `true`.
    /// Finalises any in-flight focus_change event on shutdown so it doesn't
    /// stay open-ended in the outbox.
    pub async fn run(self: Arc<Self>, mut stop: watch::Receiver<bool>) {
        let mut ticker = tokio::time::interval(self.poll_interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        debug!(
            poll_ms = self.poll_interval.as_millis(),
            idle_ms = self.idle_threshold.as_millis(),
            "capture loop running"
        );
        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if self.flags.paused.load(Ordering::Relaxed) {
                        self.finalise_in_flight(OffsetDateTime::now_utc()).await;
                        continue;
                    }
                    if let Err(e) = self.tick().await {
                        warn!(?e, "capture tick failed");
                    }
                }
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() {
                        self.finalise_in_flight(OffsetDateTime::now_utc()).await;
                        debug!("capture loop shutting down");
                        break;
                    }
                }
            }
        }
    }

    async fn tick(&self) -> AppResult<()> {
        let now = OffsetDateTime::now_utc();
        let idle_dur = self.idle.since_last_input();
        let is_idle = idle_dur >= self.idle_threshold;
        let last_input = now - idle_dur;

        let mut emit_now: Option<(InFlightFocus, OffsetDateTime)> = None;
        let mut new_state: Option<CaptureState> = None;

        {
            let st = self.state.lock().expect("capture state mutex poisoned");
            match &*st {
                CaptureState::Active(curr) => {
                    if is_idle {
                        // Bound the in-flight event at last-input time so we
                        // don't credit idle minutes to the foreground app.
                        // Clamp to ≥ startedAt to avoid negative-duration
                        // events when the user goes idle inside the poll
                        // interval after a window switch.
                        let bound = if last_input > curr.started_at {
                            last_input
                        } else {
                            curr.started_at
                        };
                        emit_now = Some((curr.clone(), bound));
                        new_state = Some(CaptureState::Idle);
                    } else if let Some(snap) = self.focus.current() {
                        // App-level switch detection only. Same-app
                        // title/tab churn is ignored by design.
                        if snap.app_name != curr.app_name {
                            emit_now = Some((curr.clone(), now));
                            new_state = Some(CaptureState::Active(InFlightFocus {
                                app_name: snap.app_name,
                                app_bundle_id: snap.app_bundle_id,
                                started_at: now,
                            }));
                        }
                    }
                    // No focus source / same app: nothing to do.
                }
                CaptureState::Idle => {
                    if !is_idle {
                        if let Some(snap) = self.focus.current() {
                            new_state = Some(CaptureState::Active(InFlightFocus {
                                app_name: snap.app_name,
                                app_bundle_id: snap.app_bundle_id,
                                started_at: now,
                            }));
                        }
                    }
                }
            }
        }
        if let Some(ns) = new_state {
            *self.state.lock().expect("capture state mutex poisoned") = ns;
        }
        if let Some((ev, ended_at)) = emit_now {
            let stored = self.make_focus_event(&ev, ended_at);
            self.outbox.append(&stored).await?;
        }
        Ok(())
    }

    async fn finalise_in_flight(&self, ended_at: OffsetDateTime) {
        let in_flight = {
            let mut st = self.state.lock().expect("capture state mutex poisoned");
            match std::mem::replace(&mut *st, CaptureState::Idle) {
                CaptureState::Active(ev) => Some(ev),
                CaptureState::Idle => None,
            }
        };
        if let Some(ev) = in_flight {
            let bounded = if ended_at > ev.started_at {
                ended_at
            } else {
                ev.started_at
            };
            let stored = self.make_focus_event(&ev, bounded);
            if let Err(e) = self.outbox.append(&stored).await {
                warn!(?e, "outbox append failed during finalise");
            }
        }
    }

    fn make_focus_event(&self, ev: &InFlightFocus, ended_at: OffsetDateTime) -> StoredEvent {
        let dur_ms = (ended_at - ev.started_at).whole_milliseconds().max(0) as u64;
        let live = TelemetryEvent {
            id: new_event_id(),
            kind: EventKind::FocusChange,
            source: "desktop",
            target: TargetPayload::Focus(DesktopFocusTarget {
                app_name: ev.app_name.clone(),
                app_bundle_id: ev.app_bundle_id.clone(),
                // window_title is deliberately never set on the desktop
                // client — DesktopApp.md §2 Non-Goals. The field stays in
                // the shared wire schema as Option<...> for the browser
                // extension and any future sources that might use it.
                window_title: None,
            }),
            started_at: ev.started_at,
            ended_at: Some(ended_at),
            duration_ms: Some(dur_ms),
            client_version: self.client_version.clone(),
        };
        StoredEvent::from(live)
    }
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::DEFAULT_API_BASE_URL;
    use std::sync::Mutex;
    use tempfile::TempDir;

    // ---- Fake sources -----------------------------------------------------

    struct FakeFocus(Mutex<Vec<Option<FocusSnapshot>>>);
    impl FakeFocus {
        fn from_vec(v: Vec<Option<FocusSnapshot>>) -> Self {
            Self(Mutex::new(v.into_iter().rev().collect()))
        }
    }
    impl FocusSource for FakeFocus {
        fn current(&self) -> Option<FocusSnapshot> {
            self.0.lock().unwrap().pop().unwrap_or(None)
        }
    }

    struct FakeIdle(Mutex<Vec<Duration>>);
    impl FakeIdle {
        fn from_vec(v: Vec<Duration>) -> Self {
            Self(Mutex::new(v.into_iter().rev().collect()))
        }
    }
    impl IdleSource for FakeIdle {
        fn since_last_input(&self) -> Duration {
            self.0.lock().unwrap().pop().unwrap_or(Duration::ZERO)
        }
    }

    fn snap(app: &str) -> FocusSnapshot {
        FocusSnapshot {
            app_name: app.into(),
            app_bundle_id: None,
        }
    }

    fn fresh_outbox() -> (TempDir, Arc<Outbox>) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("outbox.jsonl");
        (dir, Arc::new(Outbox::new(path)))
    }

    fn fake_config() -> DesktopConfig {
        DesktopConfig {
            api_base_url: DEFAULT_API_BASE_URL.to_string(),
            device_id: "test".into(),
            label: "test".into(),
            last_flush_at: None,
            paused: false,
        }
    }

    fn make_loop(
        focus: Box<dyn FocusSource>,
        idle: Box<dyn IdleSource>,
        outbox: Arc<Outbox>,
    ) -> CaptureLoop {
        CaptureLoop::new(
            outbox,
            focus,
            idle,
            CaptureFlags::new(false),
            &fake_config(),
        )
    }

    // ---- Behaviour --------------------------------------------------------

    #[tokio::test]
    async fn idle_to_active_starts_tracking_but_emits_nothing_yet() {
        let (_dir, ob) = fresh_outbox();
        let cap = make_loop(
            Box::new(FakeFocus::from_vec(vec![Some(snap("Cursor"))])),
            Box::new(FakeIdle::from_vec(vec![Duration::ZERO])),
            ob.clone(),
        );
        cap.tick().await.unwrap();
        assert_eq!(
            ob.len().await.unwrap(),
            0,
            "first transition idle→active should not emit anything"
        );
        let st = cap.state.lock().unwrap();
        assert!(matches!(&*st, CaptureState::Active(_)));
    }

    #[tokio::test]
    async fn app_switch_emits_focus_change_for_previous_app() {
        let (_dir, ob) = fresh_outbox();
        let cap = make_loop(
            Box::new(FakeFocus::from_vec(vec![
                Some(snap("Cursor")),
                Some(snap("Firefox")), // different app → switch
            ])),
            Box::new(FakeIdle::from_vec(vec![Duration::ZERO, Duration::ZERO])),
            ob.clone(),
        );
        cap.tick().await.unwrap(); // idle→active
        cap.tick().await.unwrap(); // Cursor → Firefox
        let events = ob.drain_head(10).await.unwrap();
        assert_eq!(events.len(), 1, "exactly one focus_change for Cursor");
        assert_eq!(events[0].kind, EventKind::FocusChange);
        let target = events[0].target.as_object().unwrap();
        assert_eq!(target.get("appName").unwrap().as_str().unwrap(), "Cursor");
        assert!(
            target.get("windowTitle").is_none(),
            "desktop client must never emit windowTitle (DesktopApp.md §2 Non-Goals)"
        );
    }

    #[tokio::test]
    async fn same_app_emits_nothing_even_across_many_ticks() {
        let (_dir, ob) = fresh_outbox();
        // Three ticks all reporting "Cursor" — no app change, no event.
        let cap = make_loop(
            Box::new(FakeFocus::from_vec(vec![
                Some(snap("Cursor")),
                Some(snap("Cursor")),
                Some(snap("Cursor")),
            ])),
            Box::new(FakeIdle::from_vec(vec![
                Duration::ZERO,
                Duration::ZERO,
                Duration::ZERO,
            ])),
            ob.clone(),
        );
        for _ in 0..3 {
            cap.tick().await.unwrap();
        }
        assert_eq!(ob.len().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn title_change_within_same_app_emits_nothing() {
        // Regression guard for the v1 "app-only tracking" requirement.
        // The fake focus source only carries app_name now, so the only way
        // a title change could be visible is via a future regression of the
        // FocusSnapshot shape — but we still want a behavioural assertion
        // that two "Cursor" snapshots in a row don't produce a second
        // event regardless of any internal state. (Real-world parallel:
        // user switches files inside Cursor.)
        let (_dir, ob) = fresh_outbox();
        let cap = make_loop(
            Box::new(FakeFocus::from_vec(vec![
                Some(snap("Cursor")),
                Some(snap("Cursor")),
            ])),
            Box::new(FakeIdle::from_vec(vec![Duration::ZERO, Duration::ZERO])),
            ob.clone(),
        );
        cap.tick().await.unwrap();
        cap.tick().await.unwrap();
        assert_eq!(ob.len().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn idle_bounds_in_flight_event_and_stops_tracking() {
        let (_dir, ob) = fresh_outbox();
        let cap = make_loop(
            Box::new(FakeFocus::from_vec(vec![
                Some(snap("Cursor")),
                Some(snap("Cursor")),
                Some(snap("Cursor")),
            ])),
            Box::new(FakeIdle::from_vec(vec![
                Duration::ZERO,                              // active
                Duration::from_secs(120),                    // idle  → emit
                Duration::from_secs(180),                    // still idle
            ])),
            ob.clone(),
        );
        cap.tick().await.unwrap();
        cap.tick().await.unwrap();
        cap.tick().await.unwrap();
        let events = ob.drain_head(10).await.unwrap();
        assert_eq!(
            events.len(),
            1,
            "idle threshold crossing emits exactly one event"
        );
        let st = cap.state.lock().unwrap();
        assert!(matches!(&*st, CaptureState::Idle));
    }

    #[tokio::test]
    async fn paused_loop_finalises_inflight_and_emits_nothing_new() {
        let (_dir, ob) = fresh_outbox();
        let cap = CaptureLoop::new(
            ob.clone(),
            Box::new(FakeFocus::from_vec(vec![Some(snap("Cursor"))])),
            Box::new(FakeIdle::from_vec(vec![Duration::ZERO])),
            CaptureFlags::new(false),
            &fake_config(),
        );
        cap.tick().await.unwrap(); // active established
        cap.flags.paused.store(true, Ordering::Relaxed);
        cap.finalise_in_flight(OffsetDateTime::now_utc()).await;
        let events = ob.drain_head(10).await.unwrap();
        assert_eq!(events.len(), 1, "paused finalise should flush the in-flight event");
        let st = cap.state.lock().unwrap();
        assert!(matches!(&*st, CaptureState::Idle));
    }
}
