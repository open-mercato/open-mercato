---
name: smart-test
description: Run only the tests affected by changed code. Use when the user says "run affected tests", "run smart tests", "test only what changed", "run tests for this PR", "run tests for my changes", "selective tests", or asks to run tests without running the full suite.
---

# Smart Test — Run Only Affected Tests

Runs the minimal set of tests that cover the code changes in the current branch or working tree.

**Execution policy**: Display the test plan (which tests will run and why), then **immediately run them without asking for confirmation**.

**Cache**: Analysis results are persisted to `.test-cache.json` (gitignored). On repeated invocations for the same commit with no uncommitted changes, the cached plan is reused — skip straight to running tests.

## Two Test Types, Two Strategies

| Type | Files | Strategy |
|------|-------|----------|
| Jest (unit/component) | `*.test.ts`, `*.test.tsx` | `--findRelatedTests` (Jest traverses import graph) |
| Playwright (integration) | `*.spec.ts` in `__integration__/` | Module-name matching via `meta.ts` dependency declarations |

---

## Step 0 — Cache Lookup

Before doing any git analysis, check whether a valid cached plan already exists for the current state.

```bash
CURRENT_HASH=$(git rev-parse HEAD)
UNCOMMITTED=$(git diff --name-only HEAD; git ls-files --others --exclude-standard)
```

Read `.test-cache.json` (if it exists). The cache is **valid** when:
1. `cache.commitHash` equals `CURRENT_HASH`, **and**
2. `UNCOMMITTED` is empty (no staged/unstaged/untracked changes), **and**
3. The commit is reachable from HEAD: `git merge-base --is-ancestor <cache.commitHash> HEAD 2>/dev/null` exits 0

```bash
git merge-base --is-ancestor "${cache.commitHash}" HEAD 2>/dev/null && echo "reachable" || echo "stale"
```

Condition 3 guards against stale cache entries after a rebase, amend, or force-push. The old hash may still exist as a dangling object in the git store (`git cat-file -e` would return true), but it is no longer part of the branch history — `git merge-base --is-ancestor` correctly rejects it.

**If cache is valid**: skip Steps 1–5, print `[cache hit: <hash>]`, and run tests from the cached plan:
- **Jest**: `yarn jest --findRelatedTests <cache.jestSourceFiles> --passWithNoTests`
- **Playwright**: if `cache.integrationWide` is `true` → `yarn test:integration`; else if `cache.integrationSpecFiles` is non-empty → `yarn playwright test <cache.integrationSpecFiles> --config=.ai/qa/tests/playwright.config.ts`; else skip.

**If cache is invalid or missing**: continue to Step 1. After completing Steps 1–2, write the cache (see "Save Cache" below) before running tests.

### Cache file format (`.test-cache.json`)

```json
{
  "commitHash": "<git rev-parse HEAD>",
  "savedAt": "<ISO timestamp>",
  "scope": "module | wide | test-only | package",
  "layer": "ui | ui-component | api-logic | data | mixed",
  "affectedModules": ["auth", "sales"],
  "jestSourceFiles": [
    "packages/core/src/modules/auth/commands/users.ts"
  ],
  "integrationSpecFiles": [
    "packages/core/src/modules/auth/__integration__/TC-AUTH-001.spec.ts"
  ],
  "integrationWide": false
}
```

`integrationWide: true` means the Python script returned `--all`; in that case `integrationSpecFiles` is empty and the full integration suite runs.

`layer` values: `ui` = skip Playwright; `ui-component`, `api-logic`, `data`, or `mixed` = run Playwright.

### Save Cache

After completing the analysis (Steps 1–2), write the plan before running tests:

```bash
node -e "
const fs = require('fs');
const plan = {
  commitHash: '$(git rev-parse HEAD)',
  savedAt: new Date().toISOString(),
  scope: '<scope>',
  layer: '<ui|ui-component|api-logic|data|mixed>',
  affectedModules: <json-array-of-modules>,
  jestSourceFiles: <json-array>,
  integrationSpecFiles: <json-array>,
  integrationWide: <true|false>
};
fs.writeFileSync('.test-cache.json', JSON.stringify(plan, null, 2));
"
```

