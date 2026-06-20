import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';

// Build pipeline for the Firefox extension.
//
// The extension has multiple, browser-loaded entry points (background event
// page in slice 1; popup + options HTML in slice 3). Each must end up as a
// standalone bundle under `dist/`, ready for `web-ext run` to pick up.
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
    // Library-style multi-entry build. No single index.html host page —
    // each entry is a distinct file the browser loads directly per the
    // manifest.
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        // Flat layout so manifest paths are predictable:
        //   manifest.json → background.js
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        // ES modules: matches `background.type: "module"` in the manifest.
        format: 'es',
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        // Manifest sits at the extension root, gets copied to dist/.
        // Slice 5 will add an `icons/` target here for the AMO bundle.
        { src: 'manifest.json', dest: '.' },
      ],
    }),
  ],
});
