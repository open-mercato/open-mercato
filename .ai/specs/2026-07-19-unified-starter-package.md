# Unified Starter Package (`@open-mercato/starter`)

- **Date**: 2026-07-19
- **Status**: Implemented
- **Supersedes**: the launcher half of `2026-07-07-windows-one-command-agentic-dev-environment.md` and the `starters/hybrid` + `starters/docker/windows` script surface of `2026-07-17-hybrid-dev-runtime-and-starters.md`

## Problem

The dev-environment startup surface had grown to ~17 entry files across three hand-synced implementations (bash, PowerShell, Node): `starters/hybrid/{install,start,stop}.{sh,ps1,bat}` + `windows-toolchain.ps1`, and `starters/docker/windows/` (5 `.bat` launchers, `preflight-windows.ps1`, the 2,416-line `start-dev.ps1`). The LLM provider catalog, port defaults, and `.env` bootstrap logic were each duplicated between PowerShell and Node. The hybrid Windows path hard-required admin + winget — precisely wrong for the priority audience (enterprise clients on managed Windows 22H2 devices behind TLS-intercepting proxies). Corporate CA handling existed only in the enterprise launcher and only covered image builds.

## Decision

One **central command** implemented as a versioned workspace package, **`packages/starter`** (`@open-mercato/starter`), stdlib-only and build-free so it runs from a fresh clone before any `yarn install`:

```
npx @open-mercato/starter [up|stop|status|logs|doctor|reset|infra]   # anywhere; clones if needed
yarn om ...                                                          # inside a clone
packages/starter/platform/start.{cmd,ps1,sh}                         # pre-Node bootstraps (portable Node 24, no admin)
```

- `bin/om-start.mjs` — locates the repo (walk-up marker: `starters/docker/compose.infra.yml`), clones when standalone, and **defers to the clone's vendored starter** (gradlew pattern) so the starter version always matches the compose files it drives.
- `src/steps.mjs` — idempotent convergence pipeline for `up` (`check → apply | guide`): toolchain → container-runtime gate → corporate TLS trust → env/secrets → `yarn install` (lockfile-hash sentinel) → infra (`compose up --wait`) → database (migrate always; initialize once per `DATABASE_URL`, marker in `.mercato/starter/`). Re-running is always safe; completed steps are skipped.
- `src/doctor.mjs` — read-only audit (Node/yarn/git, WSL2, runtime + Docker Desktop ≥ 4.42 Zscaler check, RAM/disk floors, `localhost` v4/v6 resolution, TLS interception, proxy consistency, ports, clone path, container→host `host.docker.internal` probe) with per-item remediation and an aggregated **"hand this to IT" sheet**.
- `src/certs.mjs` — corporate TLS trust as a first-class step (see below).
- `src/supervise.mjs` + `scripts/dev.mjs` — "PM2-like" without PM2: `yarn dev` now restarts the **app** child with backoff (mirroring the existing MCP lifecycle; `OM_DEV_APP_RESTART=0` opts out), and `up --detach` runs it pidfile-managed in the background with `status`/`logs`/`stop`.
- `src/ui.mjs` — colors (NO_COLOR/CI-aware), ASCII banner, staged headers with duration expectations, spinners for health waits, framed "what to do next" guide boxes.
- `starters/company/` — per-organization overlay (`config.mjs` committed, `config.local.mjs` gitignored): mirrors (npm/alpine/node-dist), CA bundles, capture opt-out, extra doctor checks, step disable/extend, `.env` defaults. The package is code; the repo carries policy.

### Policy: propose, never install

WSL2, Docker Desktop, and Rancher Desktop are **never installed by the starter** — it detects, explains, and prints exact user/IT instructions, then resumes automatically once the requirement appears. The starter installs only what it fully owns: portable checksum-verified Node 24 (platform bootstraps, `%LOCALAPPDATA%\OpenMercato\node` / `~/.local/share/open-mercato/node`, no admin), yarn via corepack, env files/secrets (fill-missing-only), CA bundles, repo state.

