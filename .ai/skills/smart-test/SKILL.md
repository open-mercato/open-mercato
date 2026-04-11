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
UNCOMMITTED=$(git diff --name-only HEAD)
```

Read `.test-cache.json` (if it exists). The cache is **valid** when:
1. `cache.commitHash` equals `CURRENT_HASH`, **and**
2. `UNCOMMITTED` is empty (no staged/unstaged changes), **and**
3. The commit is reachable from HEAD: `git merge-base --is-ancestor <cache.commitHash> HEAD 2>/dev/null` exits 0

```bash
git merge-base --is-ancestor "${cache.commitHash}" HEAD 2>/dev/null && echo "reachable" || echo "stale"
```

Condition 3 guards against stale cache entries after a rebase, amend, or force-push. The old hash may still exist as a dangling object in the git store (`git cat-file -e` would return true), but it is no longer part of the branch history — `git merge-base --is-ancestor` correctly rejects it.

**If cache is valid**: skip Steps 1–5, print `[cache hit: <hash>]`, and proceed directly to running tests using `cache.jestSourceFiles` and `cache.integrationSpecFiles`.

**If cache is invalid or missing**: continue to Step 1. After completing Steps 1–2, write the cache (see "Save Cache" below) before running tests.

### Cache file format (`.test-cache.json`)

```json
{
  "commitHash": "<git rev-parse HEAD>",
  "savedAt": "<ISO timestamp>",
  "scope": "module | wide | test-only | package",
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

### Save Cache

After completing the analysis (Steps 1–2), write the plan before running tests:

```bash
node -e "
const fs = require('fs');
const plan = {
  commitHash: '$(git rev-parse HEAD)',
  savedAt: new Date().toISOString(),
  scope: '<scope>',
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

Default to comparing against the upstream tracking branch:

```bash
# Changed files vs develop (most common — PR context)
git diff --name-only origin/develop...HEAD

# Or: staged + unstaged local changes
git diff --name-only HEAD

# Or: last commit only
git diff --name-only HEAD~1 HEAD
```

---

## Step 2 — Classify Scope

Read the changed file list and classify:

- **Wide scope** (run everything): changes in `packages/shared/`, `packages/events/`, `packages/queue/`, `packages/cache/`, root `jest.config.cjs`, `jest.setup.ts`, `tsconfig*.json`
- **UI-wide**: changes in `packages/ui/src/` (not inside a module)
- **Module-scoped**: `packages/*/src/modules/<module>/` or `apps/mercato/src/modules/<module>/` → extract `<module>`
- **Package-scoped** (no module): `packages/<pkg>/src/lib/` or `packages/<pkg>/src/` root — treat as wide scope for that package
- **Test-only changes**: `.test.ts` or `.spec.ts` files changed → run those specific files directly

See `references/test-architecture.md` for module extraction patterns and known cross-module integration dependencies.

→ **Save cache now** (see Step 0 — Save Cache) before proceeding to run tests.

---

## Step 3 — Jest Unit Tests

Use Jest's built-in `--findRelatedTests`. It traverses the import graph from changed source files and discovers every test that (directly or transitively) imports them.

```bash
# Build the list of changed source files (exclude test files themselves)
CHANGED=$(git diff --name-only origin/develop...HEAD \
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
for i in $(seq 1 60); do
  curl -sf http://localhost:3000 > /dev/null 2>&1 && echo "Server ready." && break
  sleep 2
done
```

After tests finish, leave the server running — do not kill it.

---

## Step 5 — Integration Tests (Playwright)

Use the Python script to map changed modules → affected spec files:

```bash
SPEC_FILES=$(git diff --name-only origin/develop...HEAD \
  | python3 .ai/skills/smart-test/scripts/find_affected_integration_tests.py --project-root .)

if [ "$SPEC_FILES" = "--all" ]; then
  yarn test:integration
elif [ -n "$SPEC_FILES" ]; then
  yarn playwright test $SPEC_FILES --config=.ai/qa/tests/playwright.config.ts
else
  echo "No affected integration tests found."
fi
```

**Wide scope**: if the script outputs `--all` (triggered when shared deps changed), run the full integration suite.

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
Step 0: .test-cache.json exists AND commitHash matches AND no uncommitted changes AND commit exists in repo?
  └─ YES → use cached plan, skip to running tests
  └─ NO  → analyze:
       Changed files?
         └─ Only test files?
              → Run those files directly
         └─ Includes shared/events/queue/cache/root config?
              → Full suite (yarn test + yarn test:integration)
         └─ Module-scoped changes?
              → Jest: --findRelatedTests <changed-src-files>
              → Integration: check server → script maps modules → spec files
         └─ Package lib changes (no module)?
              → Jest: --findRelatedTests for that package
              → Integration: check server → script (may expand to --all)
       → Save cache → run tests
```

---

## Reference Files

- `references/test-architecture.md` — full test structure, module path patterns, framework configs, known cross-module integration dependencies
