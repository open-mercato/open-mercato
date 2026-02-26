# Dev Container

One-click development environment for Open Mercato. Open VS Code, "Reopen in Container", and everything works — Node.js 24, Yarn 4, PostgreSQL (pgvector), Redis, Meilisearch, and Claude Code CLI.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with **12 GB+ memory** (Settings → Resources)
- VS Code with the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension

## Quick Start

1. Open the project in VS Code
2. Command Palette → **Dev Containers: Reopen in Container**
3. Wait for setup to complete (~3-5 min on first build)
4. Run `yarn dev` and open http://localhost:3000/backend

Default credentials (dev only — never use in production): `superadmin@acme.com` / `secret`

## Architecture

### Services

| Service | Image | Purpose |
|---------|-------|---------|
| **workspace** | Node 24 Alpine (custom Dockerfile) | Development container — VS Code connects here |
| **postgres** | pgvector/pgvector:pg17-trixie | PostgreSQL 17 with pgvector extension |
| **redis** | redis:7-alpine | Event transport, queue backend, caching |
| **meilisearch** | getmeili/meilisearch:v1.11 | Full-text search engine |

All services communicate over a private bridge network. Service hostnames (`postgres`, `redis`, `meilisearch`) are used in connection strings instead of `localhost`.

### Named Volumes

The workspace uses named volumes for directories that are gitignored (empty on the host). Without these, Docker's bind mount would overwrite container-built artifacts with empty host directories.

| Volume | Mount Point | Why |
|--------|------------|-----|
| `node_modules` | `/workspace/node_modules` | Performance — avoids 150k+ files over bind mount |
| `app_next` | `/workspace/apps/mercato/.next` | Next.js build cache |
| `attachments_storage` | `/workspace/apps/mercato/storage` | File attachment storage |
| `pkg_*_dist` (auto) | `/workspace/packages/*/dist` | Package build outputs (gitignored) |

Package `dist/` volumes are **auto-generated** by `scripts/generate-compose-volumes.sh`, which runs on the host via `initializeCommand` before the container starts. It scans `packages/*/` and writes `docker-compose.volumes.yml`. Adding a new package to the monorepo requires no manual devcontainer changes — the volume is created automatically on next rebuild.

### Lifecycle Hooks

**`initializeCommand`** — runs on the host before the container starts:

1. Scans `packages/*/` and generates `docker-compose.volumes.yml` with a named volume per package `dist/` directory

**`postCreateCommand`** — runs once when the container is first created:

1. Generates `.env` from `.env.example` (rewrites hostnames for container networking)
2. `yarn install`
3. Symlinks Claude Code / Codex skills
4. `yarn build:packages` → `yarn generate` → `yarn build:packages`
5. `yarn mercato init` (first run) or `yarn db:migrate` (subsequent)

**`postStartCommand`** — runs on each container start:

1. `yarn install` (syncs lockfile changes)
2. `yarn db:migrate` (applies pending migrations)

## Environment Variables

### .env Strategy

```
.env.example ──(setup-env.sh)──→ .env  (auto-generated, overwritten on rebuild)
                                  .env.local  (manual overrides, never overwritten)
```

`setup-env.sh` always regenerates `apps/mercato/.env` from `.env.example`, rewriting `localhost` references to container hostnames. **Do not edit `.env` directly** — your changes will be lost on rebuild. Use `apps/mercato/.env.local` for personal overrides (Next.js native priority).

### Host → Container Forwarding

`ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are forwarded from your host shell via `devcontainer.json` `remoteEnv`. Set them in your host `~/.zshrc` or `~/.bashrc` before opening the container.

Alternatively, run `claude` inside the container and use the OAuth login flow (works with Max plan subscriptions).

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Self-contained compose (not reusing `docker-compose.yml`) | Existing file includes unneeded services, uses `container_name` directives that conflict with Dev Containers |
| `init: true` on workspace | Proper signal forwarding and zombie process reaping for the complex process tree (`yarn dev` spawns turbo + watchers + Next.js + workers) |
| `WATCHPACK_POLLING` + `CHOKIDAR_USEPOLLING` | macOS Docker bind mounts don't support native filesystem events — polling is required |
| 12 GB Docker Desktop memory | Turbopack compilation + 14 package watchers + workers spike to ~8-10 GB during page compilation |
| Always regenerate `.env` | New keys from `.env.example` appear automatically on rebuild; personal overrides live in `.env.local` |

## Common Tasks

| Task | Command |
|------|---------|
| Start dev server | `yarn dev` |
| Full re-initialization | `bash .devcontainer/scripts/post-create.sh` |
| Regenerate `.env` only | `bash .devcontainer/scripts/setup-env.sh` |
| Connect to Postgres | `PGPASSWORD=postgres psql -h postgres -U postgres -d open-mercato` |
| Check Meilisearch | `curl http://meilisearch:7700/health` |
| Fresh start (wipe volumes) | Command Palette → **Dev Containers: Rebuild Container** |

