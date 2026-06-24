# AGENTS.md

## Project overview

Hilihili Player is a LAN-only self-hosted video site. It scans local/NAS media directories, indexes them by category/creator/video/parts, and serves a web UI with recommendations, playback, and notes.

## Monorepo layout

```
apps/
  web/          Next.js 16 (React 19, Tailwind CSS 4) — frontend
  api/          Fastify — REST API server
  worker/       Background media scanner
packages/
  db/           SQLite + Drizzle ORM (schema + inline migrations)
  media/        Media scanning, thumbnail generation (ffmpeg, sharp)
  recommendation/  Feed/recommendation logic
  shared/       Shared TypeScript types
```

## Essential commands

```bash
corepack pnpm install          # install all deps
corepack pnpm dev              # run web + api + worker in parallel
corepack pnpm dev:safe         # safe demo mode (isolated DB, fake media, port 3100)
corepack pnpm build            # build all packages
corepack pnpm typecheck        # typecheck all packages
corepack pnpm lint             # lint all packages
corepack pnpm db:push          # push Drizzle schema to SQLite
```

Run verification in this order: `lint -> typecheck -> build`.

## Ports

- Web: `http://localhost:3000`
- API: `http://localhost:4141`
- Safe demo: `http://localhost:3100` (API on 4241)

## Environment

Copy `.env.example` to `.env`. Key vars:

- `HILI_DATA_DIR` — SQLite DB location (default `./app-data`)
- `HILI_MEDIA_ROOT` — media root for Docker (mounts to `/media`)
- `HILI_SCAN_INTERVAL_MS` — worker scan interval (default 900000ms)
- `HILI_FFMPEG_PATH` / `HILI_FFPROBE_PATH` — override ffmpeg paths
- `NEXT_PUBLIC_API_BASE_URL` — API URL for the web app

## Architecture notes

- **No test framework** is set up. No test files exist.
- **DB migrations are inline** in `packages/db/src/index.ts` via `ensureColumn()` — not Drizzle Kit migration files. Schema source of truth is `packages/db/src/schema.ts`.
- **API is a single file**: `apps/api/src/index.ts` — all routes defined inline, no router abstraction.
- **Worker entry**: `apps/worker/src/index.ts` — drains scan queue on interval.
- **Web uses App Router** (`apps/web/src/app/`), with components in `apps/web/src/components/` and utilities in `apps/web/src/lib/`.
- **Package exports** use raw TS source (`"./src/index.ts"`) — no build step required for internal consumption. `@hilihili/web` uses `transpilePackages` for `@hilihili/shared`.
- **TypeScript config**: ES2022 target, NodeNext module resolution, strict mode. Base config at `tsconfig.base.json`.
- **ESLint**: `apps/web` uses `eslint-config-next`; other packages use bare `eslint` with `--ext .ts`.
- **No Prettier** configured.
- **IDs** are prefixed strings: `lib_xxx`, `int_xxx`, `comment_xxx`, etc. (see `createId()` in `@hilihili/db`).

## Docker / Deployment

- Single `Dockerfile` builds everything; `docker-compose.yml` runs 3 services (api, worker, web) from the same image.
- CI (`.github/workflows/container.yml`) builds and pushes to GHCR on push to `main`.
- Image name must be lowercase: `ghcr.io/<owner>/hilihili-player:latest`.

## Safe demo mode

`pnpm dev:safe` seeds fake media (color bars + test images) into `.hilihili-safe-demo/`, uses a separate SQLite DB, and restricts file access to the demo library. Useful for UI development without real media.

## Conventions

- All packages are `"type": "module"` (ESM).
- pnpm 10 with corepack — always use `corepack pnpm`, not bare `pnpm`.
- Chinese is used in user-facing strings and README; code/variables are English.
- `_` prefixed directories in media roots are skipped during scan (except `_待归类`).
