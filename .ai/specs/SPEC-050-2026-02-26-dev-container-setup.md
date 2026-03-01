# SPEC-050: Dev Container Setup

## TLDR
**Key Points:**
- Adds a VS Code Dev Container configuration that provides a fully self-contained development environment — Node.js 24, Yarn 4, PostgreSQL 17 (pgvector), Redis 7, Meilisearch v1.11, and Claude Code CLI — with zero local toolchain installation required.
- One-click setup: "Reopen in Container" runs the entire bootstrap chain (install, build, generate, migrate) automatically.

**Scope:**
- Docker Compose multi-service setup (workspace, postgres, redis, meilisearch)
- Custom Dockerfile with build toolchain, Claude Code CLI, and Corepack/Yarn 4
- Lifecycle scripts for one-time init and per-start sync
- Automated `.env` generation with container hostname rewriting
- Named volumes for gitignored directories (node_modules, dist/, .next)
- README documentation and root README section update

**Non-scope:**
- Production Docker deployment (covered separately)
- CI/CD container images
- Codespaces / GitHub-hosted dev environments (future work)

---

## Overview

Open Mercato's monorepo requires PostgreSQL with pgvector, Redis, Meilisearch, Node.js 24, Yarn 4, and multiple build passes before `yarn dev` works. New contributors face a complex multi-step setup that varies by OS. The Dev Container eliminates this by packaging the entire stack into a reproducible Docker Compose environment that VS Code manages automatically.

