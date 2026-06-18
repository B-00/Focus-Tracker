import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri uses a fixed port for the dev server so the Rust side knows where to
// load the webview from. Don't change it without also updating
// `tauri.conf.json#build.devUrl`.
const TAURI_DEV_PORT = 1420;

// `TAURI_DEV_HOST` is set by `tauri dev` when running on a network device
// (e.g. mobile / VM testing). Fall back to undefined → loopback only.
const TAURI_DEV_HOST = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()] as PluginOption[],

  // Tauri-recommended dev server posture: strictPort so HMR doesn't silently
  // move to 1421 and break the webview; hmr host pinned when running on a
  // network device.
  clearScreen: false,
  server: {
    port: TAURI_DEV_PORT,
    strictPort: true,
    host: TAURI_DEV_HOST ?? false,
    hmr: TAURI_DEV_HOST
      ? { protocol: 'ws', host: TAURI_DEV_HOST, port: TAURI_DEV_PORT + 1 }
      : undefined,
    watch: {
      // Don't restart the dev server when files inside src-tauri change —
      // Tauri's own watcher handles those and triggers a Rust rebuild.
      ignored: ['**/src-tauri/**'],
    },
  },

  // Vite prints env vars prefixed with TAURI_ENV_ so the frontend can read
  // build-time platform info (e.g. import.meta.env.TAURI_ENV_PLATFORM).
  envPrefix: ['VITE_', 'TAURI_ENV_'],

  // Targeting a recent Chromium fits WebView2 (Windows) and modern WebKit
  // (macOS 12+). Tauri's docs recommend chrome105 / safari13 as the floor.
  build: {
    target: ['chrome105', 'safari13'],
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    minify: !process.env.TAURI_ENV_DEBUG,
  },
});
