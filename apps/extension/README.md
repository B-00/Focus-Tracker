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

`pnpm dev` runs two things in parallel:

1. `vite build --watch` — rebuilds `dist/` on every source change.
2. `web-ext run --target=firefox-desktop` — launches a temporary Firefox profile, side-loads the unpacked extension from `dist/`, and auto-reloads it on every rebuild.

`web-ext` opens Firefox to `about:debugging#/runtime/this-firefox`. From there, click **Inspect** on the "Focus Tracker" entry to get a devtools window for the background event page. The console there is where the `[focus-tracker]` log lines appear.

## Manual verification (slice 1)

Once Firefox launches:

1. Open the inspector (above) for the background page.
2. Switch between tabs / windows / apps — each focus transition logs a line like:
   ```
   [focus-tracker] focus transition: github.com → news.ycombinator.com
   ```
3. Lock your screen or step away for ≥60s — the next log line should be `→ (none)` (idle handling).
4. Come back, do something — the next log line resumes with whatever tab is now active.

If those four behaviors check out, slice 1 is working.

## What's NOT in this slice

- IndexedDB outbox (slice 2)
- Pairing UI / popup (slice 3)
- Flusher to the API (slice 4)
- Options page, error log, icons, AMO packaging (slice 5)
