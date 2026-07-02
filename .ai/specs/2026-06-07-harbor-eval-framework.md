# Harbor Agent Evaluation Framework

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Mateusz Staniaszek |
| **Created** | 2026-06-07 |
| **Related** | `.ai/qa/AGENTS.md` (integration tests), `.ai/skills/om-integration-tests/SKILL.md`, `packages/create-app/` (scaffold), `packages/core/src/modules/customers/` (CRUD reference) |

## TLDR

**Key Points:**
- Stand up a [Harbor](https://www.harborframework.com)-based evaluation framework that measures how well pinned agentic coding agents (**Claude Code** and **Codex**) complete real Open Mercato build tasks inside a freshly scaffolded standalone app.
- The framework runs **on every Open Mercato release** (plus manual dispatch, plus a temporary PR trigger for testing) so we can detect whether the OM *developer harness* (APIs, conventions, AGENTS.md guidance) is improving or deteriorating over time.
- The **independent variable is the OM release** (`npx create-mercato-app@X.Y.Z` pins every `@open-mercato/*` dep to `X.Y.Z`). The **agents are the controlled variable**: Claude Code → `claude-opus-4-8`, Codex → `gpt-5.5`, with CLI versions and model IDs pinned and recorded per run.
- Tasks are authored in SWE-bench style (FAIL_TO_PASS + PASS_TO_PASS + a convention rubric). The first task, **`app-OME-FEAT-001`** (create a `bookmarks` CRUD module), is implemented end-to-end and proven green by the Harbor `oracle` agent.
- The verifier is **TypeScript-native** (`verify.mjs`, no Reward Kit / no Python). It emits a **rich multi-dimensional `reward.json`** matching the task's `judge_output_schema`.
- Execution runs on **Daytona** sandboxes (multi-container via `docker-compose.yaml`: `main` agent container + `postgres` + `redis` + `meilisearch`). Result records are pushed to an **S3 bucket** via GitHub Actions **OIDC** (Harbor Hub deferred).

**Scope:**
- A reusable `evals/` framework in the open-mercato monorepo: shared environment, agent config, verifier harness, S3 result push, and CI workflow.
- One fully implemented and oracle-verified task: `app-OME-FEAT-001` (bookmarks CRUD).

**Concerns:**
- Harbor Hub headless auth is unconfirmed → results go to S3 instead (for now).
- Daytona restricts outbound network by default; `yarn install` / `npx` need network access — must be explicitly allowed.
- The hidden FAIL_TO_PASS suite is **Playwright over HTTP** and requires a fully booted app (build → migrate → init → start), not a simple Jest run.

## Problem Statement

We change the Open Mercato platform constantly — new APIs, new conventions, new AGENTS.md guidance. We have no objective, repeatable signal for whether those changes make it *easier or harder* for a competent coding agent to build correctly on Open Mercato. Anecdotes ("the agent got confused by X") are not a trend line.

We want a per-release benchmark that holds the agent fixed and varies the OM release, so a regression in the score localizes to *our* harness, not to a silent model/CLI update. Two agents (Claude Code and Codex) give us cross-agent corroboration: if both drop on the same release, the regression is almost certainly ours.

## Decision Log

These decisions were resolved during planning and are binding for the implementation.

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Harbor** is the harness (not Inspect AI). | Matches available tooling and stated intent. The `x_om.run_model.harness = "Inspect AI"` text in the task JSON is legacy and is ported to Harbor. |
| 2 | Framework lives **inside the open-mercato monorepo** under `evals/`. | Single PR surface; travels with the code it benchmarks. |
| 3 | **OM release is the independent variable; agents are pinned.** Claude Code → `claude-opus-4-8`; Codex → `gpt-5.5`. CLI versions + model IDs recorded per run. | Isolates OM-harness quality from model/CLI drift. |
| 4 | OM release pinned via **`npx create-mercato-app@X.Y.Z`** (CLI version == release; pins all `@open-mercato/*`). | Confirmed in `packages/create-app`: the template uses a `{{PACKAGE_VERSION}}` placeholder set to the CLI version. |
| 5 | Agents are **Harbor-native** (`-a claude-code`, `-a codex`). | Confirmed in Harbor source (`AgentName` enum, installed agents). |
| 6 | **Verifier is TypeScript-native (`verify.mjs`)**; Reward Kit dropped. | Team writes TS; ts-morph makes AST checks natural; one language. |
| 7 | Verifier runs in the **shared (agent's) container** after the agent finishes; hidden tests injected at verify time; out-of-bounds edits caught by git-diff + a hashed snapshot of `node_modules/@open-mercato`. | No rebuild; trusted-agent threat model. |
| 8 | Reward is a **rich multi-dimensional `reward.json`** (boolean `passed` + continuous component/per-criterion scores). | A boolean throws away the gradient needed for trend detection. |
| 9 | Execution on **Daytona**, multi-container via `docker-compose.yaml` (`main` + `postgres` + `redis` + `meilisearch`). | Confirmed Daytona supports compose (DinD); full OM stack needs all three services to boot. |
| 10 | CI: GH Actions on `release: published` + `workflow_dispatch` + **temporary `pull_request`** trigger. | Per-release trend + manual reruns; PR trigger validates the pipeline during bring-up and is removed afterward. |
| 11 | Results pushed to an **S3 bucket via GitHub OIDC** (role ARN + bucket provided later). Harbor Hub deferred. | Hub headless auth + trend API unconfirmed; S3 + OIDC is a known-good headless path. |
| 12 | Scope = **reusable framework + `app-OME-FEAT-001`** implemented and oracle-green. | Generic enough that task #2 is a new directory; proven on one real task. |

## Architecture

### Repository layout

```
evals/
├── AGENTS.md                         # How to add/run a task; conventions
├── dataset.toml                      # Harbor DATASET manifest (open-mercato/harness-evals) — registry of all tasks
├── lib/                              # Shared, task-agnostic verifier harness (TS)
│   ├── verify-core.ts                # orchestration: P2P -> F2P -> rubric -> judge -> reward.json
│   ├── app-runner.ts                 # build / migrate / init / start / stop the scaffolded app
│   ├── edit-guard.ts                 # git diff + node_modules/@open-mercato hash snapshot
│   ├── ast/                          # ts-morph rubric helpers (entity, validators, route, acl)
│   ├── judge.ts                      # Anthropic API LLM judge (pinned model)
│   ├── reward.ts                     # assembles reward.json per judge_output_schema
│   └── s3-push.ts                    # writes record path for CI to upload
├── tasks/
│   └── app-OME-FEAT-001/             # Harbor task directory (bookmarks CRUD)
│       ├── instruction.md            # Prompt shown to the agent (problem_statement)
│       ├── task.toml                 # Harbor config + metadata + agent/env pins
│       ├── environment/
│       │   ├── docker-compose.yaml   # main + postgres + redis + meilisearch
│       │   └── Dockerfile            # main image: node, yarn, git, playwright deps
│       ├── tests/
│       │   ├── test.sh               # thin wrapper -> `node verify.mjs`
│       │   ├── verify.mjs            # built from lib/ + task rubric (bundled)
│       │   ├── rubric.ts             # the 8 criteria (C-REUSE-1 ... C-SCOPE-1)
│       │   └── hidden/TC-BKM-001.spec.ts  # FAIL_TO_PASS Playwright spec (never shown to agent)
│       ├── solution/solve.sh         # oracle reference implementation of the module
│       └── README.md                 # what the task does, env, verifier, how to run
└── results/                          # (optional) local mirror of pushed records
```

`evals/lib` is the reusable core. Each task's `tests/verify.mjs` is **bundled** (esbuild) from `evals/lib` + the task's `rubric.ts` at task-build time so the verifier is self-contained inside the container (Harbor copies only `tests/` into the verifier context).

**Tasks are kept as a Harbor dataset.** `evals/dataset.toml` (`open-mercato/harness-evals`) is the canonical registry: it lists every task by `name` (`open-mercato/<task-id>`) + content `digest`. Each task's own `task.toml` carries a `[task]` section with its `name`. Add/refresh tasks with `harbor add evals/tasks/<id> --to evals/dataset.toml` then `harbor sync evals/dataset.toml`. CI runs the dataset (`harbor run -p evals/dataset.toml …`) and can `harbor publish` it. A CI check should fail if `harbor sync` would change a digest (manifest out of sync with task contents).

### Environment (Daytona / docker-compose)

`environment/docker-compose.yaml` declares the multi-container topology Harbor + Daytona require. The agent container **must be named `main`**.

```yaml
services:
  main:
    build: .
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      meilisearch: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://mercato:mercato@postgres:5432/mercato
      REDIS_URL: redis://redis:6379
      MEILISEARCH_HOST: http://meilisearch:7700
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: mercato, POSTGRES_PASSWORD: mercato, POSTGRES_DB: mercato }
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U mercato"], interval: 5s, timeout: 5s, retries: 10 }
  redis:
    image: redis:7
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, timeout: 5s, retries: 10 }
  meilisearch:
    image: getmeili/meilisearch:v1.10
    healthcheck: { test: ["CMD", "curl", "-f", "http://localhost:7700/health"], interval: 5s, timeout: 5s, retries: 10 }
```

- Services are reachable from `main` by **service-name DNS** (`postgres`, `redis`, `meilisearch`).
- The `main` `Dockerfile` provides Node (matching scaffold engine), Yarn, git, and Playwright browser/system deps (the FAIL_TO_PASS suite is Playwright-driven, though it uses `APIRequestContext` HTTP only — no browser navigation, so a headless minimal install is sufficient).
- **Network:** `task.toml` `[environment].network_mode` must allow outbound (Daytona restricts by default) so `npx create-mercato-app`, `yarn install`, and the agent's model API calls work. Confirm the Daytona network allowance (e.g. `HARBOR_NETWORK`) during bring-up.
- Concrete env values (DB/redis/meili URLs) are passed through to the scaffold's `.env` during setup.

### Execution model (resolved)

A Harbor compose environment keeps **all services up for the entire task lifecycle** (agent *and* verifier phases). The only thing that must pre-exist before the agent is the scaffolded app. Work therefore splits cleanly:

- **Image build time (`environment/Dockerfile`, services NOT up, network available):** scaffold `create-mercato-app@${OM_VERSION}` (`--skip-agentic-setup --no-init-git`), write `.env` to the compose service hostnames, `yarn install`, `yarn generate` (twice), then capture the **edit-guard baseline**: a git commit (`/opt/evals/base_commit`) and a content-hash manifest of `node_modules/@open-mercato` (`/opt/evals/om-packages.sha1`). `OM_VERSION` is an `ARG` (default `latest`); CI passes `--build-arg OM_VERSION=X.Y.Z` per release.
- **Agent phase (services up):** the agent edits `/app/eval-app/**`. Because Postgres/Redis/Meili are up, the agent runs `yarn generate` / `yarn db:generate` / `yarn db:migrate` as part of solving — exactly as a developer would.
- **Verifier phase (services up, `verify.mjs`):** seed the tenant/admin non-interactively (`mercato auth setup … admin@acme.com/secret`), `yarn db:migrate` (idempotent), `yarn build` (P2P), `yarn generate` content-diff (P2P), boot the app, inject + run the hidden Playwright suite (F2P), ts-morph rubric, optional LLM judge, then write `/logs/verifier/rewards.json` + the artifact record.

> **Reward file:** Harbor 0.13 reads `/logs/verifier/rewards.json` (multi-metric) or `/logs/verifier/reward.txt` (scalar). The framework writes `rewards.json`.

The Dockerfile performs the build-time half; the equivalent local-repro sequence is:

```bash
# non-interactive scaffold; pins @open-mercato/* to ${OM_VERSION}
npx create-mercato-app@${OM_VERSION} eval-app --preset empty --skip-agentic-setup --no-init-git
cd eval-app
# wire .env to the compose service hostnames (postgres/redis/meilisearch)
export YARN_ENABLE_IMMUTABLE_INSTALLS=0   # fresh scaffold ships a minimal lockfile; first install must materialize it (YN0028)
yarn install
yarn generate
yarn generate          # run twice so structural-cache mtime touches settle (PASS_TO_PASS compares CONTENT, not mtime)
yarn db:migrate        # against the live postgres service
# non-interactive tenant+admin provisioning (guarantees admin@acme.com/secret that the integration helper expects)
yarn mercato auth setup --orgName Acme --orgSlug acme --email admin@acme.com --password secret --json
yarn build             # baseline must exit 0
git init && git add -A && git commit -m "baseline scaffold @${OM_VERSION}"   # base_commit for edit-guard
```

The committed baseline is the `base_commit`/`environment_setup_commit`. The edit-guard diffs against it.

**Bring-up checks (must confirm once, before the first oracle run):**
- **Network:** Daytona restricts outbound by default; `[environment].network_mode` must allow `npx`/`yarn install`/model API calls.
- **Seeded-admin identity:** the hidden suite authenticates as `admin@acme.com/secret` (the `@open-mercato/core` integration helper default). Confirm `yarn mercato init` seeds exactly that account; otherwise seed/override it. `app-runner.ts` asserts a successful login before running the suite so a mismatch fails loud, not as a false agent failure.
- **Webhook env:** `--preset empty` omits checkout/gateway demos; if any setup path needs it, mirror the env contract (e.g. `MOCK_GATEWAY_WEBHOOK_SECRET`) from `scripts/test-create-app-integration.ts`.

> **Preset note:** `--preset empty` gives a builder-ready baseline (core essentials, demo modules removed) — the right blank canvas for a from-scratch module task. (Confirmed presets: `classic`, `empty`, `crm`.)

### Agent configuration

Per agent, per release — recorded in each result record:

| Agent | Harbor invocation |
|-------|-------------------|
| Claude Code | `harbor run -p evals/tasks/app-OME-FEAT-001 -e daytona -a claude-code -m anthropic/claude-opus-4-8 --agent-kwarg version=<pinned> --agent-env ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY` |
| Codex | `harbor run -p evals/tasks/app-OME-FEAT-001 -e daytona -a codex -m openai/gpt-5.5 --agent-kwarg version=<pinned> --agent-env OPENAI_API_KEY=$OPENAI_API_KEY` |

- `--agent-kwarg version=<v>` pins the CLI (`npm i -g @anthropic-ai/claude-code@<v>` / `@openai/codex@<v>`). Exact pinned versions are chosen at bring-up and stored in `task.toml`/CI vars.
- `gpt-5.5` exact model ID is confirmed against the pinned Codex CLI at wiring time.
- The agent works only in `eval-app/`; the prompt (`instruction.md`) states edits are confined to `eval-app/**`.

### Verifier (`verify.mjs`) flow

Runs in the `main` container after the agent finishes. `tests/test.sh`:

```bash
#!/bin/bash
set -uo pipefail
node /tests/verify.mjs
```

`verify.mjs` orchestration (via `evals/lib/verify-core.ts`):

1. **Edit guard (C-REUSE-1, files_changed):** `git -C eval-app diff --name-only base_commit` → `files_changed`. Assert every path is under `eval-app/`. Re-hash `node_modules/@open-mercato/**` against the baseline manifest; any mismatch → `C-REUSE-1` fail and `passed=false`.
2. **PASS_TO_PASS:**
   - `yarn build` exits 0.
   - `yarn generate` produces **no content-level git diff** (`git diff --quiet` ignores mtime; the structural-cache post-step touches `*.generated.*` mtimes without changing bytes, so only content matters).
   - Pre-existing scaffold tests remain green.
3. **FAIL_TO_PASS:** copy `tests/hidden/TC-BKM-001.spec.ts` into the app, start the built app (`app-runner.ts`: `next start` against the live services, on a known port), set `BASE_URL`, run the spec with the OM Playwright config, capture per-assertion pass/fail. Teardown the server.
4. **Rubric (authoritative AST/fs):** run `rubric.ts` ts-morph + fs checks against the agent's files; produce `{id, score, weight}` per programmatic criterion.
5. **Rubric (LLM judge):** for criteria not decidable programmatically (e.g. `C-SCOPE-1`), call the Anthropic API with a **separately pinned judge model** (default `claude-opus-4-8`), citing the named rule; record rationale.
6. **Assemble `reward.json`** (see schema below) and write to `/logs/verifier/reward.json`. Also write the full `judge_output_schema` record to `/logs/artifacts/<agent>-<run_id>.json` for S3 upload.

`verdict_rule`: `passed = (all FAIL_TO_PASS pass) AND (all PASS_TO_PASS pass) AND (rubric_score >= 0.85)`.

### Reward schema

`reward.json` (Harbor reads this for the scalar/dimension reward) carries:

```json
{
  "passed": 0,
  "rubric_score": 0.0,
  "fail_to_pass_rate": 0.0,
  "pass_to_pass_rate": 0.0,
  "criterion__C-REUSE-1": 0,
  "criterion__C-REUSE-2": 0,
  "...": 0
}
```

The full record written to artifacts/S3 conforms to the task's `judge_output_schema`:
`instance_id`, `agent`, `run_id`, `passed`, `fail_to_pass{test_node->pass|fail}`, `pass_to_pass{...}`, `files_changed[]`, `rubric[{id,score,weight,rationale}]`, `rubric_score`, `notes`, plus `om_version`, `agent_cli_version`, `model_id`, `judge_model_id`, `created_at`.

### Rubric → check mapping (task `app-OME-FEAT-001`)

Paths normalized to the standalone scaffold (`eval-app/src/modules/bookmarks/...`), not `apps/eval-app/...`.

| ID | W | Check | How |
|----|---|-------|-----|
| C-REUSE-1 | 3 | fs | git diff confined to `eval-app/**`; `node_modules/@open-mercato` hash unchanged. |
| C-REUSE-2 | 3 | ast | `makeCrudRoute` imported from `@open-mercato/shared/lib/crud/factory`; no bespoke GET/POST handlers; no raw SQL in route. |
| C-PLACE-1 | 2 | fs | Module at `eval-app/src/modules/bookmarks/` with `data/`, `api/`, `acl.ts`, `index.ts`, `migrations/`; registered in `eval-app/src/modules.ts` as `{ id: 'bookmarks', from: '@app' }`. |
| C-NAME-1 | 2 | ast | Module name plural snake_case (`bookmarks`); table snake_case; features `bookmarks.view`/`bookmarks.manage` (module.action). |
| C-ENTITY-1 | 2 | ast | UUID PK; snake_case columns; indexed `organization_id` + `tenant_id`; `deleted_at`, `created_at`, `updated_at`; `note` nullable. |
| C-VALID-1 | 2 | ast | zod present; `url` validated (`z.string().url()`); `note` optional; types via `z.infer`; no new `any`. |
| C-MIG-1 | 2 | fs+ast | Real `Migration<14-digit-ts>*.ts` with `up()`+`down()` (CLI-created, not `schema:update`, not hand-numbered). |
| C-AUTH-1 | 2 | ast | Per-method metadata with `requireAuth` + `requireFeatures`; no top-level `export const requireAuth`. |
| C-SCOPE-1 | 1 | judge | Minimal/idiomatic: no spurious events/subscribers/widgets for plain CRUD. |

`rubric_score = sum(weight*score)/sum(weight)`.

> **Optimistic locking note:** OM optimistic locking is default-ON via `makeCrudRoute`. The entity therefore carries `updated_at` and the list/detail responses return `updatedAt`. The rubric/judge MUST NOT penalize the agent for this default behavior (it is correct, not "spurious scope"), and C-SCOPE-1 only flags *invented* events/subscribers/widgets.

### Task `app-OME-FEAT-001` artifacts

- **`instruction.md`** — the `problem_statement`: add an app-level `bookmarks` module (required `title`, required `url`, optional `note`), full CRUD over **`/api/bookmarks`**, feature-gated, with migration + registration; reuse OM building blocks; do **not** modify `node_modules` / `@open-mercato/*`.
- **`solution/solve.sh`** (oracle) — writes the canonical module under `eval-app/src/modules/bookmarks/`:
  - `data/entities.ts` — `@Entity({ tableName: 'bookmarks' })`, UUID PK (`gen_random_uuid()`), `title` text, `url` text, `note` text nullable, `tenant_id`/`organization_id` uuid (indexed), `created_at`/`updated_at`/`deleted_at`; decorators from `@mikro-orm/decorators/legacy`.
  - `data/validators.ts` — zod create/update/list (`url` → `z.string().url()`, `note` optional), `z.infer` types.
  - `acl.ts` — `bookmarks.view`, `bookmarks.manage` (`module: 'bookmarks'`, `manage` dependsOn `view`).
  - `api/route.ts` — flat `/api/bookmarks`; `makeCrudRoute` from `@open-mercato/shared/lib/crud/factory`; per-method `metadata` (`requireAuth` + `requireFeatures`); `orm` scoping (`tenantField`/`orgField`/`softDeleteField`); `indexer: { entityType: E.bookmarks.bookmark }`; list `fields` include `note`; exports `{ metadata, GET, POST, PUT, DELETE }`.
  - `index.ts` — `ModuleInfo` metadata (`name: 'bookmarks'`).
  - `setup.ts` — `defaultRoleFeatures` granting `bookmarks.*` to admin/superadmin.
  - `migrations/Migration<ts>_bookmarks.ts` — `up()` create table, `down()` drop.
  - register in `src/modules.ts`; run `yarn generate`.
- **`tests/hidden/TC-BKM-001.spec.ts`** — Playwright HTTP spec using `apiRequest`/`getAuthToken` from `@open-mercato/core/helpers/integration/api`:
  - POST `/api/bookmarks` `{title,url,note}` as authorized user → 2xx, returns `id`.
  - GET `/api/bookmarks` → created row present, `title`/`url`/`note` echoed.
  - POST without `note` → 2xx and `note` is `null`.
  - POST with invalid `url` → 400.
  - GET with **no auth** → 401/403.

### CI workflow (`.github/workflows/evals.yml`)

- **Triggers:** `release: { types: [published] }`, `workflow_dispatch` (inputs: `om_version`, `agents`), and **`pull_request`** (temporary, bring-up only — removed once green).
- **`om_version`** resolves from the release tag (or dispatch input; PR uses the canary/current version).
- **Matrix:** `[claude-code, codex]`.
- **Steps:** install Harbor (`uv tool install harbor`) → `harbor run -e daytona -a <agent> -m <model> --agent-kwarg version=<pin>` with `OM_VERSION` injected → collect `/logs/artifacts/*.json`.
- **Result push:** GitHub OIDC → `aws sts assume-role` (role ARN provided later) → `aws s3 cp` records to `s3://<bucket>/open-mercato-evals/<om_version>/<agent>/<run_id>.json`.
- **Secrets/vars:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DAYTONA_API_KEY`, `EVALS_S3_BUCKET`, `EVALS_AWS_ROLE_ARN`. Placeholders until provided.
- A small `trend.mjs` (later) reads S3 records and renders a per-criterion trend across `om_version`s.

## Integration / Verification Coverage

This framework's own correctness is proven by:

- **Oracle run green:** `harbor run -p evals/tasks/app-OME-FEAT-001 -e docker -a oracle` → `reward.json.passed == 1`, `rubric_score == 1.0`, all FAIL_TO_PASS + PASS_TO_PASS pass. (Run on `-e docker` locally; `-e daytona` in CI.)
- **Negative controls (verifier sanity):** deliberately broken oracle variants must fail the intended criterion:
  - edit a file outside `eval-app/` → `C-REUSE-1` fail, `passed=false`.
  - hand-write a raw route handler → `C-REUSE-2` fail.
  - omit `url` validation → `C-VALID-1` fail and the invalid-url FAIL_TO_PASS assertion fails.
  - drop per-method auth → `C-AUTH-1` fail and the no-auth FAIL_TO_PASS assertion fails.
- **Real-agent smoke:** at least one `claude-code` and one `codex` run complete end-to-end on Daytona and produce a well-formed S3 record.

## Open Dependencies / Risks

1. **Daytona network allowance** for `npx`/`yarn install`/model APIs — confirm the exact mechanism (`HARBOR_NETWORK` / `network_mode = "public"`/allowlist) at bring-up.
2. **Pinned CLI versions** for `claude-code` and `codex`, and the exact **`gpt-5.5`** model ID — fix at bring-up, store in `task.toml`/CI vars.
3. **AWS OIDC role + S3 bucket** — provided later by the user; CI uses placeholders until then.
4. **Harbor Hub** push deferred; revisit if/when a non-interactive auth path is confirmed.
5. **Build/run time budget** on Daytona for full OM build + DB + Playwright — set `[agent].timeout_sec` / `[verifier].timeout_sec` generously and tune.

## Phasing

1. **Framework skeleton** — `evals/lib` harness (verify-core, app-runner, edit-guard, ast, judge, reward, s3-push), `evals/AGENTS.md`, esbuild bundling of `verify.mjs`.
2. **Task `app-OME-FEAT-001`** — environment (compose + Dockerfile), `instruction.md`, `task.toml`, oracle `solve.sh`, hidden `TC-BKM-001.spec.ts`, `rubric.ts`, `README.md`.
3. **Oracle green + negative controls** — iterate until oracle passes and each negative control fails the intended criterion.
4. **CI** — `evals.yml` with release + dispatch + temporary PR triggers; OIDC→S3 push (placeholders).
5. **Real-agent smoke** — run claude-code + codex on Daytona; confirm records land in S3; remove the temporary PR trigger.

## Backward Compatibility

New top-level `evals/` directory and a new CI workflow; no changes to any existing contract surface, module, or generated file. The framework consumes the *published* `@open-mercato/*` packages and `create-mercato-app` as a black box — it does not modify them.

## Changelog

- 2026-06-07 — Initial draft (decision log captured from planning interview; pending implementation).
