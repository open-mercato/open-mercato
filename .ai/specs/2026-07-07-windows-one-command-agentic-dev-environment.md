# One-Command Windows Agentic Dev Environment

## TLDR

A clean Windows machine (no Docker, no Node, no Git) reaches a fully working agentic dev environment — the Next.js app, a **new containerized MCP server**, the OpenCode agent container, and Postgres/Redis/Meilisearch, all wired together with the database initialized and seeded from scratch — by double-clicking `start-windows.bat`. The launcher installs prerequisites via winget (Git, WSL2, Docker Desktop), survives the reboot cycle via `RunOnce` auto-resume, clones the repo when run standalone, generates `.env` secrets, requires an LLM provider key (interactive prompt; `-SkipLlmPrompt` opts out), runs `docker compose -f docker-compose.fullapp.dev.yml up`, waits for health, and prints URLs + credentials. Every step is idempotent and probe-driven; a second double-click converges in under a minute.

## Overview

Open Mercato's agentic stack has three pillars:

1. **The app** (Next.js, :3000) — serves the backend UI and the Cmd+K command palette.
2. **The MCP server** (Streamable HTTP, :3001) — exposes Code Mode tools (`search` + `execute`) to AI agents; needs the full monorepo, DB access, and two-tier auth (`x-api-key` header validated against the `api_keys` table, per-call `_sessionToken`).
3. **The OpenCode agent** (:4096) — the Go agent that drives tool calls against MCP.

Before this spec, only OpenCode was containerized. The MCP server ran host-only (`yarn mcp:serve`), the full-app compose files omitted the app↔OpenCode↔MCP wiring entirely (no `OPENCODE_URL`, no `OPENCODE_MCP_URL`, no published OpenCode port, no MCP service), and `MCP_SERVER_API_KEY` had to be a manually created DB API key. `scripts/setup-windows-dev.ps1` covered the native toolchain (Node, Build Tools) but explicitly not Docker, cloning, or stack startup.

## Problem Statement

A Windows developer cannot get the agentic dev environment running without: installing Node 24 + VS Build Tools (or Docker Desktop) manually, cloning manually, creating `.env` by hand, starting Postgres/Redis manually, starting the MCP server manually in a separate terminal, creating an MCP API key through the UI or CLI, pasting it into the OpenCode container env, and knowing the correct URLs for three services. Each manual step is a failure point; the full sequence is documented across four different guides.

## Proposed Solution

Two independent layers:

**Layer 1 — complete the containerized topology (OS-agnostic).** Add an `mcp` service to both full-app compose files, wire all three services over compose service DNS, and make MCP API-key provisioning fully automatic and idempotent via a new CLI command + shared-volume file handoff.

**Layer 2 — the Windows one-command launcher.** `start-windows.bat` → `scripts/windows/start-dev.ps1` (self-contained, PowerShell 5.1, two-phase elevation) which installs prerequisites, handles reboot-resume, clones when standalone, generates `.env`, prompts for an LLM key, starts the stack, and health-checks it end to end.

## Architecture

### Topology (fullapp.dev)

```
Windows host: Git + Docker Desktop only (no Node required)
Docker (mercato-network-local):
  app        :3000 + splash :4000 (published)   hot reload, bind mount
  mcp        :3001 (published)                  NEW service, reuses app dev image
  opencode   :4096 (published)                  existing image, new wiring
  postgres / redis / meilisearch (internal), keycloak :8080
Wiring (service DNS):
  app      -> opencode  OPENCODE_URL=http://opencode:4096
  opencode -> mcp       OPENCODE_MCP_URL=http://mcp:3001/mcp  (+ x-api-key)
  mcp      -> app       APP_URL=http://app:3000
  browser  -> app       NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### MCP service design

- Reuses the app's dev image (`open-mercato/app:${DEPLOY_ENV}-dev`) and, in dev, the app's bind mount plus the same named volumes (`app_node_modules`, all `pkg_*_dist`). It **never runs `yarn install` or builds** — the app container owns those; running two concurrent installs against the shared `node_modules` volume would corrupt it.
- Entrypoint `docker/scripts/mcp-entrypoint.sh`: polls `http://app:3000` until any HTTP answer arrives (by `dev-entrypoint.sh` ordering that proves install → build → generate → init all finished; no marker files, immune to stale volumes), then provisions the API key, then `exec yarn mercato ai_assistant mcp:serve-http --port 3001`.
- Non-obvious env: `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_API_BASE_URL` are pinned in the compose service because the CLI dotenv-loads the bind-mounted `apps/mercato/.env` for unset vars, and a host value of `localhost:3000` would hijack Code Mode `api.request()` base-URL resolution (`codemode-tools.ts` chain). `TENANT_DATA_ENCRYPTION*` must match the app's or tier-2 session-token secret decryption fails.

