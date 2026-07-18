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

### OpenCode image: pull first, build as fallback

All compose files reference `${OPENCODE_IMAGE:-openmercatocom/open-mercato-opencode:latest}` (Docker Hub) instead of building `docker/opencode` inline — a registry pull goes through the engine's trust (OS certificate store on Docker/Rancher Desktop) and therefore survives TLS interception that breaks build-stage egress. `ensureOpencodeImage` (starter) tries local image → `docker pull` → local `docker build` under the same tag (`--rebuild` forces the build). For pulled images, runtime corporate-CA trust comes from a read-only mount of `docker/opencode/certs` at `/run/om-certs`: the entrypoint assembles system-bundle + extras and exports `SSL_CERT_FILE`/`NODE_EXTRA_CA_CERTS` (it cannot touch the system store as a non-root user).

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

## Changelog

- 2026-07-19 — Initial implementation (package, CLI, steps, doctor, certs, supervision, compose fixes, docs).
