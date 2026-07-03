# Step 2 — Isolated worktree, diff-level auto-checks, full code-review, classify

Only reached when no early-exit gate (step 1d/1e) fired. Everything here happens inside an isolated
worktree; the repository's main worktree stays untouched.

## 2a. Create (or reuse) an isolated worktree for the PR

Detect whether you are already inside a linked worktree; reuse it rather than nesting.

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
WORKTREE_PARENT="$REPO_ROOT/.ai/tmp/auto-review-pr"
CREATED_WORKTREE=0

if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  WORKTREE_DIR="$PWD"
else
  WORKTREE_DIR="$WORKTREE_PARENT/pr-{prNumber}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$WORKTREE_PARENT"
  git fetch origin "pull/{prNumber}/head"
  PR_HEAD_SHA=$(git rev-parse FETCH_HEAD)
  git worktree add --detach "$WORKTREE_DIR" "$PR_HEAD_SHA"
  CREATED_WORKTREE=1
  cd "$WORKTREE_DIR"
  git switch -c "review/pr-{prNumber}"
fi
```

Using the GitHub pull ref makes checkout work for both same-repo and fork PRs. If you reused an
existing linked worktree, repoint it deliberately to the PR branch first. Then ensure the correct PR
context and fetch the PR's base branch (`baseRefName` from step 1 — never assume `develop`):

```bash
cd "$WORKTREE_DIR"
git fetch origin "pull/{prNumber}/head"
git checkout -B "review/pr-{prNumber}" FETCH_HEAD
git fetch origin "{baseRefName}"
```

Restore package-manager state before any Yarn-based validation:

```bash
yarn install --mode=skip-build   # fall back to plain `yarn install` if unsupported
```

Cleanup (deferred to step 5, but only if you created the worktree this run):

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then git worktree remove --force "$WORKTREE_DIR"; fi
```

## 2b. Check for duplicated or already-merged changes

Verify the PR does not duplicate work already on its base branch (base already carries the fix, a
parallel PR landed the same feature, or the PR is a subset of merged work).

```bash
gh pr diff {prNumber} --name-only
git diff origin/{baseRefName} -- <file>
git log origin/{baseRefName} --oneline -20 -- <files>
```

Also look for semantic duplication — the same logic/fix already present even if the code differs.

- If the PR's core changes are already in the base branch: submit a changes-requested review naming
  the specific commits/PRs that already contain the equivalent changes, apply `changes-requested`,
  remove `merge-queue`, and stop.
- If only partial overlap exists: note the redundant parts as a finding and continue reviewing the
  genuinely new changes.

## 2c. Diff-level automated checks (mandatory findings)

Before the full code-review skill, scan the diff for hard-rule violations. These are mandatory
findings, not heuristics.

```bash
gh pr diff {prNumber}
gh pr diff {prNumber} --name-only
```

**Critical** — event ID removed/renamed in `events.ts`; widget spot ID removed/renamed in
`injection-table.ts`; field removed from an API response schema/zod response type; DB column/table
renamed or removed in a migration; public import path removed without a re-export bridge; missing
`organization_id`/`tenant_id` filter on a tenant-scoped query.

**High** — `findWithDecryption`/`findOneWithDecryption` downgraded to raw `em.find`/`em.findOne`; new
API route file missing `export const openApi` or `export const metadata`; new subscriber/worker
missing `export const metadata`; raw `fetch(` in UI/backend page code outside tests; new raw
`em.findOne(`/`em.find(` in non-test production code (`gh pr diff {prNumber} | grep "^+" | grep -v "test\." | grep -v "__tests__" | grep "em\.find"`); behavior change with no corresponding test file.

**Medium** — hardcoded user-facing string in API errors/UI labels; new `any` outside tests;
`alert(`/custom toast instead of `flash()`; hand-written migration SQL without snapshot update or
scope rationale; entity schema changed but no migration/no-op rationale; missing tenant scoping in
sub-entity queries; new/modified i18n locale keys not alphabetically ordered.

**Low** — one-letter variable name outside loop counters `i`/`j`/`k`; inline comment on
self-explanatory code; docstring/comment added to an unchanged function.

## 2d. Run the full code-review skill inside the worktree

Execute `.ai/skills/om-code-review/SKILL.md` in the isolated worktree. Mandatory scope and gates:

- Scope changed files with `gh pr diff {prNumber} --name-only`.
- Gather context from all matching `AGENTS.md` files, related specs, and `.ai/lessons.md`.
- **Prefer the GitHub check results gathered in step 1e.** Run the local CI/CD verification gate only
  for scopes GitHub did not cover, or when GitHub check data was unavailable — and run it
  script-probed via `has_script`/`run_if_present` (environment §3), so template-only scripts
  (`i18n:*`, `build:packages`, `build:app`) become logged no-ops instead of failures. Custom modules
  live at `src/modules/…` (environment §4).
- Run `yarn template:sync` if present; check `BACKWARD_COMPATIBILITY.md`.
- Apply the full review checklist; verify test coverage and cross-module impact.

Merge the step 2c findings into the final review report — do not list the same issue twice.

## 2e. Classify the result

Use the `om-code-review` severity model:

| Condition | Decision |
|-----------|----------|
| Any Critical, High, or Medium finding | `changes_requested` |
| Only Low findings | `approved` |
| No findings | `approved` |

Proceed to `step-3-verdict-and-labels.md`.
