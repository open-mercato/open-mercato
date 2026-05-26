# CI/CD Performance — Current State, Analysis & Proposed Changes

**Date:** 2026-04-10  
**Status:** Draft  
**Scope:** All GitHub Actions workflows, Turborepo configuration, Docker build pipeline, integration test architecture

---

## 1. What the CI/CD System Currently Does

There are five GitHub Actions workflows. Each has a distinct purpose.

### 1.1 `ci.yml` — Main Quality Gate

**Triggers:** Push or PR to `main` or `develop`.

**Purpose:** Ensure the codebase compiles, passes static analysis, unit tests, and integration tests before any code lands on a protected branch.

**Job graph (post-refactor, current branch state):**

```
prepare ──┐
           ├──► test ──────────────────────────────► merge-coverage
audit   ──┤                                              ▲
lint    ──┘── ephemeral-integration (parallel) ──────────┘
           └── docker-build (parallel, skipped for CI-only PRs)
```

Key properties:
- `docker-build` and `ephemeral-integration` both start the instant `prepare` finishes — they no longer wait for `test`.
- For CI/docs/scripts-only PRs (`skip_integration == 'true'`): `ephemeral-integration`, `docker-build`, and the app build in `prepare` are all skipped. Wall time = `prepare` (no app build, ~2.5 min) + `test` (~4 min) = **~6.5 min**.
- For module PRs: single shard runs in parallel with `test`; `docker-build` also runs in parallel.

| Job | What it does | Why |
|-----|-------------|-----|
| `prepare` | Install deps, build all packages twice (before and after `generate`), upload `dist/` + `.mercato/generated/` artifact; also builds and uploads the Next.js app when integration tests will run | Packages must be compiled before any other job can typecheck or test them. The double build is required because `generate` produces TypeScript files that packages then import. App build is skipped for CI-only PRs since no integration shard will consume it. |
| `audit` | Install deps, `yarn npm audit --severity high` | Security gate — run in parallel with `prepare` since it only needs `yarn.lock`, not built packages. |
| `lint` | Install deps, run `yarn lint` (ESLint) | Fast static analysis — runs in parallel with `prepare`/`audit`, fails fast before heavy jobs. |
| `test` | Download artifact, install markitdown, run dep-version check, i18n sync/usage check, `tsc --noEmit`, Jest unit tests | Validates code correctness without a live server. Must run after `prepare` (needs compiled packages), `audit` (security gate), and `lint`. |
| `ephemeral-integration` | Download artifacts (packages + app build), install Playwright, boot the full app in-process, run Playwright specs | End-to-end validation that modules interact correctly. Starts in parallel with `test` — does not wait for unit tests. App build is shared from `prepare`. Skipped entirely for CI/docs/scripts-only PRs. |
| `docker-build` | Build three Dockerfiles using GitHub Actions layer cache | Validates production images build cleanly. Runs in parallel with `test` and `ephemeral-integration`. Skipped for CI/docs-only PRs to avoid 10+ min rebuilds caused by Docker layer cache busting (e.g. when `turbo.json` or `scripts/` change without app code changes). |

**Measured wall times (run 24178370484):**

```
prepare:                ~2m30s (estimated, not yet broken out)
audit:                  ~1m20s (parallel)
test:                    7m12s
  ├─ yarn install        1m03s
  ├─ typecheck           2m04s
  ├─ unit tests          1m17s
  └─ build:app           1m38s
ephemeral-integration:  48m47s
  ├─ yarn install        1m05s
  ├─ download artifact      ~5s
  ├─ build app           1m37s
  ├─ playwright install    25s
  └─ integration tests  44m59s  ← 82% of total wall time
docker-build:           16m17s  (parallel, not on critical path)

TOTAL WALL TIME:       ~55 minutes
```

### 1.2 `snapshot.yml` — Canary npm Releases

**Triggers:** Push to `develop`, or PR targeting `develop` or `main` (non-fork only).

**Purpose:** Publish a timestamped snapshot version of all public packages to npm with a canary dist-tag after every develop commit. Also validates that a consumer scaffolding a fresh app from the published snapshot can build and run integration tests successfully.

**Job graph:**

