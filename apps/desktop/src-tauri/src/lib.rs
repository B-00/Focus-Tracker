//! Focus Tracker desktop client — Tauri 2 application entry point.
//!
//! Top-level wiring:
//!   * Initialise tracing (env-filter friendly).
//!   * Load (or initialise) the on-disk config.
//!   * Register Tauri-managed state (commands.rs::AppState).
//!   * Build the system tray with Open / Quit menu items (DesktopApp.md §6).
//!   * Intercept window close so it minimises to tray instead of quitting
//!     the process — desktop daemon must keep running to capture activity.
//!
//! NOTE: The focus-capture loop and outbox + flusher live in Slice 5.
//! For now the daemon is "online" only insofar as the tray + settings
//! window are present.

mod commands;
mod config;
mod errors;
mod events;
mod keychain;
mod pairing;

use crate::{commands::AppState, config::DesktopConfig};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tracing::{error, info};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let config = match DesktopConfig::load_or_init() {
        Ok(c) => c,
        Err(e) => {
            // Fatal-during-bootstrap. We can't show a window without
            // running the app loop, so log + bail.
            eprintln!("[fatal] failed to load config: {e:?}");
            std::process::exit(1);
        }
    };

    let app_state = match AppState::new(config) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[fatal] failed to initialise AppState: {e:?}");
            std::process::exit(1);
        }
    };

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(|app| {
            build_tray(app.handle())?;
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
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        error!(error = ?e, "fatal: tauri runtime exited with error");
        eprintln!("[fatal] tauri runtime exited with error: {e:?}");
        std::process::exit(1);
    }
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
    // Pause/resume is a stub today — the capture loop ships in slice 5.
    // We keep the menu item in v1 so the tray UX is stable from day one.
    let open = MenuItem::with_id(app, "open-settings", "Open settings", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause-stub", "Pause capture (TODO)", false, None::<&str>)?;
    let separator =
        tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Focus Tracker", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pause, &separator, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .tooltip("Focus Tracker")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound("default window icon".into())
        })?)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-settings" => show_main_window(app),
            "quit" => {
                // Explicit quit from the tray. Daemon shutdown happens
                // synchronously; in slice 5 we'll add a "drain outbox
                // before exit" pass here.
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click reveals the settings window — same UX as the
            // browser extension's action button.
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
