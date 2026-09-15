# `@focus-tracker/extension`

Firefox extension that captures website focus events and ships them to the Focus Tracker API.

Source-client spec: [`../../Sources Markdown/Extension.md`](../../Sources%20Markdown/Extension.md).

## Quick start

```bash
# from monorepo root
pnpm install

# from this directory
pnpm dev
```

`pnpm dev` runs `vite build --watch` — it rebuilds `dist/` on every source change. It does **not** launch a Firefox window; you side-load the extension yourself once and use Firefox's built-in reload to pick up subsequent rebuilds.

## Loading the extension in Firefox (one-time)

1. Open Firefox Developer Edition.
2. Navigate to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**
4. Select `apps/extension/dist/manifest.json`.

The extension now shows up in the list as **Focus Tracker**. Temporary add-ons are cleared when Firefox restarts, so you'll repeat this step once per Firefox session.

## Reload cycle (every change)

1. Save your source file → `vite` rebuilds `dist/` (watch mode).
2. Go back to `about:debugging#/runtime/this-firefox`.
3. On the Focus Tracker entry, click **Reload**.
4. Click **Inspect** to open a devtools window for the background event page — the `[focus-tracker]` log lines appear in that console.

That's the loop: save → reload in `about:debugging` → check devtools.

## Manual verification (slice 1)

Once the extension is loaded and you've opened the background page inspector:

1. Switch between tabs / windows / apps — each focus transition logs a line like:
   ```
   [focus-tracker] focus transition: github.com → news.ycombinator.com
   ```
2. Lock your screen or step away for ≥60s — the next log line should be `→ (none)` (idle handling).
3. Come back, do something — the next log line resumes with whatever tab is now active.

If those three behaviors check out, slice 1 is working.

## Other scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | One-shot production build. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm webext:lint` | Runs `web-ext lint` over `dist/`. Doesn't launch Firefox. |
| `pnpm webext:build` | Packages `dist/` into `web-ext-artifacts/*.zip` for AMO submission (slice 5). Doesn't launch Firefox. |

## Self-checks

Standalone assertion scripts you can run without any test runner:

```bash
# ULID generator (26-char alphabet + monotonicity on a 1000-id burst)
node --experimental-strip-types apps/extension/src/id/ulid.check.ts

# Flusher drain loop (all five branch outcomes with in-memory fakes)
node --experimental-strip-types apps/extension/src/background/flusher.check.ts
```

Each exits non-zero on any regression.

## What's NOT in this slice

- Options page, error log, icons, AMO packaging (slice 5)
