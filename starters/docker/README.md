# Docker starter (enterprise / fully containerized)

Compose files for every containerized way to run Open Mercato, plus the hardened Windows launcher under [`windows/`](windows/).

> **Invocation rule — always anchor the project directory at the repo root:**
>
> ```bash
> docker compose --project-directory . -f starters/docker/compose.<x>.yml <command>
> ```
>
> `--project-directory .` keeps `.env` interpolation, relative build contexts/bind mounts, and the compose project name identical to when these files lived at the repo root. A bare `-f starters/docker/...` would silently read `starters/docker/.env` (which doesn't exist) and fall back to insecure defaults. The `yarn docker:*` / `yarn infra:*` scripts pass it for you.

## Compose file matrix

| File | Stack | Used by |
|------|-------|---------|
| `compose.infra.yml` | OpenCode + postgres/redis/meilisearch (published ports); app + MCP run on the **host** | The default [hybrid starter](../hybrid/), `yarn infra:up` |
| `compose.fullapp.dev.yml` | Everything containerized, app in watch mode (dev bind mounts, keycloak, file-watch limits) | `yarn docker:dev:up`, the Windows launcher |
| `compose.fullapp.yml` | Everything containerized, production build | `yarn docker:up` |
| `compose.fullapp.traefik.yml` | Traefik overlay (ports 80/443, ACME) — layer with `-f` on top of a fullapp file | Self-hosted deployments |
| `compose.fullapp.traefik.dev.yml` | Flips Traefik ACME to Let's Encrypt staging — third `-f` layer | Deployment testing |
| `compose.preview.yml` | Ephemeral preview runner (testcontainers) | `yarn docker:ephemeral`, QA deployments |

Optional profiles on `compose.infra.yml`: `--profile storage-s3` (localstack), `--profile registry` (verdaccio for standalone-app/package workflows).

## Root duplicates (temporary backwards compatibility)

Deployments that predate this directory invoke the compose files by their old repo-root names (`docker-compose.yml`, `docker-compose.fullapp*.yml`, `docker-compose.preview.yaml`). Those names exist again at the repo root as byte-identical duplicates of the files here (plus a header pointing back). The files in this directory stay canonical — edit them, then copy the change into the root duplicate; `scripts/__tests__/root-compose-backcompat.test.mjs` fails CI on any drift. The duplicates (and the test) go away once existing deployments migrate to the `starters/docker/` paths.

## Windows launcher (`windows/`)

One-command fully containerized stack for clean or locked-down Windows machines — installs Git/WSL2/a container runtime, handles reboots, corporate proxies and TLS interception, generates `.env` secrets, and waits for health:

- `start-windows.bat` — auto-detects Docker Desktop vs Rancher Desktop
- `start-windows-docker.bat` / `start-windows-rancher.bat` — force a runtime
- `check-windows.bat` — read-only machine preflight (run this first on corporate machines)
- `stop-windows.bat` — stop the stack (data preserved)

Image/config details for the app and OpenCode containers live in [`../../docker/README.md`](../../docker/README.md) (Dockerfiles and entrypoints stayed in `docker/`).