---

## Step 1 — Determine Changed Files

Build one changed-file list and reuse it for cache invalidation, classification, Jest, and
Playwright mapping. Include PR diff, local staged/unstaged changes, and untracked files:

First resolve the comparison base. Do **not** guess `origin/main` when the branch is based on
`develop`; comparing a develop-based branch to `origin/main` can pull in unrelated
`packages/shared/` changes from the long-lived develop branch and incorrectly force the full
suite.

```bash
BASE_REF="${SMART_TEST_BASE_REF:-}"
if [ -z "$BASE_REF" ]; then
  BASE_REF="$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || true)"
fi
if [ -z "$BASE_REF" ] && git rev-parse --verify --quiet origin/develop >/dev/null; then
  if git merge-base --fork-point origin/develop HEAD >/dev/null 2>&1 || git merge-base --is-ancestor origin/develop HEAD; then
    BASE_REF="origin/develop"
  fi
fi
if [ -z "$BASE_REF" ] && git rev-parse --verify --quiet develop >/dev/null; then
  if git merge-base --fork-point develop HEAD >/dev/null 2>&1 || git merge-base --is-ancestor develop HEAD; then
    BASE_REF="develop"
  fi
fi

CHANGED_FILES=$({
  if [ -n "$BASE_REF" ]; then
    git diff --name-only "$BASE_REF"...HEAD
  fi
  git diff --name-only HEAD
  git ls-files --others --exclude-standard
} | awk '!seen[$0]++')
```

If `git diff --name-only origin/main...HEAD` contains `packages/shared/` but `$BASE_REF` is
`origin/develop`/`develop` and the `$BASE_REF...HEAD` diff does not contain
`packages/shared/`, do not classify the branch as wide-scope. Report it as a base-ref
mismatch and use the resolved develop base.

If there is no upstream PR context, use only local changes and untracked files:

```bash
CHANGED_FILES=$({
  git diff --name-only HEAD
  git ls-files --others --exclude-standard
} | awk '!seen[$0]++')
```

---

## Step 2 — Classify Scope and Layer

### 2a — Scope

Read the changed file list and classify scope:

- **Wide scope** (run everything): changes in `packages/shared/`, `packages/events/`, `packages/queue/`, `packages/cache/`, root `jest.config.cjs`, `jest.setup.ts`, `tsconfig*.json`
- **UI-wide** (`packages/ui/src/backend/`): shared React components rendered on every backend page — Jest: `--findRelatedTests`; Playwright: full suite (the Python script outputs `--all` for these paths). For `packages/ui/src/primitives/` or `packages/ui/src/styles/` only, classify as `ui` layer instead (no Playwright).
- **Module-scoped**: `packages/*/src/modules/<module>/` or `apps/mercato/src/modules/<module>/` → extract `<module>`
- **Package-scoped** (no module): `packages/<pkg>/src/lib/` or `packages/<pkg>/src/` root — treat as wide scope for that package
- **Jest-test-only**: only `.test.ts`/`.test.tsx` files changed → run those files directly via Jest; skip Playwright
- **Playwright-test-only**: only `.spec.ts` files inside `__integration__/` changed → run those files directly via `yarn playwright test <files> --config=.ai/qa/tests/playwright.config.ts`; skip Jest

See `references/test-architecture.md` for module extraction patterns and known cross-module integration dependencies.

### 2b — Layer (determines whether Playwright runs)

After determining scope, classify the **layer** of each changed source file. Integration (Playwright) tests only need to run when backend logic or data is touched — they are irrelevant for pure UI changes.

**Classify each changed file:**