### API-key provisioning (`mercato ai_assistant mcp:ensure-api-key`)

The DB stores only bcrypt hashes, so "ensure" semantics anchor on a plaintext file in the `mcp_shared` volume (`/run/mcp-shared/mcp-api-key`, atomic tmp+rename writes; mode 0644 because the consumer — the OpenCode container — runs as a non-root user and the dedicated named volume, mounted only into this stack's containers, is the security boundary):

1. If the file's `omk_` secret resolves via `findApiKeyBySecret` to a live, non-expired key named `__mcp_server__` → exit 0 (no writes).
2. Otherwise soft-delete stale keys of that name (`deleteApiKey`, invalidates the auth cache), resolve the superadmin by email (`findOneWithDecryption`, encrypted-email aware; default `OM_INIT_SUPERADMIN_EMAIL` → `superadmin@acme.com`), collect their role ids, and `createApiKey` with **`createdBy` = the superadmin user id** — header-only MCP calls resolve their ACL context via `sessionUserId ?? createdBy`, so the pre-existing `mercato api_keys add` path (createdBy `null`) would fail closed.
3. The secret is never printed or logged.

Delivery to OpenCode: `docker/opencode/entrypoint.sh` gains a file fallback — when `MCP_SERVER_API_KEY` (env, wins for BC) is empty and `MCP_SERVER_API_KEY_FILE` is set, it polls MCP `/health` first and only then reads the file. Health-first ordering eliminates the stale-key race: the MCP server only starts listening after `ensure-api-key` finished, so a healthy endpoint guarantees the file is final for this boot. With both vars unset the entrypoint behaves byte-for-byte as before (host-MCP `docker-compose.yml` mode untouched).

The app's AI settings page reports the key as configured via a `MCP_SERVER_API_KEY_FILE` existence check (read-only `mcp_shared` mount).

### Windows launcher (`start-windows.bat` + `scripts/windows/start-dev.ps1`)

- **Two-phase elevation**: the script starts unelevated; probes decide whether admin work is needed (Git, WSL2 features, Docker Desktop, Defender exclusion, docker-users membership); only then it relaunches itself elevated (`-Elevated`) for that phase and continues unelevated. Compose always runs in the user session; repeat runs get zero UAC prompts.
- **Steps** (numbered, all probe-driven/idempotent): preflight (build ≥ 19041, virtualization, winget) → prerequisites (elevated child; Docker Desktop installed with `--override "install --quiet --accept-license --backend=wsl-2"`) → reboot gate (HKCU `RunOnce` re-invokes the `.bat`; printed manual fallback; exit 10) → engine up (start Docker Desktop, poll `docker info`, 300 s) → standalone clone (then re-invokes the cloned repo's own launcher) → `.env` generation → LLM prompt → `compose up -d --build` → infra health → app readiness → agentic services health → summary.
- **`.env` generation is fill-missing-only** (mirrors `railway/env.ts` semantics — an existing line is never modified): root `.env` (the compose interpolation channel) gets `JWT_SECRET`, `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`, `MEILISEARCH_MASTER_KEY`, `APP_URL`, `OM_INIT_SUPERADMIN_EMAIL`; `OM_INIT_SUPERADMIN_PASSWORD` + `POSTGRES_PASSWORD` are generated only when no `mercato-postgres-data-local` volume exists (else the compose defaults are kept with a warning so credentials keep matching the initialized volume). Secrets come from a crypto RNG, hex-encoded (avoids compose `$` escaping), and are only ever logged as SHA-256 fingerprints. `apps/mercato/.env` is copied from `.env.example` when absent, with placeholder secrets replaced in the fresh copy only. **`MCP_SERVER_API_KEY` is deliberately never written** — an env value would shadow the volume-file key and break OpenCode → MCP auth.
- **First-boot progress**: fast path probes `:3000`; otherwise the splash server's `GET :4000/status` JSON (`ready`/`failed`/`activities`) feeds a single-line elapsed ticker, with a compose-log fallback. Budget `-TimeoutMinutes` (default 30).
- **Flags**: `-Stop/-Restart/-Status/-Logs/-Reset(-Yes)` secondary actions; `-CloneRoot/-RepoName/-RepoUrl/-Branch`; `-NonInteractive` (auto-on under CI, honors pre-set provider env vars)/`-DryRun`/`-SkipInstall`/`-SkipLlmPrompt`/`-SkipDefenderExclusion`/`-IncludeNativeToolchain` (delegates to the unchanged `setup-windows-dev.ps1`); internal `-LauncherPath/-Elevated/-Resumed`.
- **State** (`.mercato/windows-setup.json`, or `%LOCALAPPDATA%\OpenMercato\` pre-clone) is diagnostic only — resume correctness always comes from live probes. Transcript logs to `%TEMP%\open-mercato-setup\`.
- `stop-windows.bat` wraps `-Stop` (compose down, volumes preserved). `.gitattributes` gains `*.bat`/`*.ps1 text eol=crlf` (git checkout and GitHub ZIP exports both deliver CRLF).

## Data Models

No schema changes. The `api_keys` table is reused as-is; the provisioned key is a normal `ApiKey` row named `__mcp_server__` with `createdBy` = superadmin, tenant-scoped, role-carrying.

## API Contracts

All changes are additive (BACKWARD_COMPATIBILITY §13-compatible):

| Surface | Change |
|---|---|
| CLI | New subcommand `mercato ai_assistant mcp:ensure-api-key --file <path> [--name] [--email] [--rotate]` |
| Compose | New `mcp` service + `mcp_shared` volume in `docker-compose.fullapp.dev.yml` and `docker-compose.fullapp.yml`; new env keys on `app`/`opencode` services, all with safe defaults |
| Env | New optional vars: `MCP_PORT`, `MCP_API_KEY_FILE`, `MCP_SERVER_API_KEY_FILE`, `MCP_WAIT_FOR_APP_TIMEOUT`, `OPENCODE_MCP_KEY_WAIT_SECONDS`, `MCP_NODE_OPTIONS`; documented in `apps/mercato/.env.example` |
| OpenCode entrypoint | File-based key fallback, active only when `MCP_SERVER_API_KEY_FILE` is set |
| Settings API | `mcpKeyConfigured` additionally true when the key file exists (response shape unchanged) |
| Files | New: `docker/scripts/mcp-entrypoint.sh`, `scripts/windows/start-dev.ps1`, `start-windows.bat`, `stop-windows.bat` |

The `ai-assistant` AGENTS.md "Ask First" gate on OpenCode Docker configuration / MCP auth changes was satisfied by the user explicitly requesting this feature and approving the plan.

## Integration & Test Coverage

- Unit: `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/mcp-ensure-api-key.test.ts` — validate-vs-rotate, stale-key soft-delete, superadmin ownership, missing-owner failure, file untouched on valid path (6 cases).
- Compose smoke sequence (manual/CI-able, from the host after `docker compose -f docker-compose.fullapp.dev.yml up -d --build`):
  1. `docker compose ps` — all services healthy.
  2. `curl :3000` answers; `curl :3001/health` → `{"status":"ok","tools":N>0}`; `curl :4096/global/health` → healthy.
  3. `curl :4096/mcp` → `{"open-mercato":{"status":"connected"}}` — proves OpenCode→MCP incl. tier-1 auth end to end.
  4. `POST :3001/mcp` with `x-api-key` from the mcp container's key file → `tools/list` returns tools.
  5. Authenticated `GET /api/ai_assistant/health` → `{opencode:{healthy:true}, mcp:connected}`; browser Cmd+K round trip.
  6. Stack restart → `ensure-api-key` exits 0 (no rotation); `down -v` + up → clean rotation.
  7. Standalone `docker-compose.yml` (host-MCP mode) unchanged.
- Windows launcher test matrix (needs a Windows VM; documented for QA): clean VM end-to-end incl. reboot-resume; repo-cloned-only; Docker-already-installed (<1 min, zero UAC); reboot-mid-install with RunOnce disabled (manual re-run resumes via probes); re-run idempotency (`.env` byte-identical); partial hand-written `.env` (only missing keys appended); pre-existing postgres volume (credentials kept + warning); `-NonInteractive` with provider env vars; `-DryRun` (zero side effects); virtualization-disabled/LTSC/proxy failure messages; `stop-windows.bat`; `-Reset` typed confirmation.
- Static validation performed at implementation time: PowerShell AST parse clean; helper functions (`Get-SecretHex`, fingerprinting, `Add-EnvValueIfMissing` fill-missing-only, HTTP probes) runtime-tested via extracted-AST harness; compose YAML parsed with volume/dependency cross-checks.

## Risks & Impact Review

| Risk | Scenario | Severity | Affected | Mitigation | Residual |
|---|---|---|---|---|---|
| Stale `MCP_SERVER_API_KEY` env shadows the file key | User sets a random value in `.env`; OpenCode sends an invalid `x-api-key`; all tool calls 401 | Medium | AI chat | Env-wins is required for BC; `.env.example` + docker/README warn explicitly; installer never writes the var | Low — clear warning trail |
| Concurrent `yarn install` corrupting shared volume | mcp container installing while app installs | High | Dev stack | mcp entrypoint never installs/builds; waits for app HTTP instead | Negligible |
| Compose builds `mcp` image before `app` | Image-name race on first `up --build` | Low | First boot | Both services declare identical `build` blocks (same context/target/tag); BuildKit de-dupes | Negligible |
| Docker Desktop winget `--accept-license` regression | EULA dialog blocks headless install on a future installer version | Medium | Clean-machine path | Engine-wait step times out with explicit "open Docker Desktop, finish first-run dialogs, re-run" guidance | Low |
| RunOnce disabled by GPO | Auto-resume never fires after reboot | Low | Corporate machines | Manual fallback always printed; every step re-probes so a manual re-run resumes correctly | Negligible |
| Generated credentials drift from initialized DB volume | User deletes `.env` but keeps volumes; printed creds no longer match DB | Medium | Login | Volume-existence guard keeps compose defaults + warns; `-Reset` offers the clean-slate path | Low |
| Session-token decryption failing in mcp container | Encryption env mismatch between app and mcp | Medium | Per-user tool auth | `TENANT_DATA_ENCRYPTION*` mirrored into the mcp service with the same defaults | Low |
| Slow first boot on Windows bind mounts | install+build over virtiofs exceeds healthcheck windows | Medium | First-run UX | 900 s `start_period` healthchecks, 1800 s app-wait, 30 min installer budget — all env-tunable | Low |

## Final Compliance Report

- No cross-tenant exposure: the provisioned key is tenant-scoped to the superadmin's tenant; MCP two-tier auth unchanged.
- No contract surface broken: all changes additive; legacy host-MCP mode byte-identical when new env vars are unset.
- No credentials logged: CLI prints id/prefix only; installer logs SHA-256 fingerprints; secret file is chmod 600 inside a named volume.
- Generated files untouched by hand; `yarn generate` run after CLI addition.
- `scripts/setup-windows-dev.ps1` left unchanged (its documented contract excludes Docker/clone/bootstrap).

## Changelog

- **2026-07-07** — Initial implementation: containerized MCP service + full three-way wiring in both fullapp compose files, `mcp:ensure-api-key` CLI (+6 unit tests), OpenCode key-file delivery, `start-windows.bat`/`stop-windows.bat`/`scripts/windows/start-dev.ps1` one-command launcher, `.gitattributes` CRLF rules, `.env.example` + `docker/README.md` + installation docs updates.
- **2026-07-07** — Rebased onto `feat/agent-orchestrator-mvp`: preserved that branch's OpenRouter provider support, file-defined agents/skills bind mounts on the `opencode` service, `OPENCODE_CONFIG_DIR` override, and the app-service `OPENCODE_URL` it already added in prod compose (deduplicated); the `.bat`/`.ps1` CRLF rules are now pattern-specific exceptions under the branch's global `* text=auto eol=lf` policy (#3470). Also fixed a leftover rebase conflict marker (`>>>>>>> 887ef17df`) that shipped inside `docker-compose.fullapp.dev.yml` on that branch and made the file unparseable for compose. The branch's `opencodeSessionId` API-key binding (cross-user session-continuation fix) is orthogonal to the MCP server key and required no changes.
- **2026-07-07** — Post-review hardening (10-angle code review): owner lookup made genuinely encrypted-email-aware (`$or` emailHash pattern from `AuthService.findUserByEmail` — a plaintext `{ email }` filter finds nothing under `TENANT_DATA_ENCRYPTION=true`); key file written 0644 (root-owned 0600 was unreadable by the non-root OpenCode container); stale-key cleanup tenant-scoped; bare `--file` flag no longer provisions into a file named "true"; canonical env var unified to `MCP_SERVER_API_KEY_FILE`; OpenCode entrypoint degrades to headerless start (with loud warnings) instead of crash-looping on timeout/read failure, bounds each probe with `--max-time`, and tolerates trailing slashes in `OPENCODE_MCP_URL`; `mcpKeyConfigured` validates the file secret against the DB; app services gained `restart: unless-stopped` (reboot-survival parity with mcp/opencode); dev `mcp` service reuses the app-built image without a duplicate build block; healthchecks switched to busybox `wget`/bounded `curl` at 30s and documented as visibility-only. Launcher: compose output now streams to the console (`-Status`/`-Logs`/failure diagnostics were swallowed), `-DryRun` is forwarded on standalone re-entry and exits cleanly pre-clone, `.env` writes are BOM-free with LF endings + trailing-newline guard, empty `KEY=` placeholders are fillable, host ports resolve from `.env` instead of hardcoded literals, `wsl --status` replaces the stub-fooled existence probe, `compose ps --format json` parsing tolerates array and NDJSON output, Defender/docker-users probe failures no longer re-trigger UAC or reboots every run, Git's PATH is refreshed after elevated install (same-run clone), the transcript stops before the summary so the superadmin password never lands in the %TEMP% log, OM_AI_MODEL is no longer pinned into `.env`, and the write-only state file + `-Resumed` plumbing were dropped. `.bat` files are committed with literal CRLF bytes and marked `-text` (raw GitHub downloads and ZIPs now get CRLF too). `packages/ai-assistant/AGENTS.md` two-tier-auth guidance updated for file-based key delivery.
- **2026-07-08** — Closed the review's deferred finding: the four verbatim copies of the user-role-id resolution (mcp-key, session-key, and chat routes plus the CLI provisioning lib) now share one typed helper, `lib/user-role-ids.ts` (`getUserRoleIds`), which also drops the `as any` casts the copies carried — every role-carrying API key surface now inherits the same ACL from the same code path.
- **2026-07-09** — First-run fixes from live testing on Windows/WSL2:
  - **Setup no longer aborts on Compose's "variable is not set" warning.** Two base-branch compose lines (`ANTHROPIC_API_KEY` on opencode, `OPENAI_API_KEY` on app, in both fullapp files) lacked `:-` defaults; adding them silences the warning. More importantly the launcher's `Invoke-Compose` piped Docker through `| Out-Host`, which under `$ErrorActionPreference='Stop'` promoted Compose's benign **stderr** to a terminating error — it now runs the Docker call under `Continue` and merges stderr via `2>&1`, so no Compose warning (present or future) can kill setup.
  - **At least one LLM provider key is now required** during interactive setup (loops until provided); `-NonInteractive` with no key fails fast; `-SkipLlmPrompt` remains the explicit opt-out. An agentic environment with zero provider keys is non-functional, so the previous "skip" path was removed.
  - **Browser can now reach the app.** The dev server (`next dev`) and the build splash both default to binding **loopback** inside the container (`resolveSplashBindHost` → `127.0.0.1`; `next dev` honors the container `HOSTNAME`), which Docker's published-port forwarding cannot reach. The app service now sets `HOSTNAME=0.0.0.0` (both stacks) and `OM_DEV_SPLASH_BIND=0.0.0.0` (dev), so `:3000` and `:4000` are reachable from the host.
  - **Turbopack file-watch limits.** Turbopack watches the whole repo via inotify and ignores the polling env vars, exhausting the kernel's inotify limits. A one-shot privileged `file-watch-limits` init service raises the shared WSL2/Linux kernel's `fs.inotify.max_user_watches` / `max_user_instances` / `max_queued_events` before the app starts (the app `depends_on` it with `service_completed_successfully`); each `sysctl -w` is `|| true` so it degrades gracefully, and it is documented as removable where privileged containers are disallowed.
- **2026-07-09** — Startup-time reductions:
  - **Launcher no longer forces `--build` on every run.** `Start-Stack` now runs `docker compose up -d` (Compose builds the image only when it's missing); a new `-Rebuild` switch forces `--build` for Dockerfile/base-image changes. Because the source is bind-mounted and dependencies install at container start, rebuilding the image each launch just repeated ~10 minutes of work — repeat launches are now dominated only by the (warm) entrypoint pass.
  - **Full LLM provider configurator + first-boot timing.** The interactive provider prompt now offers every OM chat provider from `.env.example` — OpenAI, Anthropic, Google, **Azure OpenAI / AI Foundry**, OpenRouter, DeepInfra, Groq, Together, Fireworks, LiteLLM, Ollama, LM Studio — collecting the API key, a base URL where the backend needs one (required for Azure/LiteLLM/local; local providers pre-fill a `host.docker.internal` default), and a model/deployment id (required for Azure and local backends, which have no universal default). Values are written to the root `.env` (`OM_AI_PROVIDER`, the provider key, `*_BASE_URL`, and `OM_AI_MODEL` when supplied). Both fullapp-dev services now **forward** all provider env vars to the containers, and `docker/opencode/entrypoint.sh` generates valid config for the new providers via `@ai-sdk/openai-compatible` (native blocks stay for openai/anthropic/google/openrouter) — replacing the old "unknown provider → silently default to anthropic" footgun. The `Wait-ForApp` step now explains up-front that first boot commonly takes ~10 minutes (up to ~20 on slow I/O) and that the blank build-splash is expected, so operators don't think it hung. **OpenCode-side support for the newly added providers (Azure especially) needs live per-provider validation**; OM's unified in-process framework supports them regardless.
  - **Admin rights are used only when actually installing.** The launcher now detects prerequisites first: if Git/WSL2/Docker Desktop are all present it prints "no administrator rights needed" and runs the entire flow **unelevated** (clone, `.env`, `docker compose up`, health, and starting Docker Desktop as a `docker-users` member all work without admin). Only a genuinely clean machine takes the elevated install path. A new `-NoAdmin` switch (and the existing `-SkipInstall`) forces the no-admin path for accounts that cannot elevate — it proceeds when IT has pre-provisioned Docker Desktop + WSL2, and otherwise fails fast with exact guidance ("ask IT to install Docker Desktop with the WSL2 backend and add you to docker-users, then re-run `start-windows.bat -NoAdmin`"). A cancelled/denied UAC prompt degrades to the same guidance instead of an opaque crash.
- **2026-07-10** — Fixed a crash class reported live ("Setup failed: ERROR: error during connect … dockerDesktopLinuxEngine: file not found"): in Windows PowerShell 5.1, redirecting a native command's stderr (`2>$null`, `*>`) while `$ErrorActionPreference='Stop'` promotes the first stderr line to a **terminating error** — so `docker info`'s harmless "engine not up yet" stderr killed setup inside the very probe designed to return false and keep waiting. All seven native probe/capture sites (`docker info`, `wsl --status/--update/--set-default-version`, `rdctl start`, `docker volume ls`, `compose ps --format json`) now go through `Invoke-NativeQuiet` / `Invoke-NativeCapture`, which run under `Continue` and return an exit code/stdout instead of throwing; validated under `EAP=Stop` with a stderr-writing non-zero command.
- **2026-07-10** — Native-stderr hardening completed + dual-runtime coexistence: a live crash ("Setup failed: WARNING: DOCKER_INSECURE_NO_IPTABLES_RAW is set" — a benign Docker Desktop notice emitted on every docker command on that machine) showed the remaining bare natives (`winget install` ×2, `git config`, `git clone`) were still vulnerable — including via the second PS 5.1 promotion trigger, where powershell.exe's OWN stderr is redirected (`start-windows.bat > log.txt 2>&1`) and `git clone`'s stderr progress becomes fatal. New `Invoke-NativeVisible` (streams output, never throws) covers them; every native call now runs through a guarded wrapper. For machines with BOTH Docker Desktop and Rancher Desktop: the launcher prefers whichever is already running (else `-Runtime`, else Docker Desktop, with an explicit info line), aligns the docker CLI context (`desktop-linux` / `rancher-desktop`) inside the engine wait loop so it probes the engine it actually started, and `~\.rd\bin` no longer shadows an existing docker CLI on PATH.
- **2026-07-10** — Corporate-device bulletproofing (prompted by a live Win10 Enterprise 22H2 failure where even installing winget manually fails on MSIX framework dependencies — "app package not supported…"):
  - **Hardened downloads**: every fetch retries with backoff, forces TLS 1.2(+1.3 when available), honors `HTTPS_PROXY`, validates magic bytes (PE `MZ` / OLE2 MSI / `PK` zip) + realistic minimum sizes so proxy HTML block-pages are never executed, and `Unblock-File`s the result (Mark-of-the-Web/SmartScreen). Git resolution falls back from the GitHub releases API (rate-limited on corporate NAT) to a pinned known-good version. ARM64 machines get the correct Git/Docker/WSL-kernel artifacts.
  - **Offline/pre-seeded installers**: `Resolve-LocalInstaller` checks `OM_INSTALLERS_DIR`, an `installers/` folder in the repo root, next to the `.bat`, and next to the script — IT drops the official installers there and the launcher needs no network. Corrupt seeded files are skipped (magic-validated per candidate), not allowed to shadow valid ones.
  - **Git is no longer a hard dependency**: standalone mode falls back to downloading the branch ZIP (`Expand-Archive`) when Git is unavailable — pairing with `-NoAdmin` for fully unprivileged bootstrap on IT-provisioned machines.
  - **Rancher Desktop support** (`-Runtime auto|docker|rancher`): detection (machine-wide and per-user installs), `~\.rd\bin` PATH handling, start via `rdctl start --container-engine.name=moby --kubernetes.enabled=false` (dockerd/moby is required for `docker compose`), direct MSI install with API→pinned fallback for clean machines, and `docker-users` group handling scoped to Docker Desktop only. Relevant where Docker Desktop licensing is not permitted. **Needs live validation on a Rancher machine.**
  - **Constrained Language Mode preflight**: AppLocker/WDAC CLM is detected up-front with an actionable message instead of cryptic mid-run .NET errors.
  - **Prerequisite report + step expectations + spinners**: every run prints a present/MISSING table for Git/WSL2/container runtime; each step header states its expected duration ("instant" / "~10 minutes on first boot"); all polling loops render an animated spinner with elapsed time and a plain-language description so long waits never look like hangs.
  - **winget is no longer required.** App Installer is absent on Windows LTSC, Server SKUs, and many locked-down corporate images (and can't always be added when the Store is disabled), which made the preflight hard-fail. winget is now a fast path only: when it's missing (or fails), the launcher falls back to direct downloads of the official installers — the latest Git for Windows 64-bit installer (resolved via the git-for-windows GitHub releases API) and Docker Desktop from its stable `desktop.docker.com` URL — run silently (`/VERYSILENT …` and `install --quiet --accept-license --backend=wsl-2`). WSL2 enablement never needed winget (it uses `Enable-WindowsOptionalFeature`). The preflight downgrades the winget check from fatal to informational.
  - **Lean `dev` Dockerfile stage.** The `dev` target (used only by `docker-compose.fullapp.dev.yml`) previously baked a full `yarn install` + `yarn build:packages` into the image, which `dev-entrypoint.sh` then redoes unconditionally at container start into the bind-mounted volumes. The stage is now just the OS toolchain + corepack + entrypoint scripts, so the image builds in seconds and the entrypoint owns the single install/build pass — roughly halving cold first-boot. The native-module build toolchain (python3/make/g++) is retained for the entrypoint's runtime install. `builder`/`runner` (production) stages are unchanged. **Needs live Docker validation** (build + first boot) on the target.