> **Market Reference**: Studied [Gitpod](https://www.gitpod.io/) and [VS Code Dev Containers](https://containers.dev/). Adopted the Dev Containers spec (devcontainer.json) as it integrates natively with VS Code without requiring a cloud service. Rejected Gitpod/Codespaces for the initial implementation because the project needs to work offline and on self-hosted Docker.

## Problem Statement

1. **High onboarding friction** — Setting up PostgreSQL with pgvector, Redis, Meilisearch, Node.js 24, Yarn 4, and the correct env vars manually takes 30-60 minutes and is error-prone.
2. **Environment drift** — Contributors on macOS, Linux, and Windows end up with subtly different setups (different Postgres versions, missing pgvector, wrong Node.js version), causing "works on my machine" bugs.
3. **Service hostname mismatch** — The `.env.example` uses `localhost` for all services, but a containerized environment needs container hostnames (`postgres`, `redis`, `meilisearch`). Manual editing is tedious and easy to get wrong.
4. **Gitignored directory conflicts** — Docker bind mounts overlay the host filesystem onto the container. Directories like `node_modules/`, `dist/`, and `.next/` are gitignored (empty on host), so a naive bind mount overwrites the container's built artifacts with empty directories.

## Proposed Solution

A `.devcontainer/` directory containing a Docker Compose-based Dev Container configuration with:
- A custom `Dockerfile` for the workspace container (Node.js 24 Alpine + build tools + Claude Code CLI)
- A `docker-compose.yml` defining four services (workspace, postgres, redis, meilisearch) on a private bridge network
- An auto-generated `docker-compose.volumes.yml` with named volumes for every `packages/*/dist` directory (eliminates manual maintenance)
- Lifecycle scripts that automate the full bootstrap chain
- An `.env` generation script that rewrites hostnames for container networking
- Named Docker volumes to isolate gitignored directories from the host bind mount

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Self-contained compose (not reusing root `docker-compose.yml`) | Existing root compose includes services and `container_name` directives that conflict with Dev Containers naming requirements |
| Node 24 Alpine base image | Matches project's Node.js requirement; Alpine minimizes image size |
| Auto-generated named volumes for `dist/` dirs | `generate-compose-volumes.sh` scans `packages/*/` and writes `docker-compose.volumes.yml` at `initializeCommand` time — new packages require zero manual devcontainer changes |
| `init: true` on workspace service | Proper signal forwarding and zombie process reaping for `yarn dev` (turbo + watchers + Next.js + workers) |
| `WATCHPACK_POLLING` + `CHOKIDAR_USEPOLLING` | macOS Docker Desktop bind mounts lack native filesystem events — polling is required for hot reload |
| 12 GB Docker Desktop memory recommendation | Turbopack compilation + 14 package watchers + workers spike to ~8-10 GB during page compilation |
| Always regenerate `.env` on rebuild | New keys from `.env.example` appear automatically; personal overrides live in `.env.local` (Next.js native priority) |
| Claude Code CLI pre-installed globally | Enables AI-assisted development out of the box; ownership adjusted for auto-updates |
| Database query for first-run detection | Queries `information_schema.tables` to determine init vs migrate — no marker volume needed, eliminates stale state issues |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Reuse root `docker-compose.yml` | Contains `container_name` directives and extra services that conflict with Dev Container conventions |
| Gitpod / GitHub Codespaces | Requires cloud service; project needs offline/self-hosted support first |
| Single monolithic container (all services in one image) | Violates container best practices; harder to update individual services; health checks become complex |
| Mount host `node_modules` directly | Performance disaster — 150k+ files over Docker bind mount on macOS causes multi-second file operations |
| Hardcoded `dist/` volume list in docker-compose.yml | Requires manual update when new packages are added; replaced with auto-generated `docker-compose.volumes.yml` |

## User Stories / Use Cases

- **New contributor** wants to **start developing in under 5 minutes** so that **onboarding friction is eliminated**
- **Existing developer** wants to **switch machines without reconfiguring** so that **environment setup is portable and reproducible**
- **AI-assisted developer** wants to **use Claude Code CLI immediately** so that **the AI toolchain is available without extra installation**
- **Maintainer** wants to **ensure all contributors use the same service versions** so that **"works on my machine" bugs are prevented**

## Architecture

### Service Topology

```
┌─────────────────────────────────────────────────┐
│  VS Code (Host)                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  workspace (Node 24 Alpine)               │  │
│  │  - yarn dev / build / test                │  │
│  │  - claude CLI                             │  │
│  │  - Bind mount: host repo → /workspace     │  │
│  │  - Named volumes: node_modules, dist/, …  │  │
│  └──────┬──────────┬──────────┬──────────────┘  │
│         │          │          │                  │
│    ┌────▼───┐ ┌────▼───┐ ┌───▼────────┐        │
│    │postgres│ │ redis  │ │meilisearch │        │
│    │  :5432 │ │  :6379 │ │   :7700    │        │
│    └────────┘ └────────┘ └────────────┘        │
│         (private bridge network)                │
└─────────────────────────────────────────────────┘
```

### Lifecycle Hooks

```
Initialize (runs on host before container start)
  └── initializeCommand → scripts/generate-compose-volumes.sh
       └── Scans packages/*/ and writes docker-compose.volumes.yml

Container Created (first time)
  └── postCreateCommand → scripts/post-create.sh
       ├── [0/7] Fix volume permissions (sudo chown)
       ├── [1/7] Generate .env (setup-env.sh)
       ├── [2/7] yarn install
       ├── [3/7] Install skills (symlinks)
       ├── [4/7] yarn build:packages (first pass)
       ├── [5/7] yarn generate
       ├── [6/7] yarn build:packages (second pass)
       └── [7/7] mercato init (first run) OR db:migrate (subsequent)

Container Started (each start)
  └── postStartCommand → scripts/post-start.sh
       ├── yarn install (sync lockfile changes)
       └── yarn db:migrate (apply pending migrations)
```

### Volume Strategy

| Volume | Mount Point | Purpose |
|--------|------------|---------|
| `node_modules` | `/workspace/node_modules` | Performance — avoids 150k+ files over bind mount |
| `app_next` | `/workspace/apps/mercato/.next` | Next.js build cache |
| `attachments_storage` | `/workspace/apps/mercato/storage` | File attachment storage |
| `pkg_*_dist` (auto-generated) | `/workspace/packages/*/dist` | Package build outputs (gitignored on host); volumes auto-generated by `generate-compose-volumes.sh` |
| `postgres_data` | `/var/lib/postgresql/data` | Database persistence |
| `redis_data` | `/data` | Redis persistence |
| `meilisearch_data` | `/meili_data` | Search index persistence |

### Environment Variable Strategy

```
.env.example ──(setup-env.sh)──→ .env  (auto-generated, overwritten on rebuild)
                                  .env.local  (manual overrides, never overwritten)
```

`setup-env.sh` performs these transformations:
- Rewrites `localhost` → container hostnames (`postgres`, `redis`, `meilisearch`)
- Rewrites `VAULT_ADDR` to `host.docker.internal` for host-accessible Vault
- Uncomments Redis, Meilisearch, and cache configuration lines
- Sets Meilisearch API key to match the compose service config
- Switches cache strategy from `sqlite` to `redis`
- Sets a dev-only JWT secret

Host env vars `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are forwarded into the container via `devcontainer.json` `remoteEnv`.

## Configuration

### VS Code Extensions (auto-installed)

| Extension | Purpose |
|-----------|---------|
| `dbaeumer.vscode-eslint` | ESLint integration |
| `esbenp.prettier-vscode` | Prettier formatting |
| `bradlc.vscode-tailwindcss` | Tailwind CSS IntelliSense |
| `mikestead.dotenv` | .env file syntax highlighting |
| `eamodio.gitlens` | Git history and blame |

### Forwarded Ports

| Port | Service | Auto-forward |
|------|---------|-------------|
| 3000 | App (Next.js) | Notify |
| 5432 | PostgreSQL | Silent |
| 6379 | Redis | Silent |
| 7700 | Meilisearch | Silent |

### Service Versions

| Service | Image | Version |
|---------|-------|---------|
| Node.js | `node:24-alpine` | 24.x |
| PostgreSQL | `pgvector/pgvector:pg17-trixie` | 17 + pgvector |
| Redis | `redis:7-alpine` | 7.x |
| Meilisearch | `getmeili/meilisearch:v1.11` | 1.11 |
| Yarn | (via Corepack) | 4.12.0 |

## Implementation Plan

### Phase 1: Core Dev Container (Single Phase — Complete)

This is a single-phase implementation. All files are already developed.

#### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `.devcontainer/devcontainer.json` | Create | Dev Container metadata — service binding, lifecycle hooks, ports, extensions, env forwarding |
| `.devcontainer/Dockerfile` | Create | Workspace image — Node 24 Alpine, build tools, Claude Code CLI, Corepack/Yarn |
| `.devcontainer/docker-compose.yml` | Create | Four-service stack with static named volumes, health checks, bridge network |
| `.devcontainer/docker-compose.volumes.yml` | Generated | Auto-generated named volumes for every `packages/*/dist` directory (gitignored) |
| `.devcontainer/scripts/generate-compose-volumes.sh` | Create | Scans `packages/*/` and generates `docker-compose.volumes.yml` (runs on host via `initializeCommand`) |
| `.devcontainer/scripts/post-create.sh` | Create | One-time bootstrap — permissions, install, build, generate, db init |
| `.devcontainer/scripts/post-start.sh` | Create | Per-start sync — install, migrate |
| `.devcontainer/scripts/setup-env.sh` | Create | `.env` generation with container hostname rewriting |
| `.devcontainer/README.md` | Create | Detailed documentation — architecture, troubleshooting, maintenance guide |
| `.gitignore` | Modify | Add `.devcontainer/docker-compose.volumes.yml` (generated file) |
| `README.md` | Modify | Add "Dev Container (VS Code)" quick-start section with 12 GB memory prerequisite |

### Maintenance Protocol

When the project evolves, the Dev Container needs corresponding updates:

| Project Change | Dev Container Update |
|----------------|---------------------|
| New package in `packages/` | Nothing — `generate-compose-volumes.sh` detects it automatically on rebuild |
| New system dependency | Add `apk add <pkg>` to `Dockerfile` |
| New infrastructure service | Add service to `docker-compose.yml`, forward port in `devcontainer.json` |
| New keys in `.env.example` | Add `sed` rules to `setup-env.sh` if container-specific values needed |
| Node.js version bump | Update `FROM` in `Dockerfile` and `corepack prepare` version |
| New VS Code extension for all contributors | Add to `devcontainer.json` extensions array |

## Risks & Impact Review

### Operational Risks

- **Docker Desktop memory**: The monorepo's dev server (turbo + 14 watchers + Next.js + workers) requires ~8-10 GB during peak compilation. Contributors with less than 12 GB allocated to Docker Desktop will experience OOM kills.
- **First build time**: Initial `postCreateCommand` takes 3-5 minutes (install + two build passes + generate + db init). Subsequent starts are faster (install + migrate only).

### Data Integrity

- **`.env` regeneration on rebuild**: Intentional — prevents stale env vars. Personal overrides in `.env.local` are preserved since it's not managed by the scripts.
- **Database state detection**: `post-create.sh` queries `information_schema.tables` to determine whether to run `mercato init` (empty DB) or `db:migrate` (existing tables). This is stateless — no marker files or volumes needed.

### Platform Compatibility

- **macOS file watching**: Docker Desktop on macOS doesn't support native filesystem events for bind mounts. `WATCHPACK_POLLING` and `CHOKIDAR_USEPOLLING` enable polling-based file watching as a workaround.
- **Linux native Docker**: Works without Docker Desktop. Memory constraints are less of an issue since there's no VM overhead.
- **Windows**: Requires WSL2 backend for Docker Desktop. Bind mount performance may be slower than macOS/Linux.

### Risk Register

#### Docker Desktop OOM during development
- **Scenario**: Contributor allocates less than 12 GB memory to Docker Desktop; turbo compilation + watchers spike to 8-10 GB and the workspace container is killed
- **Severity**: Medium
- **Affected area**: Development workflow — container crashes require restart
- **Mitigation**: README documents 12 GB minimum requirement; troubleshooting table includes this fix
- **Residual risk**: Some developer machines may have limited total RAM; acceptable since Docker Desktop memory is user-configurable

#### Named volume mismatch after new package added
- **Scenario**: A new package is added to `packages/` but its `dist/` named volume is missing.
- **Severity**: Low (was Medium before automation)
- **Affected area**: Package builds fail or produce empty output inside the container
- **Mitigation**: `generate-compose-volumes.sh` runs via `initializeCommand` on every container start, scanning `packages/*/` and auto-generating `docker-compose.volumes.yml`. New packages are detected automatically.
- **Residual risk**: Minimal — only fails if the script itself is broken or `packages/` structure changes convention

#### Database migration conflict after rebase
- **Scenario**: Developer rebases onto a branch with new DB migrations. Named volumes persist across "Rebuild Container" — the `postgres_data` volume still has tables from the old branch, and the new migration tries to create a table that already exists (e.g., "relation already exists").
- **Severity**: Medium
- **Affected area**: `postCreateCommand` fails at step [7/7] (db:migrate); container setup does not complete
- **Mitigation**: Troubleshooting table documents the `docker compose down -v` command to wipe all volumes and trigger a fresh `mercato init`. Note: VS Code's "Rebuild Container" does NOT wipe named volumes — only `docker compose down -v` does.
- **Residual risk**: Developers must remember to wipe volumes when rebasing across branches with schema changes. Documented in `.devcontainer/README.md` troubleshooting table.

## Final Compliance Report — 2026-02-26

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | N/A | Infrastructure-only change, no ORM entities |
| root AGENTS.md | Filter by organization_id | N/A | No data access code |
| root AGENTS.md | Validate inputs with zod | N/A | No API routes or inputs |
| root AGENTS.md | Use DI (Awilix) for services | N/A | No runtime services added |
| root AGENTS.md | Modules must remain isomorphic | N/A | No module code changed |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | README documentation only; no UI strings |
| root AGENTS.md | Keep code minimal and focused | Compliant | Each script has a single responsibility |
| root AGENTS.md | Confirm project still builds after changes | Compliant | Dev container runs full build as part of setup |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Docker Compose services match forwarded ports in devcontainer.json | Pass | 3000, 5432, 6379, 7700 all match |
| Named volumes cover all gitignored dirs | Pass | Static: node_modules, .next, storage. Auto-generated: all package dist/ dirs via `generate-compose-volumes.sh` |
| setup-env.sh hostname rewrites match docker-compose service names | Pass | postgres, redis, meilisearch all consistent |
| Meilisearch API key in compose matches setup-env.sh | Pass | Both use `meilisearch-dev-key` |
| Dockerfile Yarn version matches project's packageManager | Pass | `yarn@4.12.0` |
| Health checks defined for all infrastructure services | Pass | postgres (pg_isready), redis (redis-cli ping), meilisearch (curl /health) |
| README documents all design decisions and troubleshooting | Pass | Comprehensive tables for both |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved. Infrastructure-only change with no impact on business logic, data models, or API contracts.

## Changelog
### 2026-02-26
- Initial specification (written post-implementation to document existing dev container changes)
- Auto-generated `dist/` volumes: replaced hardcoded 14-entry volume list with `generate-compose-volumes.sh` + `initializeCommand` pattern; new packages require zero manual devcontainer changes
- Added `init: true` for proper PID 1 signal handling
- Added `WATCHPACK_POLLING` + `CHOKIDAR_USEPOLLING` for macOS bind mount file watching
- Added Vault `host.docker.internal` rewrite in `setup-env.sh`
- Documented 12 GB Docker Desktop memory requirement (OOM confirmed during Turbopack compilation)
- Claude Code CLI: added `@latest` tag and `chown` for auto-update support
- Shell scripts: replaced fragile `cd && cmd && cd ../..` with subshells `(cd dir && cmd)`
- Risk register: added "Database migration conflict after rebase" (Medium) — documents that `docker compose down -v` is needed when rebasing across branches with new DB migrations; clarified that VS Code "Rebuild Container" does not wipe named volumes
- setup-env.sh: added verification step for critical hostname rewrites
- post-create.sh: replaced silent error suppression on chown with per-directory warnings
- Switched default terminal from zsh to bash (no zsh config present)
- Replaced `init_marker` volume with `information_schema.tables` query for first-run detection — eliminates stale marker state issues
- Removed stale init marker risk from risk register (no longer applicable)
- Added `attachments_storage` volume to documentation
- Added DATABASE_URL precedence comment in setup-env.sh (compose env var takes priority over .env)
