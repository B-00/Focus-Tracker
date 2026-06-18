//! Focus Tracker desktop client — Tauri 2 application entry point.
//!
//! Top-level wiring:
//!   * Initialise tracing (env-filter friendly).
//!   * Load (or initialise) the on-disk config.
//!   * Build the shared `Outbox` and `Daemon` orchestrator.
//!   * Register Tauri-managed state (commands.rs::AppState).
//!   * Build the system tray with Open / Pause / Resume / Open dashboard /
//!     Quit menu items (DesktopApp.md §6).
//!   * Intercept window close so it minimises to tray instead of quitting
//!     the process — desktop daemon must keep running to capture activity.
//!   * On startup, if paired, start the capture+flush daemon eagerly.

mod capture;
mod commands;
mod config;
mod daemon;
mod errors;
mod events;
mod flusher;
mod keychain;
mod outbox;
mod pairing;

use crate::{
    commands::AppState,
    config::{outbox_path, DesktopConfig},
    daemon::Daemon,
    outbox::Outbox,
};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tracing::{debug, error, info, warn};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let config = match DesktopConfig::load_or_init() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[fatal] failed to load config: {e:?}");
            std::process::exit(1);
        }
    };

    let outbox_path = match outbox_path() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[fatal] failed to resolve outbox path: {e:?}");
            std::process::exit(1);
        }
    };
    let outbox = Arc::new(Outbox::new(outbox_path, config.recent_capacity));
    let daemon = Arc::new(Daemon::new(outbox.clone(), config.paused));

    let _ = outbox; // ownership lives in `daemon`; we don't need the handle in lib.rs anymore
    let app_state = match AppState::new(config.clone(), daemon.clone()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[fatal] failed to initialise AppState: {e:?}");
            std::process::exit(1);
        }
    };

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(move |app| {
            build_tray(app.handle())?;
            // Spawn a one-shot task that kicks off the daemon if we already
            // have an API key in the keychain. We do this from setup() so
            // the Tauri runtime is fully initialised before we touch state.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = autostart_daemon_if_paired(handle).await {
                    warn!(?e, "autostart skipped");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimise-to-tray behaviour: closing the settings window
            // hides it instead of exiting the daemon.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::set_api_base_url,
            commands::start_pairing,
            commands::poll_pairing,
            commands::cancel_pairing,
            commands::unpair_local,
            commands::set_paused,
            commands::set_recent_capacity,
            commands::open_dashboard,
            commands::get_recent_events,
        ])
        .build(tauri::generate_context!());

    let app = match result {
        Ok(a) => a,
        Err(e) => {
            error!(error = ?e, "fatal: tauri build failed");
            eprintln!("[fatal] tauri build failed: {e:?}");
            std::process::exit(1);
        }
    };

    // Block on run so we can call daemon.stop() after the event loop exits.
    let captured_daemon = daemon.clone();
    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            // Synchronous drain on the tokio runtime so the final flush
            // gets a chance to land before we tear down.
            tauri::async_runtime::block_on(captured_daemon.stop());
        }
    });
}

async fn autostart_daemon_if_paired(app: AppHandle) -> Result<(), String> {
    let api_key = match keychain::read() {
        Ok(Some(k)) => k,
        Ok(None) => {
            debug!("autostart: no API key in keychain — staying idle");
            return Ok(());
        }
        Err(e) => return Err(format!("keychain read failed: {e}")),
    };
    let state = app.state::<AppState>();
    let cfg = state
        .config
        .lock()
        .map_err(|e| format!("config mutex poisoned: {e}"))?
        .clone();
    state
        .daemon
        .start(&cfg, api_key)
        .await
        .map_err(|e| format!("daemon start failed: {e}"))?;
    info!("daemon autostarted from existing keychain pairing");
    Ok(())
}

fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .try_init();
    info!(
        version = env!("CARGO_PKG_VERSION"),
        "focus-tracker-desktop starting"
    );
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open-settings", "Open settings", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, "open-dashboard", "Open dashboard", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause-capture", "Pause capture", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume-capture", "Resume capture", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Focus Tracker", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &dashboard, &separator, &pause, &resume, &separator, &quit],
    )?;

    TrayIconBuilder::with_id("main-tray")
        .tooltip("Focus Tracker")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound("default window icon".into())
        })?)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-settings" => show_main_window(app),
            "open-dashboard" => {
                let state = app.state::<AppState>();
                if let Err(e) = commands::open_dashboard(state, app.clone()) {
                    warn!(?e, "open-dashboard failed");
                }
            }
            "pause-capture" => {
                let state = app.state::<AppState>();
                if let Err(e) = commands::set_paused(true, state) {
                    warn!(?e, "pause-capture failed");
                }
            }
            "resume-capture" => {
                let state = app.state::<AppState>();
                if let Err(e) = commands::set_paused(false, state) {
                    warn!(?e, "resume-capture failed");
                }
            }
            "quit" => {
                // Drain on the way out.
                let state = app.state::<AppState>();
                let daemon = state.daemon.clone();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    daemon.stop().await;
                    app_handle.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