| Layer | Path indicators | Playwright needed? |
|-------|----------------|--------------------|
| `ui` | `**/*.css` · `packages/ui/src/primitives/` · `packages/ui/src/styles/` | **No** |
| `ui-component` | `packages/ui/src/backend/**/*.tsx` · `/components/` · `/widgets/` · `/frontend/` · `/backend/**/*.tsx` (Next.js pages) | **Yes** — Playwright renders full pages; a broken component can crash a page load or break a selector |
| `api-logic` | `/api/` · `/commands/` · `/lib/` · `/services/` · `/subscribers/` · `/workers/` · `events.ts` · `notifications.ts` · `ai-tools.ts` | **Yes** |
| `data` | `/data/entities` · `/data/migrations` · `/data/validators` · `/data/extensions` · `/data/enrichers` | **Yes** |

**Layer decision rule — set `$LAYER` as a shell variable:**
- All changed files → `ui` only (CSS / design tokens / primitives) → `LAYER=ui`, **skip Playwright**
- Any file → `data` patterns → `LAYER=data`, **run Playwright**
- Any file → `api-logic` patterns (and none match `data`) → `LAYER=api-logic`, **run Playwright**
- Any file → `ui-component` patterns (and none match `api-logic` or `data`) → `LAYER=ui-component`, **run Playwright**
- Files span multiple non-`ui` layers → `LAYER=mixed`, **run Playwright**
- Wide scope always → **run everything**

```bash
LAYER="<ui|ui-component|api-logic|data|mixed>"  # required: used in Step 5 and cache
```

**Why `ui-component` needs Playwright**: integration tests render full pages. A React component that throws during render, a conditional that hides a button, or a changed DOM structure can all break Playwright selectors — even without touching any API.

**Only skip Playwright when** the change cannot affect DOM structure or interactivity: pure CSS, design tokens, Tailwind config, color/spacing primitives.

**Special cases:**
- Module `backend/page.tsx`, `backend/[id]/page.tsx` — Next.js page files → `ui-component` (Playwright visits these pages)
- Module `api/GET/route.ts`, `api/POST/route.ts` → API routes → `api-logic`

→ **Save cache now** (see Step 0 — Save Cache, include `layer` field) before proceeding to run tests.

---

## Step 3 — Jest Unit Tests

Use Jest's built-in `--findRelatedTests`. It traverses the import graph from changed source files and discovers every test that (directly or transitively) imports them.

```bash
# Build the list of changed source files (exclude test files themselves)
CHANGED=$(printf '%s\n' "$CHANGED_FILES" \
  | grep -E '\.(ts|tsx)$' \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | grep -v '__tests__/' \
  | grep -v '__integration__/' \
  | tr '\n' ' ')

# Run related tests (passWithNoTests handles no-match gracefully)
yarn jest --findRelatedTests $CHANGED --passWithNoTests
```

**Wide scope fallback**: when `CHANGED` includes shared/events/queue/cache files, run the full Jest suite instead:

```bash
yarn test
```

---

## Step 4 — Ensure Server Is Running (Integration Tests Only)

Before running any Playwright tests, verify the app is accessible on port 3000.

```bash
curl -sf http://localhost:3000 > /dev/null 2>&1
```

**If the server is running** (exit code 0): proceed directly to Step 5.

**If the server is NOT running**: build the project and start the production server:

```bash
# Build everything (packages + app)
yarn build

# Start production server in background
yarn start &
APP_PID=$!

# Wait up to 2 minutes for server to become ready
echo "Waiting for server on port 3000..."
SERVER_READY=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    echo "Server ready."
    SERVER_READY=1
    break
  fi
  sleep 2
done

if [ "$SERVER_READY" -eq 0 ]; then
  echo "ERROR: Server did not become ready within 2 minutes. Aborting integration tests."
  exit 1
fi
```

After tests finish, leave the server running — do not kill it.

---

## Step 5 — Integration Tests (Playwright)

**Layer gate**: if `layer = ui` (all changed files are UI-only), skip this step entirely — Playwright tests are not affected by pure UI changes.

