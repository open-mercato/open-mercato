# @open-mercato/starter

The central, cross-platform way to stand up an Open Mercato dev environment. One command, idempotent, platform-aware:

```bash
# Anywhere (clones the repo if you are not inside one):
npx @open-mercato/starter

# Inside a clone:
yarn om                 # alias for node packages/starter/bin/om-start.mjs
```

No Node yet? The package ships pre-Node bootstraps that install a **portable, checksum-verified Node 24 without admin rights**, then run the CLI:

- **Windows**: double-click `packages\starter\platform\start.cmd`, or `irm https://raw.githubusercontent.com/open-mercato/open-mercato/main/packages/starter/platform/start.ps1 | iex`
- **macOS/Linux**: `./packages/starter/platform/start.sh`, or `curl -fsSL https://raw.githubusercontent.com/open-mercato/open-mercato/main/packages/starter/platform/start.sh | bash`

## Commands

| Command | What it does |
|---------|--------------|
| `up` (default) | Idempotent converge + start: toolchain → container-runtime gate → corporate TLS trust → `.env`/secrets → `yarn install` → infra containers → database → supervised dev runtime. Re-running is always safe; completed steps are skipped. |
| `up --detach` | Same, but the dev runtime keeps running in the background (pidfile-managed). |
| `up --mode docker` | Everything containerized (for machines where host Node workloads are not allowed). Mode is remembered. |
| `stop` | Stop the dev runtime and the infra containers (`--keep-infra`, `--volumes --yes`). |
| `status` | Processes, containers, health, URLs. |
| `logs [--follow]` | Tail the newest dev log. |
| `doctor` | Read-only audit with per-item remediation and a **"hand this to IT" sheet** for admin-gated items. |
| `reset` | Destructive cleanup (containers, volumes, starter state) — asks first. |
| `infra up\|down` | Just the infra containers. |

Useful flags: `--non-interactive`, `--skip-llm-prompt`, `--skip-db`, `--no-infra`, `--rebuild`, `--profile <name>`, `-- <args for yarn dev>`.

## Design rules

- **Node stdlib only, no build step.** The CLI must run from a fresh clone before any `yarn install` — that is what makes it usable behind broken proxies.
- **Install nothing system-level.** WSL2, Docker Desktop, and Rancher Desktop are detected and *proposed* (with exact commands and an IT handout), never installed. The starter installs only what it fully owns: portable Node (platform scripts), yarn via corepack, env files, CA bundles, repo state.
- **Corporate TLS interception is a first-class citizen.** `up` probes real egress hosts, captures the interception CA (wire + Windows certificate store + vendor bundles like Netskope's), and provisions one PEM bundle everywhere: `NODE_EXTRA_CA_CERTS` + `--use-system-ca` for host tooling, `docker/certs/` + `docker/opencode/certs/` for image builds and container egress, a Rancher Desktop provisioning script for engine pulls. Prefer handing the starter your official bundle via `starters/company/config.mjs`.
- **Probes use `127.0.0.1`, never `localhost`** (Windows resolves `localhost` to `::1` first).
- **The clone's vendored starter wins.** `npx` defers to `packages/starter` inside the repo it operates on, so the starter version always matches the compose files it drives.

## Company tailoring

Organizations customize behavior (mirrors, CA bundles, extra checks/steps, env defaults) via `starters/company/config.mjs` in the repo — see `starters/company/README.md`. The package stays generic; the repo carries the policy.
