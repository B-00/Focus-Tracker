import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Bind to IPv6 wildcard with Node's default dual-stack enabled, so
    // `http://localhost:5173`, `http://127.0.0.1:5173`, and `http://[::1]:5173`
    // all reach us. Windows resolves `localhost` inconsistently across
    // browsers/launchers (Cursor's embedded browser hits IPv4; the desktop
    // app's `tauri-plugin-opener` → Edge hits IPv6), so listening on one
    // stack broke the other. Dual-stack `::` covers both without exposing
    // LAN. ponytail: relies on Node's default `ipv6Only: false`.
    host: '::',
    // Proxy API requests so the web client can use relative `/v1/...` URLs in
    // dev. In production the web client points at the real API origin via
    // VITE_API_BASE_URL.
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
