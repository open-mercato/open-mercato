# Docker Setup for Open Mercato

This directory contains Docker configuration for running **local development services** (PostgreSQL with pgvector and Redis) alongside your local Open Mercato installation.

> **Note:** The compose files now live in [`starters/docker/`](../starters/docker/) — this directory keeps the Dockerfiles, entrypoints, and supporting assets they reference.

> **Looking to run the full application stack with Docker?**
> - **Prod:** `docker compose --project-directory . -f starters/docker/compose.fullapp.yml up --build`
> - **Dev (mounted source + watch):** `docker compose --project-directory . -f starters/docker/compose.fullapp.dev.yml up --build`
>
> See the [Docker Deployment guide](https://docs.openmercato.com/installation/setup#docker-deployment-full-stack) for full-stack instructions.

The infra compose file (`starters/docker/compose.infra.yml`, wrapped by `yarn infra:up` / `yarn infra:down`) is ideal when you want to run the database and Redis in containers but develop the application locally with `yarn dev`.

### Full app in dev mode (with watch)

Run the entire stack in Docker with live reload:

```bash
docker compose --project-directory . -f starters/docker/compose.fullapp.dev.yml up --build
```

The app container mounts the repo, runs `yarn dev` (packages watch + Next.js dev server), and does init/migrate + generate on start. Named volumes keep `node_modules` and `.next` in the container.

### AI assistant services in the fullapp stacks (mcp + opencode)

Both fullapp compose files run the complete agentic stack as three wired services:

| Service | Port (host) | Role |
|---------|-------------|------|
| `app` | 3000 (+ splash 4000 in dev) | Next.js app; talks to OpenCode via `OPENCODE_URL=http://opencode:4096` |
| `mcp` | 3001 (dev only; internal in prod) | MCP Streamable HTTP server (`mcp:serve-http`); reaches the app via `APP_URL=http://app:3000` |
| `opencode` | 4096 (dev only; internal in prod) | OpenCode agent; reaches MCP via `OPENCODE_MCP_URL=http://mcp:3001/mcp` |

The `mcp` service reuses the app image and (in dev) the app's named volumes — it never runs `yarn install` or builds. Its entrypoint (`docker/scripts/mcp-entrypoint.sh`) waits until the app answers HTTP, then provisions the MCP API key idempotently via `yarn mercato ai_assistant mcp:ensure-api-key` into the shared `mcp_shared` volume; the OpenCode entrypoint waits for MCP `/health` and reads the key file. **Leave `MCP_SERVER_API_KEY` unset in `.env` for these stacks** — a set env value overrides the auto-provisioned file and breaks OpenCode → MCP auth unless it is itself a valid `omk_` key.

Wiring smoke test from the host (dev stack):

```bash
curl http://localhost:3001/health          # {"status":"ok","tools":N}
curl http://localhost:4096/global/health   # {"healthy":true,...}
curl http://localhost:4096/mcp             # {"open-mercato":{"status":"connected"}}
```

Two operational notes: OpenCode reads the key **once at startup** — after a DB reset, `mcp:ensure-api-key --rotate`, or anything else that rotates the key, run `docker compose --project-directory . -f starters/docker/compose.fullapp.dev.yml restart opencode` (swap in the fullapp file for the prod stack). And after restarting only the `app` container (which re-runs install/build in the shared volumes), restart `mcp` too once the app is back up.

## Quick Start

```bash
# Start all services
yarn infra:up

# Stop all services
yarn infra:down

# View logs
docker compose --project-directory . -f starters/docker/compose.infra.yml logs -f

# Restart services
docker compose --project-directory . -f starters/docker/compose.infra.yml restart
```

## Services

- **PostgreSQL 17** with pgvector extension (port 5432)
- **Redis 7** for caching and event persistence (port 6379)

## Database Initialization

The `postgres-init.sh` script automatically:
1. Creates the vector extension in the default database (`open_mercato`)
2. Creates the vector extension in `template1` so all future databases inherit it automatically

This means:
- ✅ The `open_mercato` database has pgvector enabled
- ✅ Any new database you create will automatically have pgvector enabled
- ✅ No manual intervention needed after container restart

If you're using an existing database volume (from before this setup), you may need to manually enable the extension:

```bash
docker exec mercato-postgres psql -U postgres -d open_mercato -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Data Persistence

Data is stored in named Docker volumes:
- `mercato-postgres-data` - PostgreSQL data
- `mercato-redis-data` - Redis data

To completely reset and start fresh:

```bash
docker compose --project-directory . -f starters/docker/compose.infra.yml down -v  # This will DELETE all data
yarn infra:up
yarn mercato init
```

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

## Windows + Docker Developer Command Cookbook

Windows users who develop through Docker can run any monorepo command using the `docker:*` wrapper scripts. These scripts detect the active container automatically and execute the command inside it — no WSL required.

### Prerequisites

1. Start the dev stack (detached):
   ```
   yarn docker:dev:up
   ```
2. Keep it running. All `docker:*` exec commands route into the running container.
3. When done: `yarn docker:dev:down`

> **Note:** There is no `docker:dev:greenfield` command. The native `yarn dev:greenfield` runs build → generate → initialize → dev as a startup sequence. In Docker, `yarn docker:dev:up` already does all of this automatically via the container entrypoint (`docker/scripts/dev-entrypoint.sh`). There is nothing extra to run.

### Command Reference

#### Compose lifecycle (start / stop stacks)

| Goal | Command | Notes |
|------|---------|-------|
| Start dev stack (detached) | `yarn docker:dev:up` | `starters/docker/compose.fullapp.dev.yml`; mounted source + hot reload |
| Stop dev stack | `yarn docker:dev:down` | Stops and removes dev containers |
| Start production-like stack (detached) | `yarn docker:up` | `starters/docker/compose.fullapp.yml`; built image, no source mount |
| Stop production-like stack | `yarn docker:down` | Stops and removes production containers |
| Start ephemeral environment | `yarn docker:ephemeral` | Fresh DB on every restart; port 5000 |
| Stop ephemeral environment | `yarn docker:ephemeral:down` | Tears down preview stack (all data lost) |

#### Exec commands (1:1 mirrors of native scripts, require stack running)

| Native command | Docker equivalent | Notes |
|---------------|------------------|-------|
| `yarn dev` | `yarn docker:dev` | Dev profile: restarts existing `app` service and tails main process logs (prevents duplicate port-3000 servers). Use `yarn docker:dev --skip-rebuilt` to skip install/build/generate for that restart only. |
| `yarn build:packages` | `yarn docker:build:packages` | Builds all packages inside container |
| `yarn generate` | `yarn docker:generate` | Dev profile only; fullapp fails fast because monorepo tooling is unsupported there |
| `yarn initialize` | `yarn docker:initialize` | Dev profile only; fullapp fails fast because monorepo tooling is unsupported there |
| `yarn reinstall` | `yarn docker:reinstall` | Dev profile only; fullapp fails fast because monorepo tooling is unsupported there |
| `yarn db:migrate` | `yarn docker:db:migrate` | Applies database migrations |
| `yarn db:generate` | `yarn docker:db:generate` | Dev profile only; fullapp fails fast because monorepo tooling is unsupported there |
| `yarn lint` | `yarn docker:lint` | Dev profile only; fullapp fails fast because monorepo tooling is unsupported there |
| `yarn typecheck` | `yarn docker:typecheck` | Dev profile only; fullapp fails fast because monorepo tooling is unsupported there |
| `yarn test` | `yarn docker:test` | Dev profile only; fullapp fails fast because monorepo tooling is unsupported there |
| `yarn install-skills` | `yarn docker:install-skills` | Dev profile only; fullapp fails fast because monorepo tooling is unsupported there |
| `yarn mercato <cmd>` | `yarn docker:mercato <cmd>` | Full CLI passthrough — all subcommands forwarded into container |

**CLI passthrough examples:**
```
yarn docker:mercato init
yarn docker:mercato eject currencies
yarn docker:mercato test:integration
```

> **Tip — custom compose file**: If you run a personalised stack (e.g. `starters/docker/compose.fullapp.dev.local.yml`),
> the `docker:*` commands discover it automatically **without any extra configuration**, as long as the file name
> matches `compose.*dev*.local.yml` and lives in `starters/docker/` (legacy root `docker-compose.*dev*.local.yml`
> files are still discovered). Add it to `.gitignore` to keep it local.
>
> You can also force a specific compose file at any time with `DOCKER_COMPOSE_FILE`:
> ```
> DOCKER_COMPOSE_FILE=starters/docker/compose.fullapp.dev.local.yml yarn docker:typecheck
> ```

### Script Compatibility Matrix

| Root script | Native host | Docker dev (`fullapp.dev`) | Docker fullapp | Notes |
|-------------|-------------|---------------------------|----------------|-------|
| `dev` | works | `yarn docker:dev` | — | |
| `dev:greenfield` | works | unsupported-by-design | unsupported-by-design | Not available as a Docker exec command — use `yarn docker:dev:up` instead (entrypoint handles the full init sequence automatically) |
| `dev:ephemeral` | works | `yarn docker:ephemeral` | unsupported-by-design | Uses `starters/docker/compose.preview.yml`; fresh DB, port 5000 |
| `build:packages` | works | `yarn docker:build:packages` | unsupported-by-design | |
| `generate` | works | `yarn docker:generate` | unsupported-by-design | Monorepo-only; not in runtime image |
| `initialize` | works | `yarn docker:initialize` | unsupported-by-design | Monorepo-only |
| `reinstall` | works | `yarn docker:reinstall` | unsupported-by-design | Monorepo-only |
| `db:migrate` | works | `yarn docker:db:migrate` | works | Available in both Docker profiles |
| `db:generate` | works | `yarn docker:db:generate` | unsupported-by-design | Monorepo-only |
| `lint` | works | `yarn docker:lint` | unsupported-by-design | Dev deps not in production image |
| `typecheck` | works | `yarn docker:typecheck` | unsupported-by-design | Dev deps not in production image |
| `test` | works | `yarn docker:test` | unsupported-by-design | Dev deps not in production image |
| `install-skills` | works (Unix) | `yarn docker:install-skills` | unsupported-by-design | Requires bash + symlinks; external skills need network (`npx skills add`, skip with `--no-external`); use container |
| `clean:generated` | works (Unix) | manual | unsupported-by-design | Bash script; run natively on Unix or in container shell |
| `clean:packages` | works (Unix) | manual | unsupported-by-design | Bash script; run natively on Unix or in container shell |
| `mcp:serve` | works | dedicated `mcp` service | dedicated `mcp` service | The fullapp stacks run the MCP server as their own container (port 3001 in dev); no manual start needed |
| `registry:*` / `release:*` | works (Unix) | unsupported-by-design | unsupported-by-design | CI/release pipeline scripts |

### Troubleshooting

**"No running Open Mercato app container found"**

The helper checks for a running `app` service. Ensure the stack is up:
```
docker compose --project-directory . -f starters/docker/compose.fullapp.dev.yml ps
```

If you started the stack with a **custom compose file**, either name it `starters/docker/compose.*dev*.local.yml`
(auto-discovered, as are legacy root `docker-compose.*dev*.local.yml` files) or set `DOCKER_COMPOSE_FILE` before the command:
```
DOCKER_COMPOSE_FILE=starters/docker/compose.fullapp.dev.local.yml yarn docker:typecheck
```

**Compose file fails to parse / probe warning**

If you see `[docker-exec] Warning: skipping "…" — compose probe failed`, the compose file has a
configuration or interpolation error. Fix the file, or point directly to a working one via `DOCKER_COMPOSE_FILE`.

**Command times out or hangs**

Some commands (e.g. `db:generate`) write files back to the repo via mounted volumes. This is expected — wait for completion.

**`docker:dev` fails with `EADDRINUSE: 3000`**

This happens when a second `yarn dev` process is started inside the same container. Use `yarn docker:dev` (reload+tail wrapper) or `yarn docker:dev:up` instead of manually running `yarn dev` via `docker compose exec`.

**`docker:dev` runs install/build/generate but you want a quick restart**

Use:
```
yarn docker:dev --skip-rebuilt
```
This skips install/build/generate on the next container restart only, then returns to normal behavior.

**Force a specific compose file**

```
DOCKER_COMPOSE_FILE=starters/docker/compose.fullapp.dev.yml yarn docker:generate
```

---

## Troubleshooting

**Check if vector extension is installed:**
```bash
docker exec mercato-postgres psql -U postgres -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

**Access PostgreSQL directly:**
```bash
docker exec -it mercato-postgres psql -U postgres
```

**Access Redis CLI:**
```bash
docker exec -it mercato-redis redis-cli
```

**Image builds fail with TLS/certificate errors (corporate proxy):**
Your network intercepts HTTPS with a corporate root CA that containers do not
trust. Drop the CA as a PEM file into `docker/certs/` — both the app and
opencode image builds pick it up. See `docker/certs/README.md`; the Windows
launcher (`starters/docker/windows/start-windows.bat`) detects and repairs this
automatically.
