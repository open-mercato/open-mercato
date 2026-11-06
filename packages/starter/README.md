# @open-mercato/starter

The central, cross-platform way to stand up an Open Mercato dev environment. One command, idempotent, platform-aware:

```bash
# Outside a clone (clones the repo into ./open-mercato first):
npx @open-mercato/starter

# Inside a fresh clone, before the first `yarn install`:
node packages/starter/bin/om-start.mjs

# Inside a clone once dependencies are installed:
yarn setup              # same as `yarn om up`: everything from install to a running app
yarn om                 # alias for node packages/starter/bin/om-start.mjs
```

`yarn setup` checks Docker (CLI, Compose v2, a running engine), refuses ports another process already holds, starts PostgreSQL, Redis, Meilisearch and OpenCode, and waits for their healthchecks before it touches the database. Each failure says what to fix. Nothing installs Docker or asks for sudo. Already running those services yourself? `yarn setup --no-infra` skips every Docker call and uses the URLs in your `.env`. Re-running is safe: containers and volumes are reused, `.env` values are never overwritten.

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

Useful flags: `--verbose`, `--non-interactive`, `--skip-llm-prompt`, `--skip-db`, `--no-infra` (no Docker calls at all, also passed on to `yarn dev`), `--rebuild`, `--clean`, `--profile <name>`, `-- <args for yarn dev>`.

`up --clean` forces a full re-converge: it clears the completed-step markers (install, build, migrations) and rebuilds the OpenCode service image, without touching any data — the one-time database seed stays done, and `reset` remains the destructive variant. Conversely, a plain `up` now also skips the database step entirely when the database is initialized and no `Migration*.ts` file changed since the last run (new migrations are detected by fingerprint and applied automatically).

## Setup logs

Like `yarn dev` and `yarn dev:greenfield`, interactive `yarn setup` and `yarn infra:up` keep routine logs folded behind a dim emoji `[d]` hint without a frame or background. Stage headers, progress, banner text and raw output share a consistent left margin. Original `── Step n/N` headers stay visible; only the `Expected:` label is bold yellow. An animated `⚙️ working…` row shows elapsed time until the completion status replaces it. The spinner pauses while raw logs are shown and never overlaps provider prompts. ✅ / ℹ️ / ❌ summaries stay visible. Press **d** to show newly buffered output and stream new logs; press **d** again to hide them without an extra notice. Already displayed output is not replayed on subsequent toggles or failures. Failures reveal the buffered diagnostics automatically. AI-provider prompts remain interactive, and setup restores the terminal before starting the dev runtime.

Complete setup and infrastructure output is saved to `.mercato/logs/<run>-setup-raw.log` or `<run>-infra-raw.log`; the command prints the path when it starts. The file includes step summaries and full child-process stdout/stderr even while folded; only the last 200 hidden lines are retained for on-screen replay. Provider answers are never captured. These are local diagnostic files and can contain initialization details, so review them before sharing.

Use `yarn setup --verbose` or `yarn infra:up --verbose` for live raw output. CI, redirected output, `--non-interactive`, and `TERM=dumb` also stream directly. The existing dev logging settings apply: `MERCATO_DEV_OUTPUT=verbose`, `OM_DEV_LOG_DIR`, `OM_DEV_RUN_ID`, and `OM_DEV_LOG_TEE=0` (disable log files). `NO_COLOR` disables banner colors.

## Design rules

- **Node stdlib only, no build step.** The CLI must run from a fresh clone before any `yarn install` — that is what makes it usable behind broken proxies.
- **Install nothing system-level.** WSL2, Docker Desktop, and Rancher Desktop are detected and *proposed* (with exact commands and an IT handout), never installed. The starter installs only what it fully owns: portable Node (platform scripts), yarn via corepack, env files, CA bundles, repo state.
- **Corporate TLS interception is a first-class citizen.** `up` probes real egress hosts, captures the interception CA (wire + Windows certificate store + vendor bundles like Netskope's), and provisions one PEM bundle everywhere: `NODE_EXTRA_CA_CERTS` + `--use-system-ca` for host tooling, `docker/certs/` + `docker/opencode/certs/` for image builds and container egress, a Rancher Desktop provisioning script for engine pulls. Prefer handing the starter your official bundle via `starters/company/config.mjs`.
- **Probes use `127.0.0.1`, never `localhost`** (Windows resolves `localhost` to `::1` first).
- **The clone's vendored starter wins.** `npx` defers to `packages/starter` inside the repo it operates on, so the starter version always matches the compose files it drives.

## Company tailoring

Organizations customize behavior (mirrors, CA bundles, extra checks/steps, env defaults) via `starters/company/config.mjs` in the repo — see `starters/company/README.md`. The package stays generic; the repo carries the policy.