Otherwise, use the Python script to map changed modules → affected spec files.
Pass `--layer` so the script can apply the correct triggering rules:

```bash
SPEC_FILES=$(printf '%s\n' "$CHANGED_FILES" \
  | python3 .ai/skills/smart-test/scripts/find_affected_integration_tests.py \
    --project-root . \
    --base auto \
    --layer "$LAYER")

if [ "$SPEC_FILES" = "--all" ]; then
  yarn test:integration
elif [ -n "$SPEC_FILES" ]; then
  yarn playwright test $SPEC_FILES --config=.ai/qa/tests/playwright.config.ts
else
  echo "No affected integration tests found."
fi
```

`$LAYER` is the value determined in Step 2b (`ui-component`, `api-logic`, `data`, or `mixed`).

**Layer-aware dep filtering**: when `LAYER=ui-component`, the script only runs tests whose
own module changed — it ignores cross-module `dependsOnModules` declarations. Rationale: a
changed `page.tsx` or React component cannot break another module's API calls; only tests
that actually visit those pages need to run.

**Workspace scoping**: the script compares module identity by both module name and runtime
root. For example, `apps/mercato/src/modules/example` and
`packages/create-app/template/src/modules/example` are separate `example` modules, so an
app-specific page change does not trigger template integration specs.

**Wide scope**: if the script outputs `--all` (triggered when shared deps changed), run the full integration suite.

**Data layer**: if `layer = data` (entities/migrations changed), integration tests are
particularly important. Run normally via the script — the mapping will include all tests for
the affected module including any that declare it as a dependency.

---

## Step 6 — Report Results

After tests complete, summarize:
- Whether results came from cache (`[cache hit]`) or fresh analysis
- How many Jest tests ran vs full suite
- Which integration spec files ran and why (which changed module triggered each)
- Whether the server was already running or was built and started
- Any wide-scope fallback applied and why

**Coverage percentages** (always include at the end):

| Type | Ran | Total | % |
|------|-----|-------|---|
| Unit (Jest suites) | `<ran>` | ~485 | `<ran/485 * 100>`% |
| Integration (Playwright spec files) | `<ran>` | ~323 | `<ran/323 * 100>`% |

Totals come from `references/test-architecture.md`. Round to one decimal place.

---

## Decision Tree

```
Step 0: .test-cache.json valid (hash + no uncommitted + reachable)?
  └─ YES → run from cache; check integrationWide flag:
           integrationWide=true  → Jest: cached files + Playwright: yarn test:integration
           integrationWide=false → Jest: cached files + Playwright: cached spec files (or skip)
  └─ NO  → analyze:

       Step 2a — Scope:
         └─ Only .test.ts/.test.tsx?        → Jest: run those files directly; Playwright: skip
         └─ Only .spec.ts (__integration__/)? → Jest: skip; Playwright: run those files directly
         └─ shared/events/queue/cache/root config?
                                            → Full suite (yarn test + yarn test:integration)
         └─ packages/ui/src/backend/?       → Jest: --findRelatedTests; Playwright: full suite
         └─ Module-scoped?                  → extract module name(s)
         └─ Package lib (no module)?        → --findRelatedTests for that package

       Step 2b — Layer (for non-wide, non-test-only scopes):
         └─ ALL files are pure CSS / design tokens / primitives?
              → LAYER=ui
              → Jest: --findRelatedTests <changed-src-files>
              → Integration: SKIP (no DOM structure change possible)
         └─ ANY file is ui-component / api-logic / data?
              → LAYER=<ui-component|api-logic|data|mixed>
              → Jest: --findRelatedTests <changed-src-files>
              → Integration: check server → script maps modules → spec files

       → Set $LAYER → Save cache (with layer field) → run tests
```

---

## Reference Files

- `references/test-architecture.md` — full test structure, module path patterns, framework configs, known cross-module integration dependencies
