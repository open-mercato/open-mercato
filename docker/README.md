# Docker Setup for Open Mercato

This directory contains Docker configuration for running **local development services** (PostgreSQL with pgvector and Redis) alongside your local Open Mercato installation.

> **Looking to run the full application stack with Docker?**
> - **Prod:** `docker compose -f docker-compose.fullapp.yml up --build`
> - **Dev (mounted source + watch):** `docker compose -f docker-compose.fullapp.dev.yml up --build`
>
> See the [Docker Deployment guide](https://docs.openmercato.com/installation/setup#docker-deployment-full-stack) for full-stack instructions.

This `docker-compose.yml` is ideal when you want to run the database and Redis in containers but develop the application locally with `yarn dev`.

### Full app in dev mode (with watch)

Run the entire stack in Docker with live reload:

```bash
docker compose -f docker-compose.fullapp.dev.yml up --build
```

The app container mounts the repo, runs `yarn dev` (packages watch + Next.js dev server), and does init/migrate + generate on start. Named volumes keep `node_modules` and `.next` in the container.

## Quick Start

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View logs
docker compose logs -f

# Restart services
docker compose restart
```

## Services

- **PostgreSQL 15** with pgvector extension (port 5432)
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
docker compose down -v  # This will DELETE all data
docker compose up -d
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
| Start dev stack (detached) | `yarn docker:dev:up` | `docker-compose.fullapp.dev.yml`; mounted source + hot reload |
| Stop dev stack | `yarn docker:dev:down` | Stops and removes dev containers |
| Start production-like stack (detached) | `yarn docker:up` | `docker-compose.fullapp.yml`; built image, no source mount |
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

> **Tip:** You can override which compose file is targeted by setting `DOCKER_COMPOSE_FILE`:
> ```
> DOCKER_COMPOSE_FILE=docker-compose.fullapp.yml yarn docker:generate
> ```

### Script Compatibility Matrix

| Root script | Native host | Docker dev (`fullapp.dev`) | Docker fullapp | Notes |
|-------------|-------------|---------------------------|----------------|-------|
| `dev` | works | `yarn docker:dev` | — | |
| `dev:greenfield` | works | unsupported-by-design | unsupported-by-design | Not available as a Docker exec command — use `yarn docker:dev:up` instead (entrypoint handles the full init sequence automatically) |
| `dev:ephemeral` | works | `yarn docker:ephemeral` | unsupported-by-design | Uses `docker-compose.preview.yaml`; fresh DB, port 5000 |
| `build:packages` | works | `yarn docker:build:packages` | unsupported-by-design | |
| `generate` | works | `yarn docker:generate` | unsupported-by-design | Monorepo-only; not in runtime image |
| `initialize` | works | `yarn docker:initialize` | unsupported-by-design | Monorepo-only |
| `reinstall` | works | `yarn docker:reinstall` | unsupported-by-design | Monorepo-only |
| `db:migrate` | works | `yarn docker:db:migrate` | works | Available in both Docker profiles |
| `db:generate` | works | `yarn docker:db:generate` | unsupported-by-design | Monorepo-only |
| `lint` | works | `yarn docker:lint` | unsupported-by-design | Dev deps not in production image |
| `typecheck` | works | `yarn docker:typecheck` | unsupported-by-design | Dev deps not in production image |
| `test` | works | `yarn docker:test` | unsupported-by-design | Dev deps not in production image |
| `install-skills` | works (Unix) | `yarn docker:install-skills` | unsupported-by-design | Requires bash + symlinks; use container |
| `clean:generated` | works (Unix) | manual | unsupported-by-design | Bash script; run natively on Unix or in container shell |
| `clean:packages` | works (Unix) | manual | unsupported-by-design | Bash script; run natively on Unix or in container shell |
| `mcp:serve` | works | works-with-wrapper | unsupported-by-design | Use `docker compose exec app yarn mcp:serve` |
| `registry:*` / `release:*` | works (Unix) | unsupported-by-design | unsupported-by-design | CI/release pipeline scripts |

### Troubleshooting

**"No running Open Mercato app container found"**

The helper checks for a running `app` service. Ensure the stack is up:
```
docker compose -f docker-compose.fullapp.dev.yml ps
```

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
DOCKER_COMPOSE_FILE=docker-compose.fullapp.dev.yml yarn docker:generate
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
