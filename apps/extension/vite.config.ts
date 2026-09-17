import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

// Build pipeline for the Firefox extension.
//
// The extension has multiple, browser-loaded entry points (background event
// page + popup as of Slice 3). Each must end up as a standalone bundle
// under `dist/`, ready for Firefox to side-load via
// `about:debugging#/runtime/this-firefox` → Load Temporary Add-on…
//
// The manifest.json + icons get copied from the source tree as-is via
// `vite-plugin-static-copy` so we don't have to maintain a parallel
// "manifest.json in src + manifest.json in dist" pair by hand.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // We intentionally don't minify in v1. The bundles are tiny, and a
    // readable background.js helps when poking at the running extension
    // in Firefox's "Inspect" devtools.
    minify: false,
    // Source maps inline so the devtools view matches the TS sources
    // without us having to host them anywhere.
    sourcemap: 'inline',
    rollupOptions: {
      input: {
        // Background event page — no HTML host, loaded directly by the
        // manifest's `background.scripts` field.
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
        // Popup — HTML entry so Vite processes the <script src> and
        // emits a proper popup.html + popup.js pair the manifest can
        // point `action.default_popup` at.
        popup: resolve(import.meta.dirname, 'popup.html'),
      },
      output: {
        // Flat layout so manifest paths are predictable:
        //   manifest.json → background.js, popup.html
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        // ES modules: matches `background.type: "module"` in the manifest.
        format: 'es',
      },
    },
  },
  plugins: [
    // Preact + automatic JSX transform. Bundles Preact instead of React
    // (~3 KB gzipped vs ~40) for the popup UI.
    preact(),
    viteStaticCopy({
      targets: [
        // Manifest sits at the extension root, gets copied to dist/.
        { src: 'manifest.json', dest: '.' },
        // PNG icons — sources committed in icons/; regenerated from
        // icons/icon.svg via `pnpm icons` when the design changes.
        { src: 'icons/icon-*.png', dest: 'icons' },
      ],
    }),
  ],
});
