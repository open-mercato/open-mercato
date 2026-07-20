# Hybrid Dev Runtime + `starters/` Consolidation

> **Superseded (2026-07-19)** for the script surface: the `starters/hybrid/` and
> `starters/docker/windows/` entry scripts described below were replaced by the
> `@open-mercato/starter` package (`packages/starter/`, `yarn om`,
> `npx @open-mercato/starter`). The hybrid runtime topology and compose layout
> remain accurate. See `.ai/specs/2026-07-19-unified-starter-package.md`.

- **Date**: 2026-07-17
- **Status**: Implemented
- **Scope**: OSS — dev environment, no runtime product behavior changes
- **Related**: `.ai/specs/2026-07-07-windows-one-command-agentic-dev-environment.md` (the fully containerized Windows launcher this spec repositions as the enterprise path), `.ai/specs/implemented/SPEC-054-2026-03-04-docker-windows-parity.md`

## Problem

The default dev experience ran **everything** in containers (`docker-compose.fullapp.dev.yml`): app, MCP server, OpenCode, and backing services. That is right for locked-down enterprise machines but wrong for day-to-day development — slow iteration, no native debugging, and a heavyweight stack for a small change. Meanwhile the startup surface had sprawled across six roots (`scripts/windows/`, six root compose files, `scripts/`, `docker/`, `.devcontainer/`, and the create-app template), with a stray `scripts/setup-windows-dev.ps1` separated from its siblings and no install story at all for Linux/macOS.

## Solution

### 1. Hybrid mode is the new default dev experience

App + MCP server run natively on the developer's machine; OpenCode + postgres/redis/meilisearch run in containers (`starters/docker/compose.infra.yml`, evolved from the old root `docker-compose.yml`):

```
host:  yarn dev ──▶ app :3000 + queue workers + scheduler + MCP server :3001
                                      ▲ x-api-key from .mercato/mcp-shared/mcp-api-key
containers:
       opencode :4096 ── http://host.docker.internal:3001/mcp ──▶ host MCP
       postgres :5432, redis :6379, meilisearch :7700  (published ports)
```

- **MCP as a dev.mjs child** (`scripts/dev-mcp.mjs` + wiring in `scripts/dev.mjs`): `yarn dev` provisions the MCP API key via the existing `mercato ai_assistant mcp:ensure-api-key --file` CLI (retrying with backoff until the DB is initialized — never fatal), spawns `mcp:serve-http --port ${MCP_PORT:-3001}`, health-polls it, restarts it with exponential backoff on crash (gives up after 5 fast crashes without killing dev), and injects `MCP_SERVER_API_KEY_FILE`/`MCP_URL` into the app child env. Control: default on; `--no-mcp` / `OM_DEV_WITH_MCP=0` disable; `--with-mcp` forces; `yarn dev:app` never starts it.
- **Key handoff**: host path `.mercato/mcp-shared/mcp-api-key` (gitignored) is bind-mounted read-only into the opencode container at `/run/mcp-shared` (`${OM_MCP_SHARED_DIR:-./.mercato/mcp-shared}`). The opencode entrypoint's existing wait-for-`/health`-then-read-file loop needed no changes. `MCP_SERVER_API_KEY` (env) remains a manual override that wins.
- **Host networking**: `host.docker.internal` resolves natively on Docker Desktop (Win/mac); native Linux uses the `extra_hosts: host-gateway` mapping already on the opencode service. `OPENCODE_MCP_URL` stays the escape hatch. `runMcpHttpServer` already listens on all interfaces. Known caveats (documented in `starters/hybrid/README.md`): host firewalls (ufw rule for `172.16.0.0/12`; Windows Defender first-listen prompt) and root-owned bind-mount dirs on Linux (mitigated by pre-creating the directory in dev.mjs and `yarn infra:up`, plus an EACCES hint).
- **Monorepo auto-migrate**: `yarn dev` (standard + classic monorepo flows) now runs `yarn db:migrate` best-effort at startup, gated by the existing `OM_DEV_AUTO_MIGRATE` (default on); failure warns and continues so `yarn dev` still works with the database down.
- **compose.infra.yml deltas** vs the old root `docker-compose.yml`: full 12-provider env passthrough (parity with the fullapp stack and the provider configurator), the key-file mechanism above, and verdaccio moved behind `profiles: [registry]`.

### 2. `starters/` directory (grouped by mode, not platform)

```
starters/
├── README.md            # decision guide
├── lib/                 # shared zero-dep Node logic (install/start/stop/infra pipelines,
│                        #   env-setup port of Initialize-EnvFiles, 12-provider prompt, compose helpers)
├── hybrid/              # DEFAULT: install.sh|ps1|bat, start/stop wrappers, windows-toolchain.ps1
│                        #   (moved from scripts/setup-windows-dev.ps1)
└── docker/              # ENTERPRISE: compose.{infra,fullapp.dev,fullapp,fullapp.traefik,
                         #   fullapp.traefik.dev,preview}.yml + windows/ (the hardened launcher,
                         #   moved from scripts/windows/)
```

