# @open-mercato/starter

The central, cross-platform way to stand up an Open Mercato dev environment. One command, idempotent, platform-aware:

```bash
# Anywhere (clones the repo if you are not inside one):
npx @open-mercato/starter

# Inside a clone:
yarn setup              # same as `yarn om up`: everything from install to a running app
yarn om                 # alias for node packages/starter/bin/om-start.mjs
```

`yarn setup` offers a service choice in an interactive terminal; press Enter to reuse the services configured in `apps/mercato/.env` without Docker calls. Noninteractive runs also default to reuse. Use `--ephemeral` for disposable PostgreSQL, Redis and Meilisearch managed by Testcontainers, `--random-ports` for a persistent isolated Compose stack on free ports, or `--infra` for Compose on configured ports. `--no-infra` and `--reuse-services` explicitly select reuse. Random and ephemeral modes update the service ports and matching connection URLs together; ephemeral mode restores the previous settings and removes its containers when the foreground session stops. Compose containers and volumes persist. Nothing installs Docker or asks for sudo.

Apps created with `npx create-mercato-app` get the same check: their `yarn setup` (and `yarn infra:up` / `yarn infra:down`) runs this package's preflight from `scripts/dev-infra-preflight.mjs`, a byte-for-byte copy kept in sync by `yarn template:sync`.

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

Useful flags: `--reuse-services`, `--ephemeral` (foreground only), `--random-ports`, `--infra`, `--non-interactive`, `--skip-llm-prompt`, `--skip-db`, `--no-infra` (no Docker calls at all, also passed on to `yarn dev`), `--rebuild`, `--clean`, `--profile <name>`, `-- <args for yarn dev>`.

`up --clean` forces a full re-converge: it clears the completed-step markers (install, build, migrations) and rebuilds the OpenCode service image, without touching any data — the one-time database seed stays done, and `reset` remains the destructive variant. Conversely, a plain `up` now also skips the database step entirely when the database is initialized and no `Migration*.ts` file changed since the last run (new migrations are detected by fingerprint and applied automatically).

## Design rules

- **Node stdlib bootstrap, no build step.** The CLI runs from a fresh clone before `yarn install`. Testcontainers is loaded lazily from the checkout only after dependencies are installed and only for an explicit ephemeral service choice.
- **Install nothing system-level.** WSL2, Docker Desktop, and Rancher Desktop are detected and *proposed* (with exact commands and an IT handout), never installed. The starter installs only what it fully owns: portable Node (platform scripts), yarn via corepack, env files, CA bundles, repo state.
- **Corporate TLS interception is a first-class citizen.** `up` probes real egress hosts, captures the interception CA (wire + Windows certificate store + vendor bundles like Netskope's), and provisions one PEM bundle everywhere: `NODE_EXTRA_CA_CERTS` + `--use-system-ca` for host tooling, `docker/certs/` + `docker/opencode/certs/` for image builds and container egress, a Rancher Desktop provisioning script for engine pulls. Prefer handing the starter your official bundle via `starters/company/config.mjs`.
- **Probes use `127.0.0.1`, never `localhost`** (Windows resolves `localhost` to `::1` first).
- **The clone's vendored starter wins.** `npx` defers to `packages/starter` inside the repo it operates on, so the starter version always matches the compose files it drives.

## Company tailoring

Organizations customize behavior (mirrors, CA bundles, extra checks/steps, env defaults) via `starters/company/config.mjs` in the repo — see `starters/company/README.md`. The package stays generic; the repo carries the policy.

## Recovering from setup failure

The starter prints the failed step and a manual path. Check the selected service
URLs in `apps/mercato/.env`, then run `yarn install`, `yarn build:packages`,
`yarn generate`, `yarn build:packages`, `yarn db:migrate`,
`yarn initialize -- --skip-if-initialized`, and `yarn dev --no-infra`.
Alternatively retry `yarn setup --ephemeral`, `yarn setup --random-ports`, or
`yarn setup --infra`. Ephemeral URLs are session-scoped; after failure or exit,
use the restored existing-service URLs or start another ephemeral setup session.
