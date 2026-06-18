// Tauri's build script. It does the codegen for `tauri::generate_context!()`
// (reads `tauri.conf.json`, processes icons, generates the permission
// schema, etc.). Should be left untouched in v1.
fn main() {
    tauri_build::build()
}