### Corporate TLS interception (the managed-device linchpin)

Verified mechanisms (2026), wired in `certs.mjs` + `steps.mjs`:

- **Detect** by probing real egress hosts with strict TLS (`registry.yarnpkg.com`, `github.com`, `registry-1.docker.io`) — interception is SNI/destination-selective, one clean host proves nothing.
- **Capture** merges three sources, deduped by fingerprint: the presented chain (roots + intermediates — Zscaler rotates intermediates weekly), the Windows certificate store (`Cert:\CurrentUser\Root`, readable without admin; the GPO-deployed root often is not on the wire), and vendor drop files (Netskope's `nscacert_combined.pem`). Company-provided bundles in `starters/company/` are preferred over capture.
- **Provision** one PEM bundle (`.mercato/certs/corporate-ca.pem`) everywhere:
  - host tooling: `NODE_EXTRA_CA_CERTS` + `NODE_OPTIONS=--use-system-ca` (Node 24 reads the OS store additively) + `NODE_USE_ENV_PROXY=1` (corepack ≥ 0.35 dropped its own proxy handling) + `git http.sslBackend schannel` on Windows (mixed fleets; schannel default only since Git 2.48.1);
  - image builds & container egress: `docker/certs/` + `docker/opencode/certs/` (consumed by the existing Dockerfiles);
  - engine pulls: Docker Desktop imports the Windows store (restart required; ≥ 4.42.0 for Zscaler's negative-serial certs — doctor-enforced); Rancher Desktop auto-imports too but has regressed, so the starter also writes a deterministic provisioning script to `%LOCALAPPDATA%\rancher-desktop\provisioning\open-mercato-corp-ca.start` (LF endings, runs as root before dockerd).

### Hostname correctness

All host-side probes and generated `DATABASE_URL`/`MEILISEARCH_HOST` values use `127.0.0.1`, never `localhost` (modern Windows resolves `localhost` to `::1` first while published container ports listen on IPv4). The `compose.infra.yml` `extra_hosts` pin is parameterized (`host.docker.internal:${OM_HOST_GATEWAY:-host-gateway}`) because on Rancher Desktop/WSL2 `host-gateway` can resolve to the WSL distro instead of the Windows host; the doctor dual-probes (pinned mapping vs engine-native resolution) and prescribes the exact `OM_HOST_GATEWAY=<ip>` fix when they disagree. `OPENCODE_MCP_URL` stays the manual escape hatch.

### OpenCode image: published base + thin local build

Reconciled with the base-image split from #4286 (`docker/opencode/Dockerfile.base` + `BASE_IMAGE.md`): the published Docker Hub tag (`${OPENCODE_BASE_IMAGE:-docker.io/openmercatocom/open-mercato-opencode:1.18.3}`) is a **base** image — OpenCode binary + non-root user, no entrypoint or agents. All compose files keep a `build:` block on `docker/opencode` (the thin Dockerfile `FROM` that base, layering only this project's agents/skills/entrypoint) tagged `opencode-mvp`. The sole network step is the base pull, which goes through the engine's trust (OS certificate store on Docker/Rancher Desktop) and therefore survives TLS interception that breaks build-stage egress; the thin build needs no network at all. `ensureOpencodeImage` (starter) pre-pulls the base (mirror hint via `OPENCODE_BASE_IMAGE` on failure) and builds the thin image when missing (`--rebuild` forces it). Runtime corporate-CA trust additionally comes from a read-only mount of `docker/opencode/certs` at `/run/om-certs`: the entrypoint assembles system-bundle + extras and exports `SSL_CERT_FILE`/`NODE_EXTRA_CA_CERTS` (it cannot touch the system store as a non-root user).

### Windows spawn hardening

`packages/starter/src/spawn.mjs` ports the `scripts/dev-spawn-utils.mjs` contract without the cross-spawn dependency: yarn/npm/corepack/npx (cmd shims Node ≥ 18.20 cannot spawn shell-less) get `shell: true` only after command + args pass control-char and cmd-metacharacter validation, with whitespace args quoted. The repo-wide `windows-spawn-guard` test covers the package.

### Compose service-graph fixes (startup correctness)

- `redis`: `restart: unless-stopped` added in all three compose files (was the only unguarded service; `CACHE_STRATEGY=redis` made its crash fatal).
- prod `app` (`compose.fullapp.yml`): healthcheck added; `mcp` and the Traefik overlay now gate on `service_healthy`.
- `keycloak` (dev): `SSO_DEV_ISSUER` uses service DNS (`http://keycloak:8080/...`) instead of the `DEPLOY_ENV`-fragile container name; admin credentials env-parameterized; added to `compose.infra.yml` behind a `sso` profile.
- Traefik overlay: ForwardAuth address follows `${CONTAINER_PORT}`; `DOMAIN_CHECK_SECRET` is now required (`:?`) so an unset secret fails fast instead of silently injecting an empty auth header.
- prod `opencode`/`app` now forward the full extended LLM-provider env block (parity with dev/infra).

### Removed

`starters/hybrid/` (11 files), `starters/docker/windows/` (7 files), `starters/lib/{install,start,stop}.mjs`; root scripts `starters:start`/`starters:stop`. `yarn infra:up|down` now routes through the starter bin. Docs updated (README, CONTRIBUTING, RUN_AGENT_ON_OPENCODE_WINDOWS, manuals README flagged for a rewrite pass).

## Migration & Backward Compatibility

- `yarn infra:up` / `yarn infra:down` keep their exact behavior (same compose file, `--project-directory .` anchoring, same volume/network identity).
- `yarn dev` contract unchanged; app restart-on-crash is additive and opt-out (`OM_DEV_APP_RESTART=0`).
- Compose volume/network names, ports, env var names: unchanged. The only behavior change is the Traefik overlay's fail-fast on missing `DOMAIN_CHECK_SECRET` (previously an empty header — a security fix).
- The deleted launcher entry points were introduced on this same unreleased branch; no released surface is broken. The curl/irm standalone URLs move to `packages/starter/platform/`.
- npm publishing of `@open-mercato/starter` follows the existing workspace release process; until published, `npx` falls back to the in-repo bin (documented in READMEs).

## Integration coverage

- Unit: `packages/starter/src/__tests__/starter.test.mjs` (repo-root walk-up, compose ps parsing, env fill-missing semantics, trust-env wiring, CA bundle merge, port overrides, step-engine skip/blocked/failure paths) — wired into `yarn test:scripts`.
- Manual (macOS, this change): `om-start doctor` (full audit incl. container→host probe), `om-start status`, syntax checks for all modules + `platform/start.sh`.
- Follow-ups: Windows 10/11 22H2 managed-device dry run (CLM + Zscaler fleet), `up --mode docker` end-to-end on Windows, printable manuals rewrite, publish pipeline for the package.

## Automatic infrastructure in `yarn setup` (2026-10-22, #7791)

### Problem

A first run needed several manual commands. The monorepo had `yarn infra:up` but no `yarn setup`; generated apps had `yarn setup` (and its classic/reinstall variants) but no `infra:up`/`infra:down`, and their setup assumed PostgreSQL, Redis and Meilisearch were already running. A missing or stopped Docker surfaced only later as a raw database connection error. In compact mode the `mercato init` box with the login credentials went only to `.mercato/logs/*-dev-setup-runner.log`, and the box said "Start the dev server: yarn dev" although setup starts it right after.

### Decisions

1. **One preflight, two homes.** The Docker preflight and the health-waited start live in `packages/starter/src/infra-preflight.mjs` (Node stdlib only, no sibling imports). `yarn template:sync` mirrors it byte-for-byte to `packages/create-app/template/scripts/dev-infra-preflight.mjs` (explicit mapping, same pattern as `dev-docker-availability.mjs`), and a starter test asserts byte equality. Generated apps do not depend on `@open-mercato/starter`: its bin resolves or clones a monorepo checkout, the template must not grow a dependency for this, and the infra step has to run before `yarn install`.
2. **Generated apps.** `scripts/infra.mjs` backs `yarn infra:up` / `yarn infra:down` against the app's own `docker-compose.yml` (default services postgres, redis, meilisearch; `--profile agents` adds opencode). `yarn setup` (and `setup:classic`, `setup:reinstall`, `setup:reinstall:classic`, which all route through `scripts/setup.mjs`) runs the preflight and `docker compose up -d --wait` first, then the existing install → generate → migrate → initialize → dev sequence.
3. **Monorepo.** `yarn setup` is an alias for `om-start up` (the existing starter pipeline). `yarn om`, `yarn infra:*`, `yarn dev`, `yarn dev:greenfield` are unchanged. The starter's infra step and `yarn infra:up` use the same shared start (`startInfra` in `infra.mjs`).
4. **`--no-infra` means zero Docker calls.** Generated app: `setup.mjs` skips the infra step and forwards the flag to `scripts/dev.mjs`, which then skips the OpenCode container refresh (`docker ps` / `docker restart`). Monorepo: the starter already skipped the runtime/host-gateway/infra steps; the database step's `compose exec` probes now return "no verdict" under the flag, and the flag is passed on to `yarn dev`.
5. **Distinct, actionable failures.** `detectDockerRuntime` returns `cli-missing`, `compose-missing`, `daemon-stopped`, `daemon-permission` or `daemon-unresponsive` (bounded 20 s probe). Before `up`, host ports of services not already running in the project are probed (`port-conflict`, naming the `*_PORT` override). After a failed `up --wait`, `compose ps` decides between `unhealthy` (per service, with the `compose logs` command) and `compose-failed`. When `compose ps` itself fails, the port probe is skipped (our own running containers would otherwise look like foreign port owners) and `compose up` reports the real error. `compose-failed` points at "port is already allocated / ports are not available" in the output (on Windows also the Hyper-V/WinNAT reserved ranges). Under WSL (`WSL_DISTRO_NAME` or `microsoft` in `/proc/version`) a missing CLI or stopped engine points at Docker Desktop's WSL integration instead of installing Docker Engine. In the monorepo the port-conflict text names `apps/mercato/.env` for `DATABASE_URL` and the fixed `mercato-*` container names (`MERCATO_STACK`). The starter's `infra-up` check counts a service as ready only when its healthcheck is empty or `healthy`, so a `starting` postgres goes through `up --wait` before the database step. Every message ends with the `--no-infra` opt-out. Setup exits non-zero and never continues to database steps after an automatic infra failure. Nothing installs Docker or runs sudo; Linux hints print the command for the user.
6. **Idempotent and non-destructive.** `up -d --wait` reuses existing containers and volumes; running services are reported as reused. Infra never writes `.env`, never rewrites `DATABASE_URL`, and a non-loopback `DATABASE_URL` gets a note instead of a silent switch. `infra:down` keeps volumes unless `--volumes --yes`. `--reinstall` and `dev:greenfield` keep their explicit reset semantics. A generated app's non-reinstall setup calls `mercato init --skip-if-initialized` (new, additive flag): on a database that already has users it keeps the data and exits 0 instead of aborting with a hint towards the destructive `--reinstall`, so a second `yarn setup` reaches the running app. The monorepo starter passes the same flag to its first-run `initialize` (except when the volume was found emptied), because under `--no-infra` no probe can tell whether an external database is already seeded. The skip message names `host:port/database` from `DATABASE_URL`, so a URL pointing at another project's database is visible.
7. **Login box.** Runners that start the dev server right after `initialize` (generated-app setup, greenfield, the starter) pass `OM_INIT_DEV_AUTOSTART=1`; `mercato init` then prints "The dev server is starting now (next time run: yarn dev)." instead of "Start the dev server". Compact mode echoes the box to the terminal (`extractInitSummaryBox` in `dev-orchestration-log-policy.mjs`). `turbo.json` passes the variable through to the monorepo `initialize` task.

### Migration & Backward Compatibility

- Additive only: new `infra:up`/`infra:down` scripts in the template, new monorepo `setup` script, new `--no-infra` flag on `scripts/dev.mjs`, new `OM_INIT_DEV_AUTOSTART` env var, new `mercato init --skip-if-initialized` flag, new exports (`infra-preflight.mjs`, `startInfra`, `infraServices`, `describeInfraProblem`, `devRuntimeArgs`). `detectDocker()` keeps `{ ok, reason }` and adds `code`; `parseComposePsOutput` is still exported from `compose.mjs`.
- Behavior change for newly generated apps only: `yarn setup` now needs a running Docker engine, or `--no-infra` for the previous external-services path. Existing apps keep their scripts.
- No data path changes: compose project, volume and container names are untouched.

### Tests

- `packages/starter/src/__tests__/starter.test.mjs`: runtime classification, remediation text and opt-out hint, port conflicts limited to non-running services, unhealthy-service diagnosis, `startInfraServices` (no `up` on runtime/port failure, no destructive compose calls, reuse logging), `--no-infra` (database probes never call compose, steps skipped, flag forwarded to `yarn dev`), infra failure stops before the database step, root `setup` alias, template mirror parity.
- Review follow-ups in `starter.test.mjs`: WSL detection and hints, `compose-failed` port hints, monorepo port-conflict text, port probe skipped when `compose ps` fails, `infra-up` check waits for `healthy`, database step passes `--skip-if-initialized` (not for an emptied volume).
- `packages/cli/src/__tests__/mercato.test.ts` and `packages/cli/src/lib/__tests__/init-existing-database.test.ts`: `mercato init` aborts on existing users without the flag, keeps data and names the database (no credentials) with it, proceeds on an empty database.
- `packages/create-app/src/lib/template-setup-infra.test.ts`: runs the shipped `setup.mjs` / `infra.mjs` with a logging fake `docker` on PATH: `--no-infra` (also with `--classic --reinstall`) makes zero Docker calls and forwards flags; the happy path runs the preflight before `compose up -d --wait`; missing CLI, missing compose, stopped daemon, failed healthcheck and a busy port each stop before the dev runner with the opt-out hint; `infra:down --volumes` needs `--yes`; `infra.mjs` still runs when reached through a symlinked path (real-path comparison, drive-letter case on Windows).
- `scripts/__tests__/dev-orchestration-log-policy.test.mjs`: init box extraction (turbo prefixes, last box, incomplete output) and the kept-data notice on a re-run.
- Validation matrix: Linux (Docker Engine, compose v5.5.1), the final template scripts with real Docker and the template `docker-compose.yml`: busy default ports stop before `compose up`, setup with free ports reaches the dev runner with all services healthy, a re-run reuses the containers and keeps data, `infra:up` through a symlinked path, `infra:down` keeps volumes, `--volumes` needs `--yes`, `--no-infra` makes zero Docker calls (logging wrapper), a user without access to the Docker socket gets `daemon-permission`. An earlier Verdaccio scaffold run used an older publication with `setup.mjs` swapped in by hand; a fresh Verdaccio run from the final HEAD, the monorepo `yarn setup` with Docker end to end, and macOS/Windows manual runs are still open.

## Changelog

- 2026-07-19 — Initial implementation (package, CLI, steps, doctor, certs, supervision, compose fixes, docs).
- 2026-10-22 — #7791: `yarn setup` starts and health-checks the infra in generated apps and the monorepo, shared Docker preflight, `--no-infra` with zero Docker calls, `infra:up`/`infra:down` in the template, login box visible in compact setup.
- 2026-10-23 — #7791 review follow-ups: monorepo `initialize --skip-if-initialized`, health-aware `infra-up` check, WSL and port hints, symlink-safe `infra.mjs` entry, database name in the skip message.
