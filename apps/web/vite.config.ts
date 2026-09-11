import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Bind to IPv4 loopback explicitly. Without this, Vite on Windows +
    // recent Node binds to `[::1]:5173` only (IPv6 loopback), and Edge/
    // Chromium resolves `localhost` to `127.0.0.1` first — the browser
    // hits ECONNREFUSED even though `curl http://localhost:5173` works
    // (curl happens to try IPv6). `127.0.0.1` also matches the API
    // proxy target below so both sides of the dev loop use the same
    // loopback family. ponytail: hardcoded IPv4 loopback; if we ever
    // want LAN access from another device, switch to `true` here.
    host: '127.0.0.1',
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
