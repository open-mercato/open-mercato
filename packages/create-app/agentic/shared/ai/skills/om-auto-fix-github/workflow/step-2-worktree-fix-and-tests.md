# Step 2 — Isolated worktree, minimal fix, regression tests

## 2a. Create an isolated issue-fix worktree

Never implement the fix in the repository's primary worktree.

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
WORKTREE_PARENT="$REPO_ROOT/.ai/tmp/auto-fix-github"
CREATED_WORKTREE=0

if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  WORKTREE_DIR="$PWD"
else
  WORKTREE_DIR="$WORKTREE_PARENT/issue-{issueId}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$WORKTREE_PARENT"
  git fetch origin "$BASE_BRANCH"
  git worktree add --detach "$WORKTREE_DIR" "origin/$BASE_BRANCH"
  CREATED_WORKTREE=1
fi

cd "$WORKTREE_DIR"
BRANCH_PREFIX="fix"
# Switch to `feat` only when the issue is clearly an enhancement or new capability,
# not a corrective change to existing behavior.
git checkout -B "${BRANCH_PREFIX}/issue-{issueId}-{slug}" "origin/$BASE_BRANCH"
yarn install --mode=skip-build   # fall back to plain `yarn install` if unsupported
```

`$BASE_BRANCH` comes from `resolve_base_branch` (environment §1) — never hard-code `develop`.

Rules:

- If you are already in a linked worktree, reuse it instead of creating a nested worktree.
- The repository's main worktree must remain untouched.
- All debugging, code changes, testing, and PR prep happen inside the isolated worktree.
- Never create `codex/...` branches; use `fix/` for corrective work or `feat/` for enhancements.
- Clean up the temporary worktree at the end (step 5) — but only if you created it in this run.

## 2b. Reproduce or anchor the bug

Before fixing, anchor the issue in code or tests. Preferred order:

1. Reproduce via an existing failing unit or integration test.
2. Reproduce via a targeted command or local code path.
3. If reproduction is expensive or indirect, encode the missing behavior as a failing unit test first.

Do not skip reproduction unless the issue is a trivial static defect and the intended fix is
self-evident.

## 2c. Implement the minimal fix

Fix the issue with the smallest defensible code change.

- Do not refactor unrelated code or broaden scope "while you're here".
- Preserve existing contracts unless the issue explicitly requires a compatibility-managed change.
- Prefer modifying the narrowest module or function that owns the bug.
- Custom modules live at `src/modules/<module>/`; framework source under
  `node_modules/@open-mercato/*/dist/` is read-only — eject instead of editing it (environment §4).

## 2d. Add regression tests (mandatory, autonomous)

Every issue fix MUST include test coverage. This is non-negotiable and done autonomously — never
skip tests or ask the user whether to add them.

- Minimum: add or update unit tests that fail before the fix and pass after it.
- Escalate to integration tests for risky user flows, permissions, tenant isolation, workflows, or
  multi-module behavior.
- Tests must prove the issue is fixed, be self-contained, target the smallest meaningful scope, and
  pass before the fix is pushed — iterate until they do.

Then proceed to `step-3-validate-and-review.md`.
