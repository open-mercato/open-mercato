# Starters

One place for every way to stand up an Open Mercato dev environment. Pick by **mode** first — the platform only changes which file extension you run.

| Starter | What runs where | Best for |
|---------|-----------------|----------|
| [`hybrid/`](hybrid/) **(default)** | App + MCP server natively on your machine (`yarn dev`); OpenCode + postgres/redis/meilisearch in containers | Day-to-day development: fast iteration, native debugging |
| [`docker/`](docker/) | Everything in containers (app, MCP, OpenCode, infra) | Enterprise/locked-down machines, corporate proxies, no local Node |
| [`../.devcontainer/`](../.devcontainer/) | VS Code devcontainer | Editor-managed containerized workspace |

## Hybrid (default)

Prerequisites are installed for you (git, Node 24, corepack yarn); Docker Desktop / Rancher Desktop / a native engine must be installed separately (the installer tells you how).

```bash
# Linux/macOS — standalone (clones the repo) or inside a clone:
curl -fsSL https://raw.githubusercontent.com/open-mercato/open-mercato/main/starters/hybrid/install.sh | bash
# Windows — double-click starters\hybrid\install.bat, or:
irm https://raw.githubusercontent.com/open-mercato/open-mercato/main/starters/hybrid/install.ps1 | iex
```

Day-to-day:

```bash
yarn infra:up     # OpenCode + postgres/redis/meilisearch containers
yarn dev          # app + queue workers + scheduler + MCP server (Ctrl+C stops)
yarn infra:down   # stop the containers (data preserved)
```

`starters/hybrid/start.{sh,ps1,bat}` and `stop.{sh,ps1,bat}` wrap the same steps for double-click/one-command use.

## Docker (enterprise)

The fully containerized stack, driven by the hardened Windows launcher (`docker/windows/start-windows.bat` — handles WSL2 installs, reboots, corporate proxies/TLS interception, Rancher Desktop) or directly via compose:

```bash
docker compose --project-directory . -f starters/docker/compose.fullapp.dev.yml up --build
```

> **Always pass `--project-directory .` (repo root).** It anchors `.env` interpolation, relative bind mounts, and the compose project name at the repo root — bare `-f starters/docker/...` would silently read the wrong `.env`. The `yarn docker:*` and `yarn infra:*` scripts do this for you.

See [`docker/README.md`](docker/README.md) for the compose file matrix.