```
snapshot ──► standalone-integration
```

| Job | What it does |
|-----|-------------|
| `snapshot` | Install deps, compute channel/tag from branch/event, run `release-snapshot.sh` to bump versions + publish to npm, comment on PR with published versions |
| `standalone-integration` | Scaffold a brand new app via `create-mercato-app@<snapshot-version>`, wait for npm propagation (up to 5 minutes per package), configure env, build and start the app, run Playwright integration tests against it |

**Key design choice:** The standalone integration test validates that the *published npm packages* work correctly in a real consumer project — not just the monorepo source. This catches issues like missing exports, bad `package.json` `exports` fields, or mismatched peer dependencies that would not show up in monorepo integration tests.

**No concurrency group.** Two rapid pushes to `develop` both publish to npm. The second publish overwrites the first with the same tag.

### 1.3 `release.yml` — Production npm Releases

**Triggers:** Manual `workflow_dispatch` with `patch` / `minor` / `major` input.

**Purpose:** Publish a versioned production release to npm. Requires the `production` GitHub Environment to be configured with mandatory reviewers — prevents a single compromised account from publishing unilaterally.

**Key protections:**
- Only runs from `main` branch
- Requires human approval (GitHub Environment gate)
- Has a concurrency group (`${{ github.workflow }}-${{ github.ref }}`) — only one release can run at a time
- Creates a git tag and GitHub Release automatically

### 1.4 `qa-deploy.yml` — QA Environment Deployment

**Triggers:** Manual `workflow_dispatch`. Inputs: slot (`qa1` or `qa2`), branch, optional PR number.

**Purpose:** Build a Docker image from any branch and deploy it to a Dokploy-managed QA environment. Labels the PR and posts a comment with the deployment URL and image tag.

**Key design choice:** Two fixed QA slots rather than ephemeral preview environments. Slots are re-used across PRs, and the `qa-stop-on-merge.yml` workflow verifies the expected image matches before stopping to avoid race conditions.

**Concurrency group:** `dokploy-${{ slot }}` with `cancel-in-progress: false` — queues slot updates rather than cancelling. Safe because a cancelled deploy mid-flight would leave the slot in an unknown state.

### 1.5 `qa-stop-on-merge.yml` — QA Slot Cleanup

**Triggers:** Every PR `closed` event.

**Purpose:** When a PR that was deployed to a QA slot is merged or closed, stop the Dokploy application to reclaim resources. Guards against stopping the wrong deployment by comparing the PR's deploy comment image tag against what Dokploy currently has running.

---

## 2. Why the Current Implementation Is the Way It Is

### 2.1 Double `yarn build:packages`

The code generator (`yarn generate`) runs in the context of `@open-mercato/app` and produces TypeScript files in `apps/mercato/.mercato/generated/`. These generated files import types from packages like `@open-mercato/core`. Therefore:

1. Packages must be built first so the generator can import them (build #1)
2. Generator runs, producing new TypeScript source files
3. Packages that import generated types must be rebuilt against the new files (build #2)

This is not redundancy — it is a genuine two-pass compilation requirement.

### 2.2 Turbo `cache: false` Everywhere

`turbo.json` has `"cache": false` on every task. The reason is `"globalPassThroughEnv": ["*"]` — Turbo's cache key includes all environment variables, and passing through every env var means any change to any env var busts the cache. With `*` pass-through, Turbo's cache would have a near-zero hit rate in CI (different secrets, different `GITHUB_RUN_ID`, etc.), making it worse than no cache at all (wasted time checking stale entries).

The root fix is to replace `"*"` with an explicit list of env vars that actually affect build output.

### 2.3 Integration Tests with `workers: 1`

Playwright runs tests sequentially because the integration tests share a single ephemeral server instance and a single SQLite database. Running multiple workers against the same DB would cause test interference — e.g., one test deleting a record another test expects to exist. The current design optimises for correctness over speed.

### 2.4 No Concurrency Groups on `ci.yml`

This appears to be an oversight — every other workflow that could have concurrent runs has a concurrency group (`release.yml`, `qa-deploy.yml`). `ci.yml` and `snapshot.yml` do not.

### 2.5 QA Slot Image Comparison Before Stop

The guard in `qa-stop-on-merge.yml` that compares the expected image (from the PR comment marker) against what Dokploy currently has running is intentional: two PRs can share a slot (the second deploy overwrites the first), and merging the first PR should not stop the second PR's environment.

---

## 3. Current Developer Lifecycle

### Opening a PR

1. Developer pushes a branch and opens a PR targeting `main` or `develop`
2. CI triggers immediately:
   - `snapshot.yml` publishes a canary npm version (non-fork PRs only) and posts a comment with installable versions
   - `ci.yml` starts the quality gate
3. Developer waits **~55 minutes** for CI to complete
4. If CI passes and reviews are approved, the PR is mergeable

### Iterating on a PR

Each additional push to the branch re-triggers both workflows. With no concurrency cancellation, if a developer pushes 3 times in 10 minutes, all 3 CI runs complete fully. The developer is waiting 55 minutes from the last push before they know if everything is green.

### Deploying to QA

1. Developer manually triggers `qa-deploy.yml` via GitHub Actions UI, selecting a slot and branch
2. Workflow builds a Docker image from the branch (~15 min), pushes to GHCR, updates Dokploy, and triggers a deploy
3. PR is labelled `qa:qa1` or `qa:qa2` and a comment is posted with the image tag
4. On PR merge or close, `qa-stop-on-merge.yml` stops the Dokploy application

### Releasing to Production

1. Maintainer manually triggers `release.yml` with patch/minor/major
2. GitHub requires approval from a configured reviewer in the `production` environment
3. After approval, versions are bumped, packages published to npm, git tag created, GitHub Release created

---

## 4. Root Cause Analysis: Why CI Takes 55 Minutes

The problem has three layers:

### Layer 1: Integration tests run everything every time (80% of wall time)

All 311 integration spec files run on every push, regardless of what changed. A 3-line fix to `packages/core/src/modules/sales/` triggers tests for `auth`, `catalog`, `customers`, `currencies`, and 60+ other modules that were not touched.

### Layer 2: Turbo caching is entirely disabled

With `cache: false` on all tasks, every run rebuilds every package from scratch. A build that took 9 seconds on the previous identical commit takes 9 seconds again. There is no incremental compilation, no cross-run reuse, no cross-branch sharing.

### Layer 3: Ephemeral environment setup repeated across jobs

Before our recent refactor, `ephemeral-integration` re-ran `yarn install` (1m05s) + `build:packages` × 2 + `generate` (26s) from scratch. The refactor addressed this with artifact sharing — this layer is partially resolved.

### Combined effect

```
Change 1 file → rebuild 14+ packages → rerun 311 tests → 55 min
```

---

## 5. Proposed Changes

### 5.1 Turbo Cache: Fix `globalPassThroughEnv` and Enable Caching

**Change:** Replace `"globalPassThroughEnv": ["*"]` with an explicit allowlist of env vars that actually affect build output. Enable `"cache": true` for `build` and `typecheck`.

```jsonc
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "globalPassThroughEnv": [
    "NODE_ENV",
    "NODE_OPTIONS",
    "TURBO_TOKEN",
    "TURBO_TEAM"
  ],
  "tasks": {
    "build": {
      "cache": true,
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "typecheck": {
      "cache": true,
      "outputs": [".tsbuildinfo"]
    },
    "generate": {
      "cache": false,  // depends on module discovery — keep uncached
      "outputs": [".mercato/**"]
    }
    // test, lint: cache: false is correct (side-effecting)
  }
}
```

**Pair with Turbo remote cache.** Turbo's remote cache (Vercel free tier, or self-hosted `ducktape` / `turborepo-remote-cache`) shares build artifacts across branches. Branch A and branch B that both leave `packages/shared` untouched will both get a cache hit for `shared`'s build.

**Add to CI workflows:**

```yaml
env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ secrets.TURBO_TEAM }}
```

**Expected impact:** On a cache hit for unchanged packages, build time drops from ~2m30s to ~5–10s. For a typical PR touching 1–3 packages, 11+ other packages are cache hits.

---

### 5.2 Affected-Only Execution: `--filter=[origin/main]`

**Change:** Add `--filter=[origin/main]...` to all build and test commands in CI. Turbo will walk the dependency graph and only run tasks for packages whose source files changed since the last commit on `main`.

```yaml
# ci.yml — prepare job
- name: Build packages
  run: yarn build:packages --filter=[origin/main]...

- name: Prepare generated modules
  run: yarn generate
  # generate always runs (module discovery is global)

- name: Rebuild packages with generated files
  run: yarn build:packages --filter=[origin/main]...

# ci.yml — test job
- name: Checking types
  run: yarn typecheck --filter=[origin/main]...

- name: Test
  run: yarn test --filter=[origin/main]...
```

**Note:** `generate` and `build:app` must always run fully — generate discovers all modules, and the app depends on all packages.

**Expected impact:**

| PR changes | Packages built | Packages tested |
|---|---|---|
| 1 module in `packages/core` | 1–3 packages | 1–3 packages |
| `packages/shared` | All (everything depends on shared) | All |
| `packages/ui` only | `packages/ui` + `apps/mercato` | `packages/ui` |

For a typical PR: build time 2m30s → **15–30s**, unit test time 1m17s → **5–15s**.

---

### 5.3 Affected-Only Integration Tests

**Change:** Extend the integration test CLI to accept a `--modules` flag. The CI workflow computes affected module names from the git diff and passes them to the test runner, which filters `discoverIntegrationSpecFiles` output.

```bash
# Compute changed module names from git diff
CHANGED_MODULES=$(git diff origin/main --name-only \
  | grep -oP 'packages/core/src/modules/\K[^/]+' \
  | sort -u \
  | paste -sd,)

# If nothing module-specific changed, run full suite
if [ -z "$CHANGED_MODULES" ]; then
  yarn test:integration:coverage
else
  yarn test:integration:coverage --modules="$CHANGED_MODULES"
fi
```

The `mercato test:integration:coverage` CLI command passes extra args through to the test runner. The `discoverIntegrationSpecFiles` function in `packages/cli/src/lib/testing/integration-discovery.ts` already groups spec files by module name — filtering by module is a small extension.

**Expected impact:**

| PR changes | Specs run | Time |
|---|---|---|
| 1 module (e.g., `sales`) | ~20–30 specs | ~2–4 min |
| 3 modules | ~60–90 specs | ~6–9 min |
| `packages/shared` or `packages/core` root | All 311 specs | ~45 min (full run) |
| No module files changed (docs, scripts, CI) | 0 specs | ~30s (skip) |

---

### 5.4 Playwright Sharding for Full Runs

For pushes to `main` and `develop` (where the full suite must run), shard integration tests across parallel runners.

**Change:** Use `strategy.matrix` in `ephemeral-integration`:

```yaml
ephemeral-integration:
  strategy:
    matrix:
      shard: [1, 2, 3, 4, 5]
  steps:
    ...
    - name: Run ephemeral integration tests
      run: yarn test:integration:coverage --shard=${{ matrix.shard }}/5
```

Each shard starts its own ephemeral server (the server manager already handles dynamic port selection). 311 tests ÷ 5 shards = ~62 tests per shard.

**Coverage merging:** Each shard produces a partial `coverage-summary.json`. A final job downloads all shard artifacts and merges them:

```yaml
merge-coverage:
  needs: ephemeral-integration
  steps:
    - uses: actions/download-artifact@v4
      with: { pattern: integration-test-results-* }
    - run: node scripts/merge-coverage.mjs
```

**Expected impact:** Full suite integration time 45 min → ~10–12 min (5 shards × ~62 tests each, plus ~2 min startup per shard).

---

### 5.5 Concurrency Groups on `ci.yml` and `snapshot.yml`

**Change:** Add concurrency groups to prevent stale runs from consuming compute.

```yaml
# ci.yml — add at top level, after permissions:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

# snapshot.yml — add at top level:
concurrency:
  group: snapshot-${{ github.ref }}
  cancel-in-progress: false   # MUST be false — cancelling mid-publish leaves partial npm packages
```

**`cancel-in-progress: false` for snapshot is intentional.** `snapshot.yml` publishes multiple packages to npm atomically inside `release-snapshot.sh`. If a run is cancelled mid-publish, some packages land at the new version and others stay at the previous one — making the npm registry inconsistent. Queuing (`cancel-in-progress: false`) is the safe behaviour. Two rapid pushes to `develop` will publish sequentially; the second overwrites the first dist-tag, which is the desired outcome.

**Expected impact:** A developer who pushes 3 times in 5 minutes sees only the last CI run complete. The first two are cancelled automatically. No wasted 55-minute runs.

---

### 5.6 Playwright Runner: Pre-built Image

**Change:** Replace `ubuntu-latest` + `npx playwright install --with-deps chromium` with the official Playwright Docker image as the runner for `ephemeral-integration`. This eliminates the 25-second Playwright install step and its transitive system dependencies.

```yaml
ephemeral-integration:
  runs-on: ubuntu-latest
  container:
    image: mcr.microsoft.com/playwright:v1.51.0-noble
```

**Note:** Requires the ephemeral server to listen correctly inside a container network. Verify `BASE_URL` and internal port handling.

---

### 5.7 Docs Dockerfile: Node 20 → 24-Alpine

`apps/docs/Dockerfile` uses `node:20-alpine` while the rest of the project targets Node 24. Node 20 receives fewer security patches and doesn't benefit from the V8 performance improvements in Node 22–24.

```dockerfile
# Before
FROM node:20-alpine AS builder

# After
FROM node:24-alpine AS builder
```

---

### 5.8 Self-Hosted Warm Runners (Long-term)

GitHub-hosted `ubuntu-latest` runners are ephemeral — every job starts from a cold OS image. A persistent self-hosted runner (a VPS or dedicated machine) retains:

- `node_modules/` from the last run (yarn install becomes seconds)
- Turbo's local cache (build artifacts from previous commits)
- Playwright binaries (no install step)
- Docker layer cache (local, not limited by GHA cache size)

**Trade-off:** Requires maintaining runner infrastructure, handling security (runners have access to secrets), and ensuring runners stay up-to-date. For a team with existing infrastructure (Proxmox, Cozystack), this is low marginal cost.

**Expected impact:** Combined with Turbo remote cache and affected-only execution, warm runners bring typical PR CI time to under 2 minutes on cache hits.

---

## 6. Projected Impact by Change

| Change | Effort | Typical PR (1 module) | Full run (main merge) |
|--------|--------|----------------------|----------------------|
| Baseline (current) | — | 55 min | 55 min |
| 5.5 Concurrency groups | 10 min | — | Cancels stale runs |
| 5.1 Turbo cache enabled | 2 hrs | 45 min | 45 min |
| 5.2 Affected-only build/test | 1 hr | 12 min | 45 min |
| 5.3 Affected-only integration | 4 hrs | **3–5 min** | 45 min |
| 5.4 Playwright sharding (5×) | 4 hrs | 3–5 min | **12–15 min** |
| 5.1 + 5.2 + 5.3 + 5.4 | 12 hrs | **2–4 min** | **8–12 min** |
| + 5.8 Warm runners | deferred | **30–90 sec** | 5–8 min |

**95–99% reduction is achievable** for typical PRs with changes 5.1–5.3 combined. Full-suite runs (main merges) hit 80–85% reduction with sharding, and 90%+ with warm runners.

---

## 7. Effect on Developer Workflow

### Today

1. Push branch → wait 55 minutes → maybe green → iterate
2. Push again to address review → wait another 55 minutes
3. Multi-push within a session? All three 55-minute runs complete, wasting 2 hours of compute

### After proposed changes

**Typical PR push:**
1. Push branch → stale run cancelled immediately (5.5)
2. Turbo cache hits for unchanged packages → build in 15s (5.1)
3. Only affected packages typechecked and unit-tested → 20–30s (5.2)
4. Only affected module's integration tests run → 2–5 min (5.3)
5. **Total: 3–6 minutes from push to green/red**

**Pushing again to fix a review comment:**
- Same 3–6 minutes, previous run cancelled within seconds

**PR touching `packages/shared`:**
- Everything depends on shared → full rebuild triggered (expected, correct)
- Affected-only integration: all 311 tests still run
- With sharding: 12–15 min instead of 45 min

**Merge to main:**
- Full suite always runs (no affected-only filtering on protected branches)
- With sharding: 12–15 min
- With warm runners: 5–8 min

**QA deployment:** No change — remains manual.

**Release:** No change — remains gated by environment approval.

### What does NOT change

- Security: audit still gates every run, npm provenance attestations still used for releases
- Correctness: tests still run against the same ephemeral server, same test suite
- Release process: manual dispatch with human approval gate
- The PR still must be green before merge — only the time to get there changes

---

## 8. Implementation Plan

### Phase 0 — Immediate (already done, current branch)

- [x] Extract `prepare` job with artifact upload
- [x] Extract `audit` job running in parallel
- [x] Yarn package caching: explicit `actions/cache` on `.yarn/cache` after `corepack enable` in all four jobs
  - **Note:** `cache: 'yarn'` on `setup-node@v4` is NOT used. `setup-node` calls `yarn config get cacheFolder` before `corepack enable` runs, which invokes the globally-installed Yarn 1 (1.22.22) instead of Yarn 4. With `"packageManager": "yarn@4.12.0"` in `package.json`, Yarn 1 aborts immediately. The correct approach is a manual `actions/cache` step placed after `corepack enable`.
- [x] Artifact includes `packages/*/generated/` in addition to `packages/*/dist/` and `apps/mercato/.mercato/generated/`
  - **Note:** Several packages (`core`, `onboarding`, `scheduler`, `integration-cozystack`) declare `#generated/*` Node.js subpath imports whose `types` condition points to source `.ts` files in `packages/<pkg>/generated/` — not `dist/`. The `test` job's typecheck fails unless these source files are present on disk.
- [x] `turbo.json` build task: add `"inputs": ["$TURBO_DEFAULT$", "generated/**"]`
  - **Root cause of second-build cache poisoning:** `.gitignore` includes `packages/*/generated/`. Turbo only hashes git-tracked files by default. This means after `yarn generate` creates `packages/core/generated/entities.ids.generated.ts`, Turbo computes the **same** hash for `@open-mercato/core#build` as before generate ran — so the second `yarn build:packages` is a false cache hit returning the first build's output, which has no `dist/generated/`. Jest then fails at runtime: `Cannot find module '../../../generated/entities.ids.generated.js'`.
  - **Fix:** `$TURBO_DEFAULT$` preserves all non-gitignored inputs; `generated/**` explicitly adds the gitignored generated files. After generate, the hash changes → cache miss → fresh build → `dist/generated/` is populated.
- [x] Add pip cache for markitdown
- **Estimated savings:** ~2–3 min on warm cache

### Phase 1 — Concurrency + Turbo cache (~1 day)

1. Add concurrency groups to `ci.yml` and `snapshot.yml`
2. Replace `"globalPassThroughEnv": ["*"]` in `turbo.json` with an explicit allowlist
3. Enable `"cache": true` for `build` and `typecheck` tasks in `turbo.json`
4. Set up Turbo remote cache:
   - Option A: Vercel free tier (5 min setup, requires Vercel account)
   - Option B: Self-hosted `turborepo-remote-cache` on existing infra (1 hr)
5. Add `TURBO_TOKEN` + `TURBO_TEAM` to GitHub Actions secrets
6. Add env vars to all build steps in `ci.yml`
7. Validate: push an unrelated change and confirm packages build in < 15s on second run

### Phase 2 — Affected-only build and unit tests (~1 day)

1. Add `--filter=[origin/main]...` to `yarn build:packages` and `yarn test` in `ci.yml`
2. Keep `yarn generate` and `yarn build:app` as full runs (no filter)
3. Add `fetch-depth: 0` to checkout steps (needed for `git diff origin/main`)
4. Validate: change one file in `packages/core/src/modules/sales/` and confirm only `sales` and its dependents build

### Phase 3 — Affected-only integration tests (~2–3 days)

1. [x] Add module filtering to `.ai/qa/tests/playwright.config.ts`
   - Reads `OM_INTEGRATION_MODULES` env var (comma-separated module names, e.g. `"sales,customers"`)
   - When set, filters `discoverIntegrationSpecFiles` output: a spec is included if its `moduleName` matches, any of its `requiredModules` match, or its `moduleName` is `null` (legacy root specs always run)
   - When unset or empty, all specs run unchanged (no behaviour change for existing CI)
   - Uses `filteredSpecs` instead of `discoveredSpecs` for `testMatch`
2. [x] Compute affected modules inline in `ci.yml` `test` job (no separate script needed):
   - "Compute integration scope" step added to `test` job; outputs `skip` and `modules`
   - Full-suite patterns trigger the full run; only unmatched module paths produce a filtered list
   - Non-module-only changes (CI, docs, scripts) set `skip=true` to skip integration entirely
3. [x] Wire into `ci.yml` `ephemeral-integration` job:
   - `if: needs.test.outputs.skip_integration != 'true'` skips the job when no module changes
   - `OM_INTEGRATION_MODULES: ${{ needs.test.outputs.affected_modules }}` passes module list
   - On pushes, `affected_modules` is empty so all specs run (filtered by shard)
4. Validate: change one file in `packages/core/src/modules/customers/` and confirm only customers integration tests run

### Phase 4 — Playwright sharding for full runs (~1–2 days)

1. [x] Add `strategy.matrix` to `ephemeral-integration` — dynamic matrix: PR uses `["none"]` (single runner, affected-only), push uses `["1/5","2/5","3/5","4/5","5/5"]` (5 parallel shards, full suite)
2. [x] "Compute shard metadata" step derives `shard_flag` (`--shard N/M` or empty) and `artifact_name` from `matrix.shard`; test command passes flag conditionally
3. [x] Artifact upload uses `${{ steps.shard-meta.outputs.artifact_name }}` — `integration-test-results-N` for shards, `integration-test-results` for PR
4. [x] Add `merge-coverage` job: downloads all `integration-test-results-*` artifacts with `merge-multiple: true`, runs `node scripts/merge-coverage.mjs`, writes step summary; only runs on push
5. [x] `scripts/merge-coverage.mjs` written (no external dependencies, scans `coverage-shard-*/code/coverage-summary.json`); exits 0 with warning when no shard files found (graceful degradation when coverage not produced)
6. [x] App build artifact sharing: `test` job uploads `apps/mercato/.next/` as `app-build` artifact after `yarn build:app`; `ephemeral-integration` downloads it instead of rebuilding (~96s × 5 shards = ~8 min saved)
7. [x] Lint job: runs ESLint in parallel with `prepare`/`audit`; `test` job now needs `[prepare, audit, lint]`
8. Validate on a full run (push to develop): confirm all 5 shards complete in ~10–12 min

#### Implementation notes (completed)

**`--shard N/M` CLI flag** (`packages/cli/src/lib/testing/integration.ts`):
- Added `shard: string | null` to `IntegrationCoverageOptions` and `PlaywrightRunOptions` (as an intersection `& { shard?: string | null }`).
- `parseIntegrationCoverageOptions` accepts both `--shard N/M` (two-token) and `--shard=N/M` (equals) forms; validates format with `/^\d+\/\d+$/`.
- `runPlaywrightSelection` pushes `--shard <value>` to the Playwright CLI args (placed after `--retries`, before file selection).
- `runIntegrationCoverageReport` forwards `shard` from parsed options into `runPlaywrightSelection`.

**`scripts/merge-coverage.mjs`**:
- Accepts an optional `resultsRoot` argument (default: `.ai/qa/test-results`).
- Discovers shard files by scanning `<resultsRoot>/coverage-shard-*/code/coverage-summary.json` using `readdirSync` (no external dependencies).
- **Total merge**: sums `total`, `covered`, and `skipped` counters across all shards for each of the four Istanbul metrics (`lines`, `statements`, `functions`, `branches`); recomputes `pct = Math.round(covered/total * 10000) / 100` (0 when total is 0).
- **Per-file merge**: unions all file entries across shards; when the same file path appears in multiple shards, the shard with the higher combined `lines.covered + statements.covered` count wins (the shard that ran tests for that file will have non-zero coverage).
- Writes merged JSON to `<resultsRoot>/coverage/code/coverage-summary.json` (mkdir -p).
- Prints `[merge-coverage] Merged N shards: lines X/Y (Z%)` and exits 0; exits 1 with an error message on failure.

### Phase 5 — Node version + Dockerfile consistency (~2 hours)

1. Update `apps/docs/Dockerfile` Node 20-alpine → 24-alpine
2. Add `ENV NODE_OPTIONS="--max-old-space-size=4096"` to preview Dockerfile builder stage
3. Pin Node version in CI: `node-version: '24.x'` → exact patch from `.nvmrc`
4. Add `.nvmrc` with exact Node version used in production

### Phase 5b — Docker-build decoupling and CI-only skip (current work)

**Problem:** CI/infra-only PRs (touching only `turbo.json`, `scripts/`, `.github/`, `packages/cli/src/lib/testing/`) caused Docker layer cache to fully bust. The `docker-build` job then rebuilt the Next.js app from scratch inside Docker (~10 min) and ran sequentially after `test` — producing an 18 min wall time for a branch that never changed app code.

**Root cause:** `turbo.json` sits in the first `COPY` layer of the Dockerfile (before `RUN yarn install`). Any change to it invalidates all subsequent layers, including the expensive `RUN yarn build` step.

**Changes made:**

1. **`docker-build: needs: prepare`** (was `needs: test`) — docker and test now run in parallel. For module PRs where Docker rebuilds (~10 min) this removes 4 min of wasted wait.

2. **Skip `docker-build` when `skip_integration == 'true'`** — CI/docs/scripts-only PRs have `skip_integration=true`. These PRs have not changed any app source or Dockerfiles; the Docker image is functionally identical to the last build. Skipping saves 10+ min rebuild cost.

3. **Skip app build in `prepare` when `skip_integration == 'true'`** — the Next.js build (95s) + tar + upload are unnecessary for CI-only PRs since no integration shard will consume the artifact. Saves ~2 min in the prepare job.

4. **`.dockerignore` improvements** — added `**/testing/` (testing utilities like `packages/cli/src/lib/testing/`) and CI-only scripts (`scripts/merge-coverage.mjs`, `scripts/i18n-check-sync.ts`, `scripts/i18n-check-usage.ts`) to prevent these files from busting Docker layer cache in future PRs where they change alongside app code.

**Result for CI-only PRs:**
- Before: `prepare (4 min) → test (4 min) → docker-build (10 min)` = 18 min (sequential)
- After: `prepare (2.5 min) → test (4 min)` = 6.5 min (docker-build skipped)

### Phase 6 — Self-hosted warm runners (deferred)

Self-hosted runners would eliminate cold-start overhead (~1m per job) and enable persistent Turbo local cache. Deferred pending discussion with the open-mercato upstream team — running their CI on external infra requires coordination around secrets access, runner security, and maintenance responsibility.

---

## 9. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Turbo cache produces stale builds (wrong cache key) | Medium | Run full rebuild weekly on `develop`; add `--force` flag to nightly scheduled run |
| Affected-only filtering misses a cross-package bug | Low | Turbo's dep graph is accurate; `--filter=[origin/main]...` includes all transitive dependents |
| Playwright sharding causes flaky tests (race conditions on DB) | Low | Each shard has an isolated ephemeral server and DB; no shared state |
| Self-hosted runner has a security incident | Low | Runners should run with minimal permissions; secrets scoped to repo; runner isolated in VLAN |
| Snapshot publishes same version twice (no concurrency) | Medium (exists today) | Concurrency group fix in Phase 1 |

---

## Appendix: Workflow Reference Card

| Workflow | Trigger | Critical path | When it blocks a merge |
|----------|---------|---------------|------------------------|
| `ci.yml` | Push/PR to main/develop | 55 min (target: 3–6 min) | Always |
| `snapshot.yml` | Push to develop / PR | ~15 min + npm propagation | Never directly |
| `release.yml` | Manual dispatch | ~5 min + human approval | Never (post-merge) |
| `qa-deploy.yml` | Manual dispatch | ~15 min | Never (optional) |
| `qa-stop-on-merge.yml` | PR closed | ~1 min | Never |
