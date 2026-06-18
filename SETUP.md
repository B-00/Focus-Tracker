# Setup

Fresh-install instructions for the Focus Tracker monorepo. If you just cloned the repo, start here.

> If you only need a refresher on day-to-day commands, jump to [Daily workflow](#daily-workflow).

---

## 1. Prerequisites

Install these on your machine first:

| Tool                | Version | Notes                                                                 |
| ------------------- | ------- | --------------------------------------------------------------------- |
| **Node.js**         | `>= 22` | Matches `.nvmrc`. Install via [nodejs.org](https://nodejs.org/) or `nvm`. |
| **pnpm**            | `>= 10` | `npm install -g pnpm` (or `corepack enable && corepack prepare pnpm@latest --activate`). |
| **Docker Desktop**  | latest  | Runs the local Postgres container. [Get it here](https://www.docker.com/products/docker-desktop/). Must be **running** before any `pnpm db:*` command. |
| **Git**             | any     | For cloning.                                                          |
| **Rust** (desktop only) | stable | Only needed if you'll work on `apps/desktop/`. Install via [rustup](https://www.rust-lang.org/tools/install) — on Windows: `winget install Rustlang.Rustup`, then `rustup default stable`. |

Verify with:

```bash
node --version    # v22.x
pnpm --version    # 10.x
docker --version  # any recent version
rustc --version   # only if you're building the desktop app
```

---

## 2. First-time setup

Run these once after cloning.

```bash
# 1. Install all workspace dependencies. The API's postinstall hook runs
#    `prisma generate` for you — no separate step needed.
pnpm install

# 2. Create local env files from the committed examples. Both are gitignored.
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 3. Start the Postgres container (pulls the image on first run — ~106 MB).
pnpm db:up

# 4. Apply the database schema. Prisma will create the schema and seed the
#    migration history table.
pnpm db:migrate
```

You should now have:

- A `focus-tracker-db` container running on host port `5433`
- 19 tables in the `focus_tracker` database
- A regenerated Prisma client in `node_modules/@prisma/client`

---

## 3. Running it

```bash
pnpm dev
```

Runs every workspace's `dev` script in parallel:

- **API** → http://localhost:3000/v1 (NestJS, watch mode)
- **Web** → http://localhost:5173 (Vite, hot-reload)

Open <http://localhost:5173> — you should see "Focus Tracker" with a live green `status: ok` pill driven by the `/v1/health` endpoint.

To run them individually:

```bash
pnpm --filter @focus-tracker/api dev
pnpm --filter @focus-tracker/web dev
```

### Desktop app (Tauri 2)

Optional — only if you're working on `apps/desktop/`. Needs the Rust toolchain (§1).

```bash
pnpm --filter @focus-tracker/desktop dev
```

The first run downloads Rust dependencies and may take 5–10 minutes. After that, `tauri dev` is a normal watch loop: Vite serves the React UI on `localhost:1420`, and Rust source changes trigger a rebuild + window reload.

You can also leave `pnpm dev` (API + web) running in one terminal and `pnpm --filter @focus-tracker/desktop dev` in another — the desktop app talks to the API just like the browser extension does.

---

## 4. Daily workflow

### The commands

| Command              | What it does                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `pnpm dev`           | Run API + web in parallel                                             |
| `pnpm db:up`         | Start Postgres (idempotent — fine to run if already up)               |
| `pnpm db:down`       | Stop Postgres. Your data stays in the Docker volume.                  |
| `pnpm db:logs`       | Tail Postgres logs                                                    |
| `pnpm db:studio`     | Open Prisma Studio (web UI for browsing/editing rows) at :5555        |
| `pnpm db:migrate`    | Create + apply a new migration after editing `schema.prisma`          |
| `pnpm db:generate`   | Regenerate the Prisma client without running a migration              |
| `pnpm db:reset`      | **Destroys all data** — drops the DB and re-runs every migration      |
| `pnpm build`         | Build every workspace for production                                  |
| `pnpm typecheck`     | Run `tsc --noEmit` across the monorepo                                |
| `pnpm format`        | Run Prettier across the repo                                          |

### Editing the database schema

1. Edit [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma).
2. `pnpm db:migrate` — Prisma diffs against the live DB, prompts you for a migration name (e.g. `add_section_color`), writes `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`, applies it, and regenerates the Prisma client.
3. Commit the new migration folder alongside the schema change.

For SQL that Prisma's schema syntax can't express (partial unique indexes, GIN/GIST indexes, raw triggers, etc.), use `--create-only`:

```bash
pnpm --filter @focus-tracker/api exec prisma migrate dev --create-only --name my_change
# Edit the generated migration.sql by hand
pnpm db:migrate    # apply it
```

Working example: [`apps/api/prisma/migrations/20260614202307_focus_session_partial_unique/migration.sql`](apps/api/prisma/migrations/20260614202307_focus_session_partial_unique/migration.sql).

### Inspecting the data

Three options, ranked by ease:

1. **Prisma Studio** — `pnpm db:studio`, then browse at <http://localhost:5555>. Best for almost everything.
2. **Docker Desktop GUI** — open Docker Desktop, click `focus-tracker-db` → `Logs` / `Exec` / `Inspect` tabs. Useful when you suspect the container itself is the problem.
3. **`psql` inside the container** — for raw SQL:
   ```bash
   docker exec -it focus-tracker-db psql -U focus_tracker -d focus_tracker
   ```
   Standard psql: `\dt` to list tables, `\d "Task"` to describe one, `\q` to quit.

---

## 5. Troubleshooting

### "Authentication failed against database server" right after `pnpm db:migrate`

You probably already have a native Postgres listening on port `5432` (common if you've installed Postgres directly on Windows or macOS at some point). Our container is intentionally mapped to **host port `5433`** to dodge this — verify both files agree:

- [`docker-compose.yml`](docker-compose.yml) → `ports: ['5433:5432']`
- [`apps/api/.env`](apps/api/.env.example) → `DATABASE_URL=...@localhost:5433/...`

If they don't agree, change one to match the other, then `docker compose down && pnpm db:up`.

Want to use a different port entirely (say `5434`)? Update both files to use `5434` instead, then recreate the container.

### "Cannot find module 'D:\...\dist\main'" when starting the API

`nest-cli.json` deletes `dist/` before each build. If you've got stale `.tsbuildinfo` files lying around from a previous typecheck, tsc thinks "nothing changed, nothing to emit" and produces no JS. Fix:

```bash
find apps packages -name "*.tsbuildinfo" -delete
pnpm --filter @focus-tracker/api dev
```

(The base `tsconfig.base.json` no longer enables `incremental` for exactly this reason — this should not recur.)

### The API can't see new schema fields after editing `schema.prisma`

You forgot to regenerate the Prisma client.

```bash
pnpm db:generate     # regen only
# — or —
pnpm db:migrate      # regen + create + apply migration
```

### "Migration failed to apply" / schema looks broken / I just want a clean slate

Easiest, if you have no real data yet, is to wipe the Docker volume and start over:

```bash
docker compose down -v   # the -v deletes the volume (all DB data)
pnpm db:up
pnpm db:migrate          # re-applies every committed migration on a fresh DB
```

If you do have real data you care about, use `pnpm db:reset` instead — it drops/recreates the DB but goes through Prisma's migration history properly. **It's still destructive — your data is gone afterward.**

### Port 3000 or 5173 already in use

Something else is squatting the port (often a leftover `node` from a previous session).

- API port: change `API_PORT` in `apps/api/.env`.
- Web port: change `port: 5173` in [`apps/web/vite.config.ts`](apps/web/vite.config.ts) (also update the `proxy.target` to match the new API port, and `CORS_ORIGINS` in `apps/api/.env`).

### Prisma VS Code extension nags about upgrading to Prisma 7

Click "pin to Prisma 6" on the popup. We're intentionally on the 6.x line — see the project decision recorded next to `prisma` in [`apps/api/package.json`](apps/api/package.json).

### `pnpm install` fails on `EPERM ... query_engine-windows.dll`

Prisma's `postinstall` hook can't replace its query engine while the API dev server has it loaded. Stop the API (Ctrl-C the `pnpm --filter @focus-tracker/api dev` terminal) and re-run `pnpm install`.

### `tauri dev` fails with "cargo not found"

You haven't installed the Rust toolchain. See §1 — `winget install Rustlang.Rustup`, restart your shell, then `rustup default stable`.

---

## 6. Where things live

```
.
├── PROJECT.md                       # The project plan (start here for design context)
├── README.md                        # Quick overview
├── SETUP.md                         # This file
├── package.json                     # Workspace root + pnpm scripts
├── pnpm-workspace.yaml              # Which folders are workspaces
├── tsconfig.base.json               # Strict TS settings every workspace extends
├── docker-compose.yml               # Local Postgres
├── Features Markdown/               # Per-feature specs (Tasks, Dashboard, Auth, ...)
├── Sources Markdown/                # Telemetry source-client specs
├── apps/
│   ├── api/                         # NestJS + Prisma backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma        # Single source of truth for the DB
│   │   │   └── migrations/          # Generated migration history (commit these)
│   │   ├── src/
│   │   │   ├── main.ts              # Bootstrap (Nest setup, /v1 prefix, CORS)
│   │   │   ├── app.module.ts        # Root module wiring
│   │   │   ├── prisma/              # Global PrismaService + module
│   │   │   └── health/              # GET /v1/health
│   │   └── .env.example             # Copy to .env for local dev
│   └── web/                         # React 19 + Vite + Tailwind v4 client
│       ├── src/
│       │   ├── main.tsx             # Entry point (Query client + root)
│       │   ├── App.tsx              # Placeholder UI with live /v1/health pill
│       │   ├── lib/api.ts           # axios instance + API helpers
│       │   └── index.css            # Tailwind v4 inline @theme
│       ├── vite.config.ts           # Vite + plugins + /v1 proxy to API
│       └── .env.example             # Copy to .env.local for local dev
├── apps/
│   └── desktop/                     # Tauri 2 desktop telemetry client
│       ├── src/                     # React settings + pairing UI
│       ├── src-tauri/               # Rust core
│       │   ├── Cargo.toml
│       │   ├── tauri.conf.json
│       │   ├── capabilities/        # Tauri 2 permissions per window
│       │   ├── icons/               # App + tray icons (placeholders)
│       │   └── src/
│       │       ├── main.rs          # Thin binary entry
│       │       ├── lib.rs           # App + tray setup
│       │       ├── commands.rs      # #[tauri::command]s the React side calls
│       │       ├── pairing.rs       # POST /v1/devices/pairing-codes client
│       │       ├── keychain.rs      # OS keychain wrapper for the API key
│       │       ├── config.rs        # config.json on disk
│       │       ├── events.rs        # Wire shapes mirrored from shared/
│       │       └── errors.rs
│       └── package.json
└── packages/
    └── shared/                      # TS types + Zod schemas shared by api + web
        └── src/
            ├── enums.ts             # Mirrors Prisma enums (TaskPriority, etc.)
            ├── telemetry.ts         # Wire-protocol shapes for telemetry events
            ├── api.ts               # ApiError envelope, HealthResponse, ...
            └── index.ts
```

---

## 7. Cleanup / uninstall

To leave no trace on your machine:

```bash
docker compose down -v       # stop + remove container + delete the data volume
docker image rm postgres:17-alpine   # optional — frees ~120 MB
rm -rf node_modules apps/*/node_modules packages/*/node_modules
```

That's it. The repo itself is just files at this point.
