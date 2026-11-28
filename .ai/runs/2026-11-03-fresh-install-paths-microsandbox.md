# Fresh-install paths from the README, tested in clean microVMs

Date: 2026-11-03 · Branch: `cez/bd3de6af` · Tested against: `main` @ `501cdb9dc`, npm `create-mercato-app@latest` (0.9.0) and `@develop` (0.10.1-develop.7907, the `main` snapshot), PRs #8612 @ `728b938` and #8613 @ `f7c7dae`.

## How it was tested

Every path ran in its own disposable [microsandbox](https://github.com/superradcompany/microsandbox) microVM (msb 0.7.13, libkrun on Apple Silicon), so nothing touched the host's own Docker services:

- Base image: Debian 12 (arm64), 8 vCPU, 16 GB RAM, 60 GB ext4 root, Docker 29.9 + Compose v5 **inside** the VM, a non-root `dev` user.
- Toolchain installed exactly as the README says: `curl https://mise.run | sh` and `mise use -g node@24 yarn@4` (Node 24.22.2, Yarn 4.18.1).
- Each scenario is a copy-on-write fork of that base, driven non-interactively (stdin not a TTY, as an agent would run it).
- Checks after start: `GET /login` = 200, `/backend` = 307, `/api/healthz` = 200, `POST /api/auth/login` as `admin@acme.com` / `secret`, then demo data counts from `/api/customers/companies`, `/api/customers/people`, `/api/sales/orders`, `/api/catalog/products`, `.agents/skills/om-help` present, and a deduplicated list of every `WARN`/`ERROR` in `.mercato/logs/*`.
- Standalone apps built from source (PRs and this branch) were scaffolded from the ref's own packages through the documented Verdaccio flow (`yarn registry:publish` + `create-app --verdaccio`).

## Results by README path

| Path (README section) | Source | Result | Time to `/login` 200 |
|---|---|---|---|
| Minute 10: `create-mercato-app --preset classic --agents all --init-git` + `yarn setup` | npm `latest` 0.9.0 | **Fails** at `db:migrate`: PostgreSQL refused | — |
| same, `--preset crm` / `--preset wms` | npm `latest` 0.9.0 | **Fails** (same) | — |
| same, `--preset classic` | npm `develop` (= main) | Pass, demo data present | 3 m 38 s |
| `--preset crm` | npm `develop` | Pass, migrations + init OK, login OK | not recorded |
| `--preset empty` | npm `develop` | Pass, login OK | not recorded |
| `--preset wms` | npm `develop` | **Fails** at `db:migrate`: `relation "message_channel_links" does not exist` → fixed here | — |
| Plain `npx create-mercato-app my-app` without a terminal | npm `develop` | Pass; picks classic + claude-code + no git, as documented | 4 m 48 s |
| `yarn setup --no-infra` with own PostgreSQL/Redis/Meilisearch on custom ports | npm `develop` | Pass | 4 m 10 s |
| Build and publish a module: `npx create-mercato-module init visits` | npm `develop` | Module created and registered; `/backend/visits` 404 until `yarn dev` restarts (200 after) → README corrected | — |
| Start the coding agent: `npx cezar-run` | npm | Pass, `http://localhost:4321` = 200 | seconds |
| Change Core: `npx @open-mercato/starter` | main | **Stops** at step 7/9 without an LLM key ("Pass --skip-llm-prompt") → fixed by #8612; clone took minutes (full history) → fixed here | — |
| Change Core: "Already have a clone? Run `yarn om`" | main | **Fails** in a fresh clone: `Couldn't find the node_modules state file`; `npx @open-mercato/starter` inside a clone fails with `om-start: not found` → docs fixed here | — |
| Monorepo first run `node packages/starter/bin/om-start.mjs up --skip-llm-prompt` | this branch | Pass, demo data present | 7 m 03 s |
| Docker dev setup (docs quick start, `compose.fullapp.dev.yml up --build`) | main | Pass, but with the PostgreSQL errors, MCP and Keycloak warnings below → fixed here | 13 m 16 s |
| Standalone app from source via Verdaccio (`yarn registry:publish`) | main / PRs / this branch | **Fails**: `413 Payload Too Large` publishing `@open-mercato/core` → fixed here | — |
| Standalone classic / wms from this branch via Verdaccio | this branch | Pass, pass (wms now migrates) | 3 m 03 s / 1 m 21 s |
| Dev Container, Open Mercato Cloud, `cezar-run server-install`, `mercato deploy railway` | — | Not tested: needs VS Code, an account, a VPS or a Railway token | — |

## PR #8612 (`fix/starter-optional-llm-provider`)

- Monorepo first run in a fresh VM, **no LLM key**: passes all 10 steps (step 7 "AI provider (optional)" continues without AI), ready in 6 m 33 s, login and demo data OK.
- Standalone classic from the PR's packages with plain `yarn setup`: passes in 3 m 21 s, starts and health-checks the Compose services.
- Not in this PR (fixed on `cez/bd3de6af`): the init warnings below; standalone peer warnings.

## PR #8613 (`feat/setup-service-modes`)

- **Regression for the README's Minute-10 path:** in a fresh environment a non-interactive `yarn setup` now defaults to reusing services (`--no-infra`). Nothing is running, so it stops: `PostgreSQL connection failed (DATABASE_URL at postgres://localhost:5432/open-mercato)`. The README promises `yarn setup` "starts and health-checks PostgreSQL, Redis and Meilisearch"; that only holds with an explicit `--infra`. Suggested fix: reuse only when the configured services answer, otherwise start Compose (or keep `--infra` as the non-interactive default).
- The monorepo first run without an LLM key still stops at step 7/9, because #8613 does not include #8612's optional-AI change.
- `yarn setup --infra`: pass (3 m 11 s).
- `yarn setup --random-ports` while another app holds 5432/6379/7700: pass in 61 s; isolated stack `mercato-<hash>` on random ports, matching URLs saved to `.env`.
- `yarn setup --ephemeral` alongside both: pass in 50 s; all three connections verified, Testcontainers removed when the session stopped.

## Errors and warnings found, and what was done

| # | Symptom (where) | Root cause | Fix (commit) |
|---|---|---|---|
| 1 | 0.9.0 `yarn setup` fails at `db:migrate` (all presets) | Published 0.9.0 `setup.mjs` never starts infra; the README already documents the `main` behaviour | Release timing, nothing to change on `main`. Next release resolves it |
| 2 | wms: `relation "message_channel_links" does not exist` | `customers` migration `Migration20260825140000` backfills from tables of the optional `communication_channels` module, which wms does not enable | Backfill only when both tables exist (`68ad08156`) |
| 3 | `YN0060` bullmq-otel, `YN0002` react-is, `YN0086` on every install | Packages depending on core/ui did not pass their peers through; app/template lacked `react-is`; bullmq 6 needs bullmq-otel ≥ 2; `@opentelemetry/api ^1.9.1` resolved 1.10 against an SDK that needs < 1.10; storage-s3 peered MikroORM 6 | Peers declared, bullmq-otel 2, API `~1.9.1`, queue uses the options-object constructor both majors accept (`84ae0aca6`). Only one generic third-party `YN0086` remains |
| 4 | ~95 × `[query_index:reindexer] Refusing tenant-scoped reindex of a table with no tenant_id column` during init | `query_index reindex --tenant` looped over every entity type, once per partition, including tenant-less tables | Skip tenant-less types up front; guard kept for real misuse (`0057921ba`) |
| 5 | `[shared:data-engine] Emitting undeclared event … context=setCustomFields` | The derived `<module>.<entity>.updated` id is the deliberate custom-field change signal `query_index` subscribes to, not a domain event | No registry check on that path; emission unchanged (`0a1c6ce3e`) |
| 6 | 8 × `sales.examples missing catalog match` | Demo lines referenced a non-existent SKU; free-text lines were not marked custom | Real SKU; custom lines flagged like the UI does (`522306f41`) |
| 7 | PostgreSQL `column "organization_id" does not exist` for `feature_toggles` | Search subscribers resolved scope with a hard-coded `select organization_id, tenant_id` | Scope columns from ORM metadata or a cached probe; no select when absent (`322e792ab`) |
| 8 | PostgreSQL `no unique or exclusion constraint matching the ON CONFLICT specification` (`custom_entities_storage`) | The "unique" index was created as a plain index, so every upsert failed into a fallback; the swallowed error also aborts an enclosing transaction | Scoped update-then-insert, no `ON CONFLICT`, same semantics (`016e1165c`) |
| 9 | Docker dev: `MCP API key provisioning failed: EROFS` every 30 s | The app container's `yarn dev` started its own MCP and wrote into the read-only key volume the dedicated `mcp` service owns | `OM_DEV_WITH_MCP=0` on the app service + regression test (`2f8183014`) |
| 10 | Keycloak `KC-SERVICES0110` deprecation warnings | Keycloak 26 renamed bootstrap admin variables | `KC_BOOTSTRAP_ADMIN_*`, still reading `KEYCLOAK_ADMIN*` (`ca349df4a`) |
| 11 | Standalone `[auth:jwt] JWT_SECRET is set to a placeholder value…` on every start | Template `yarn setup` copied `.env.example` verbatim (`change-me-dev-secret`), unlike the monorepo starter | Generate `JWT_SECRET`, `AUTH_SECRET`, `LOOKUP_HASH_PEPPER` when `.env` is created (`3d1ae30a3`) |
| 12 | `yarn registry:publish`: `413 Payload Too Large` for `@open-mercato/core` | Core packs to 41 MB (~55 MB base64 on the wire) > Verdaccio `max_body_size: 50mb` | 200mb (`b4add01a8`) |
| 13 | After `create-mercato-module init`: `[OpenAPI] Bundle approach failed … Unexpected end of input`, schemas dropped | Dev watcher and CLI `generate` shared one bundle path and executed each other's half-written file | Per-run bundle file, removed afterwards (`775cfc0a8`) |
| 14 | `npx @open-mercato/starter` spends minutes cloning | Full-history clone | `--filter=blob:none` (`a3ebbcace`) |
| 15 | `yarn om` / `yarn setup` / `npx @open-mercato/starter` fail inside a fresh clone | Yarn will not run a workspace script before the first install; npx resolves the uninstalled local package | README/CONTRIBUTING/starter README point first runs at `node packages/starter/bin/om-start.mjs` (`3b38b288b`) |
| 16 | Docs: "JWT_SECRET required, stack refuses to start" | True only for `compose.fullapp.yml`; the dev stack defaults to `JWT` | Docs corrected (`ceeb295e5`) |
| 17 | `/backend/visits` 404 after `create-mercato-module init` | Running dev runtime does not load newly generated module pages until restart | README says to restart once (`0f196aa53`); hot-loading is a follow-up |

Verified end to end in the VMs: on a `main`-based init, warnings 4, 5 and 6 appear 95 / 7 / 8 times; on this branch, 0 / 0 / 0. wms migrates, and the standalone classic install shows no `YN0060`/`YN0002`.

## Left as is (by design) and follow-ups

- By design, dev-only: `[shared:kms] Using derived tenant encryption keys` (no Vault), `[scheduler:local] … no cross-process protection`, `[ai_assistant:mcp-http] Binding beyond loopback host=0.0.0.0` on Linux (the OpenCode sidecar reaches MCP via `host-gateway`), `Password policy validation skipped for setup`, `OM_AUTO_SPAWN_WORKERS_LAZY_MODE is not set`.
- Fixed by #8612: Next.js `non-standard "NODE_ENV"` warning, starter blocking on a missing LLM key.
- Follow-ups:
  - The monorepo-only `[shared:module-overrides] Override did not match any registered entry … example:override-probe:widget` (8×): CLI processes apply injection overrides without the browser injection registry.
  - wms: `[events] Queued event dispatched to zero subscribers` for custom-field change signals when `query_index` is not enabled.
  - Hot-loading new module pages in `yarn dev`.
  - Making `custom_entities_storage_unique_idx` truly unique (needs a dedupe migration).
  - #8613 reuse default (above).
- Environment noise seen in the VMs, not product issues: Redis `Memory overcommit must be enabled`, npm "new major version" notices.

## Reproduce

Harness scripts (host side, outside the repo): `runs/bd3de6af-sandbox-tests/scripts/` in the cezar workspace (`run-scenario.sh <name> <script> KEY=VAL…` forks the base VM and runs one scenario).
