# Hybrid starter (default)

The app and the MCP server run **natively on your machine** via `yarn dev`; OpenCode and the backing services (postgres, redis, meilisearch) run in containers from [`../docker/compose.infra.yml`](../docker/compose.infra.yml).

```
host:  yarn dev ──▶ app :3000 + queue workers + scheduler + MCP server :3001
                                      ▲ x-api-key from .mercato/mcp-shared/mcp-api-key
containers:
       opencode :4096 ── http://host.docker.internal:3001/mcp ──▶ host MCP
       postgres :5432, redis :6379, meilisearch :7700
```

## Install

- **Linux/macOS**: `./install.sh` (or curl it standalone — see [`../README.md`](../README.md)). Installs Node 24 (Homebrew on macOS, checksummed nodejs.org tarball into `~/.local/share/open-mercato/node` on Linux — no sudo) and corepack yarn; detects Docker and prints install instructions if missing (exit 2).
- **Windows**: double-click `install.bat` (or run `install.ps1`). Installs Git/Node 24/yarn via winget (`windows-toolchain.ps1`) and offers `winget install Docker.DockerDesktop`. On locked-down corporate machines use the enterprise launcher instead: `..\docker\windows\start-windows.bat`.

Both hand off to `node starters/lib/install.mjs`: `yarn install` → `build:packages` → `generate` → `.env` secrets (fill-missing-only, never rotated on re-run) → LLM provider prompt → infra containers up → `db:migrate` + `initialize`. Re-running the installer is always safe.

Flags: `--skip-db`, `--skip-llm-prompt`, `--non-interactive`, `--no-start` (PowerShell: `-SkipDb`, `-SkipLlmPrompt`, `-NonInteractive`, `-NoStart`).

## Run

```bash
yarn infra:up   # or start.sh / start.bat (does both infra up + yarn dev)
yarn dev
```

`yarn dev` also starts the MCP server (port `MCP_PORT`, default 3001), provisions its API key into `.mercato/mcp-shared/mcp-api-key`, and restarts it with backoff if it crashes. Opt out with `yarn dev --no-mcp` or `OM_DEV_WITH_MCP=0`; `yarn dev:app` never starts it.

## How OpenCode reaches the host MCP

The opencode container calls `http://host.docker.internal:3001/mcp`:

- **Docker Desktop (Windows/macOS)** resolves `host.docker.internal` natively.
- **Native Linux** relies on the `extra_hosts: host.docker.internal:host-gateway` mapping (already in `compose.infra.yml`). If a host firewall blocks the docker bridge, allow it: `sudo ufw allow from 172.16.0.0/12 to any port 3001 proto tcp`.
- **Windows Firewall** prompts on the first MCP listen — click *Allow access* (Private networks). Override the URL entirely with `OPENCODE_MCP_URL` in the root `.env`.

The container authenticates with the API key `yarn dev` provisioned; it reads the key file after the MCP `/health` endpoint responds. If the key rotates (e.g. after a DB reset), restart the container: `docker compose --project-directory . -f starters/docker/compose.infra.yml restart opencode`.

## Troubleshooting

- **Key file permission errors on Linux** (`EACCES` writing `.mercato/mcp-shared`): Docker created the directory as root before the starter did — `sudo chown -R "$(id -u)" .mercato/mcp-shared`.
- **OpenCode 401s against MCP**: the container started before the key existed or holds a rotated key — restart the opencode container (command above).
- **`yarn generate` added agents/skills but OpenCode doesn't see them**: restart the opencode container (bind-mounted, loaded on new sessions only).