Stays put: root `Dockerfile`, `docker/` (Dockerfiles/entrypoints), `.devcontainer/`, `scripts/dev*.mjs`, `scripts/docker-exec.mjs`, and the entire create-app template (generated apps keep compose files at their own root).

**Invocation contract**: every compose command passes `--project-directory <repo root>`. Compose resolves `.env` interpolation, relative build contexts/bind mounts, and the project name from the project directory (default: the first `-f` file's directory), so without the flag a moved compose file would silently read the wrong `.env` and change project identity. Compose file *contents* needed no path rewrites because of this. All wrappers (`yarn docker:*`, `yarn infra:*`, `scripts/docker-exec.mjs`, `start-dev.ps1`, starters scripts) pass it programmatically; docs teach the one canonical command.

### 3. OpenCode-style installers

`starters/hybrid/install.sh` (curl-able) and `install.ps1`/`install.bat` (irm-able / double-click) bootstrap git + Node 24 (macOS brew or checksummed nodejs.org tarball into `~/.local/share/open-mercato/node`; Windows winget via `windows-toolchain.ps1`) + corepack yarn (pinned from `packageManager`), detect Docker (never install it on Linux/macOS — print instructions, exit 2; offer winget Docker Desktop on Windows), then hand off to the shared `starters/lib/install.mjs`: `yarn install` → `build:packages` → `generate` → `.env` secrets (fill-missing-only port of the launcher's `Initialize-EnvFiles`, guarded by existing-volume detection) → 12-provider LLM prompt (port of `$script:LlmProviders`; kept in sync by hand with the Node-less PowerShell copy) → `yarn infra:up` (compose `--wait` on healthchecks) → `db:migrate` + `initialize` → optional handoff to `start.mjs`. Re-running is always safe. Locked-down corporate Windows machines are routed to the enterprise launcher.

## Migration & Backward Compatibility

Contract surfaces per `BACKWARD_COMPATIBILITY.md`: no CLI module commands, exported types, env var names, event IDs, or generated-file contracts changed. All new env vars are additive (`OM_DEV_WITH_MCP`, `OM_MCP_SHARED_DIR`). Compose service/volume/network/container names are preserved, so existing data volumes reattach. `yarn docker:*` script names are stable (internals updated). `DOCKER_COMPOSE_FILE` keeps its name; values should now point at `starters/docker/...` (old values fail loudly with a hint, and repo-root-relative values are also resolved). Legacy root `docker-compose.*dev*.local.yml` personal overrides remain auto-discovered alongside the new `starters/docker/compose.*dev*.local.yml` convention.

Breaking (documented in `UPGRADE_NOTES.md`, intentionally no old-path shims):

1. **Compose file paths/names changed** — any script/muscle-memory `docker compose -f docker-compose.fullapp.dev.yml ...` or bare `docker compose up` at the repo root fails; use `yarn infra:up` / `yarn docker:dev:up` or the canonical `--project-directory` command.
2. **Windows launcher paths changed** — `scripts\windows\start-windows.bat` → `starters\docker\windows\start-windows.bat`; stale `.bat` copies in old clones self-download from a raw URL that 404s after the old path leaves `main` (the download failure is loud and prints the URL).
3. **`scripts/setup-windows-dev.ps1`** → `starters/hybrid/windows-toolchain.ps1`.
4. **verdaccio** needs `--profile registry` now.
5. **Behavior**: monorepo `yarn dev` auto-migrates by default (opt out `OM_DEV_AUTO_MIGRATE=0`) and starts the MCP server (opt out `--no-mcp` / `OM_DEV_WITH_MCP=0`).
6. **Containers created from the old layout**: run `docker compose down` from the old checkout (or `docker rm` the `mercato-*` containers) before `up` from the new paths — the named volumes persist, no data loss.
7. **External**: the Dokploy QA deployment config references `docker-compose.preview.yaml` and must be updated to `starters/docker/compose.preview.yml` alongside the merge (the one reference the repo cannot fix itself).

Follow-ups (out of scope here): mirror `starters/` into `packages/create-app/template/` (tracked via the Template Sync Checklist), optional `--host` hardening flag for `mcp:serve-http`, keycloak `profiles: [sso]` in compose.infra.yml, an env-sync helper for the `OM_AI_*` duplication between root `.env` (container) and `apps/mercato/.env` (host AI runtime).

## Integration coverage

- `scripts/__tests__/dev-mcp.test.mjs` — flag/env parsing, port/key-path resolution, backoff policy, output classifiers (node:test, `yarn test:scripts`).
- Existing compose-path guards updated: `gitattributes-lf-enforcement`, `prod-compose-node-options`, `fullapp-compose-app-allowed-origins`.
- Manual QA paths: hybrid install loop on a fresh clone (`install.sh` / `install.bat`); `yarn infra:up` + `yarn dev` → MCP `/health`, OpenCode `/mcp` shows `open-mercato: connected`, Cmd+K chat round-trips; fullapp regression `yarn docker:dev:up`; Windows enterprise launcher end-to-end incl. standalone self-download from the new raw URL; `.ai/qa/scenarios/TC-DOCKER-001..008` updated to the new commands.
