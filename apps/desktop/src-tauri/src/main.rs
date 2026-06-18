// Suppress the extra console window on Windows in release. The dev build
// keeps stdout for tracing output; release is a true windowless GUI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    focus_tracker_desktop_lib::run();
}