## Updating the Dev Container

When the project evolves, the Dev Container setup may need updates. Here's when and how:

| Change | What to Update | User Action |
|--------|---------------|-------------|
| New system dependency (e.g., `jq`, `imagemagick`) | Add `apk add <pkg>` to `Dockerfile` | Rebuild Container |
| New infrastructure service (e.g., Elasticsearch) | Add service to `docker-compose.yml`, forward port in `devcontainer.json` | Rebuild Container |
| New package added to monorepo | Nothing — `generate-compose-volumes.sh` detects it automatically | Rebuild Container |
| New keys in `.env.example` | If they need container-specific values, add `sed` rules to `scripts/setup-env.sh` | Rebuild Container or run `bash .devcontainer/scripts/setup-env.sh` |
| New VS Code extension for all contributors | Add extension ID to `devcontainer.json` `customizations.vscode.extensions` | Rebuild Container |
| Node.js major version bump | Update `FROM node:<version>-alpine` in `Dockerfile` and `corepack prepare yarn@<version>` | Rebuild Container |
| New lifecycle step (e.g., a new init command) | Add to `scripts/post-create.sh` (runs once) or `scripts/post-start.sh` (runs each start) | Rebuild Container for post-create changes; restart for post-start changes |

### File Responsibilities

| File | Owns |
|------|------|
| `Dockerfile` | Base image, system packages, global npm tools, Yarn version |
| `docker-compose.yml` | Service definitions, static named volumes, environment variables, health checks, networking |
| `docker-compose.volumes.yml` | Auto-generated — named volumes for every `packages/*/dist` directory (gitignored) |
| `devcontainer.json` | VS Code integration — lifecycle commands, port forwarding, extensions, env forwarding |
| `scripts/generate-compose-volumes.sh` | Scans `packages/*/` and generates `docker-compose.volumes.yml` |
| `scripts/setup-env.sh` | `.env` generation — hostname rewrites, uncommented services, container-specific defaults |
| `scripts/post-create.sh` | One-time init chain — volume permissions, install, build, generate, database init |
| `scripts/post-start.sh` | Per-start sync — dependency install, database migrations |

## Troubleshooting

**Important**: VS Code "Rebuild Container" rebuilds the image but **does not wipe named volumes**. To wipe volumes, use the commands below from your host terminal. VS Code prefixes volumes with the project name (e.g., `open-mercato_devcontainer_postgres_data`), so `docker compose down -v` from the host may not target the right volumes. Use `docker volume` commands directly.

| Symptom | Cause | Fix |
|---------|-------|-----|
| OOM / app dies during page compilation | Docker Desktop memory too low | Set to 12 GB+ in Docker Desktop → Settings → Resources |
| `EACCES` on `yarn install` | Named volume owned by root | Handled by `post-create.sh` (`sudo chown`); if persists, rebuild container |
| Postgres password rejected | Stale `postgres_data` volume | Wipe DB: `docker volume rm open-mercato_devcontainer_postgres_data` then reopen |
| `.env` changes lost after rebuild | Edited `.env` instead of `.env.local` | Use `apps/mercato/.env.local` for overrides |
| New system tool needed | Not in Dockerfile | Edit `Dockerfile`, then Command Palette → **Rebuild Container** |
| Migration fails after rebase ("relation already exists") | Database has tables from old branch; new migrations conflict | Wipe DB: `docker volume rm open-mercato_devcontainer_postgres_data` then reopen. Only needed when rebasing across branches with new DB migrations. |
| Stale build artifacts | Named volumes persisted old `dist/` | Wipe all: `docker volume ls -q \| grep open-mercato_devcontainer \| xargs docker volume rm` then reopen |
