# Focus Tracker

Personal focus-tracking app. Full project plan lives in [`PROJECT.md`](./PROJECT.md); per-feature specs live in [`Features Markdown/`](./Features%20Markdown/); telemetry source-client specs live in [`Sources Markdown/`](./Sources%20Markdown/).

## Stack at a glance

| Workspace                | What it is                                                                |
| ------------------------ | ------------------------------------------------------------------------- |
| `apps/api`               | NestJS + Prisma + Postgres backend. Owns `/v1/*` endpoints.               |
| `apps/web`               | React 19 + Vite + Tailwind v4 + TanStack Query/Router client.             |
| `packages/shared`        | TypeScript types + Zod schemas imported by `apps/web` and `apps/api`.     |
| `apps/extension` _(TBD)_ | Browser extension telemetry source (see `Sources Markdown/Extension.md`). |
| `apps/desktop` _(TBD)_   | Tauri + Rust desktop telemetry source (see `Sources Markdown/DesktopApp.md`). |

## Getting started

See [SETUP.md](./SETUP.md) for prerequisites, fresh-install steps, daily commands, and troubleshooting.

TL;DR for someone who already has Node 22 + pnpm 10 + Docker:

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:up
pnpm db:migrate
pnpm dev          # API on :3000, web on :5173
```
