---
name: review-pr
description: Review or re-review a GitHub pull request by number in an isolated git worktree. Fetch the specific PR from GitHub, run the full code-review skill, submit approve or request-changes, manage labels, and if blockers remain offer an optional autofix and fix-forward flow that iterates through conflict resolution, code fixes, unit tests, typecheck, and re-review until the PR is merge-ready or a real blocker remains. Usage - /review-pr <PR-number>
---

# Review PR

Review a GitHub pull request by number without touching the current worktree. Always fetch the exact PR from GitHub, review it in an isolated worktree, submit the verdict, and if the PR still has blockers offer an explicit autofix flow that keeps resolving conflicts, fixing code, testing, typechecking, and re-reviewing until the PR is actually ready or a non-actionable blocker remains.

## Arguments

- `{prNumber}` (required) — the PR number to review or re-review (for example `1234`)

## Workflow

### 1. Fetch PR metadata and reviewer context

Use GitHub as the source of truth. Collect enough data to decide whether this is a first review or a re-review and whether the PR comes from a fork.

```bash
gh pr view {prNumber} --json number,title,url,author,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,maintainerCanModify,mergeable,mergeStateStatus,reviewDecision,labels,latestReviews,reviews,commits,files
gh api user --jq '.login'
```

Capture at least:

- PR title, URL, base branch, head branch, head SHA
- author login
- whether the PR is cross-repository (`isCrossRepository`)
- whether maintainers can modify it (`maintainerCanModify`)
- existing labels
- existing reviews by the current reviewer

### 2. Decide whether this is a review or a re-review

Treat the run as a **re-review** when the current reviewer has already submitted a review on the PR. Use `reviews` first and `latestReviews` as a fallback.

Rules:

- If there is no prior review from the current reviewer, this is a normal review.
- If there is a prior review from the current reviewer and the PR head SHA changed after that review, this is a re-review of updated code.
- If there is a prior review from the current reviewer and the head SHA did not change, only continue when the user explicitly asked for a re-review. Otherwise, stop and report that there are no new commits to review.

When re-reviewing:

- Title the report `Re-review: {PR title}` instead of `Code Review: {PR title}`.
- Re-check all previous blocker areas before approving.
- Replace labels idempotently just like a first review.
- Submit a fresh review rather than assuming the previous review still applies.

### 3. Early-exit checks

Run these checks before the worktree is created. If either fails, skip the full code review and go straight to the changes-requested flow.

#### 3a. Check for merge conflicts

```bash
gh pr view {prNumber} --json mergeable,mergeStateStatus,baseRefName
```

If `mergeable` is `CONFLICTING` or `mergeStateStatus` is `DIRTY`, do not continue with checkout or review execution on the first pass.

Submit a changes-requested review with a conflict-focused body, apply the `changes-requested` label, remove `merge-queue`, and stop the first pass.

Important:

- On the initial review pass, conflicts are still an early stop.
- On the second pass, if the user approves autofix, conflicts become actionable work and must be resolved inside the isolated worktree or carry-forward branch before re-reviewing.

#### 3b. Check CI status

Discover required checks first:

```bash
gh api repos/{owner}/{repo}/branches/{baseRefName}/protection/required_status_checks --jq '.contexts[]' 2>/dev/null
```

If the branch protection API returns 404, treat all reported PR checks as required.

Fetch the actual PR check results:

```bash
gh pr checks {prNumber} --json name,state,link
```

Treat these states as failing:

- `FAILURE`
- `ERROR`
- `CANCELLED`
- `TIMED_OUT`

Ignore these as non-failing:

- `PENDING`
- `SUCCESS`
- `SKIPPED`
- `NEUTRAL`

If any required check is failing, do not continue with checkout or review execution. Submit a changes-requested review listing only the failing required checks, apply `changes-requested`, remove `merge-queue`, and stop.

### 4. Create an isolated worktree for the PR

Never review directly in the user’s current worktree.

Use the GitHub pull ref so the checkout works for both same-repo PRs and fork PRs:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREE_PARENT="$REPO_ROOT/.ai/tmp/review-pr"
WORKTREE_DIR="$WORKTREE_PARENT/pr-{prNumber}-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$WORKTREE_PARENT"
git fetch origin "pull/{prNumber}/head"
PR_HEAD_SHA=$(git rev-parse FETCH_HEAD)
git worktree add --detach "$WORKTREE_DIR" "$PR_HEAD_SHA"

cd "$WORKTREE_DIR"
git switch -c "review/pr-{prNumber}"
git fetch origin "{baseRefName}"
```

Rules:

- The main worktree must remain untouched.
- Review, testing, and any optional follow-up fixes must happen inside the isolated worktree.
- Always clean up the temporary worktree at the end, even on failure.

Before running any Yarn-based validation in the new worktree, restore the package-manager install state:

```bash
yarn install --mode=skip-build
```

If `--mode=skip-build` is unavailable in the current Yarn version, run plain `yarn install`.

Cleanup sequence:

```bash
cd "$REPO_ROOT"
git worktree remove --force "$WORKTREE_DIR"
git branch -D "review/pr-{prNumber}" 2>/dev/null || true
```

### 5. Diff-level automated checks

Before running the full code-review skill, scan the PR diff for hard-rule violations. Use:

```bash
gh pr diff {prNumber}
gh pr diff {prNumber} --name-only
```

Record findings from the patterns below. These are mandatory findings, not optional heuristics.

#### Critical auto-detections

| Pattern in diff | Finding |
|-----------------|---------|
| Removed or renamed event ID in any `events.ts` | Critical: event ID is a frozen contract surface |
| Removed or renamed widget spot ID in `injection-table.ts` | Critical: spot ID is a frozen contract surface |
| Removed field from an API response schema or zod response type | Critical: response fields are additive-only |
| Renamed or removed a database column or table in a migration | Critical: DB schema is additive-only |
| Removed a public import path without re-export bridge | Critical: import paths require deprecation protocol |
| Missing `organization_id` or `tenant_id` filter on a tenant-scoped query | Critical: tenant isolation breach |

#### High auto-detections

| Pattern in diff | Finding |
|-----------------|---------|
| `findWithDecryption` or `findOneWithDecryption` replaced with raw `em.find` or `em.findOne` | High: encryption helpers must not be downgraded |
| New API route file missing `export const openApi` or `export const metadata` | High: required exports for auto-discovery |
| New subscriber or worker file missing `export const metadata` | High: required exports for auto-discovery |
| Raw `fetch(` call in UI or backend page code, outside tests | High: must use `apiCall` or `apiCallOrThrow` |
| Behavior change with no corresponding test file in the diff | High: behavior changes must include tests |

#### Medium auto-detections

| Pattern in diff | Finding |
|-----------------|---------|
| Hardcoded user-facing string in API errors or UI labels | Medium: must use i18n |
| New `any` type annotation outside tests | Medium: use zod plus `z.infer` |
| `alert(` or custom toast instead of `flash()` | Medium: use `flash()` |
| Hand-written migration SQL file | Medium: never hand-write migrations |
| Entity schema changed but no migration file in the diff | Medium: run `yarn db:generate` |
| New raw `em.find` or `em.findOne` usage | Medium: use encryption helpers |
| Missing explicit tenant scoping in sub-entity queries | Medium: defense in depth |

#### Low auto-detections

| Pattern in diff | Finding |
|-----------------|---------|
| One-letter variable name outside loop counters `i`, `j`, `k` | Low: use descriptive names |
| Inline comment on self-explanatory code | Low: remove comment |
| Added docstring or comment on unchanged function | Low: do not annotate unchanged code |

### 6. Run the full code-review skill inside the worktree

Execute `.ai/skills/code-review/SKILL.md` in the isolated worktree.

Mandatory scope and gates:

- Scope changed files with `gh pr diff {prNumber} --name-only`
- Gather context from all matching `AGENTS.md` files, related specs, and `.ai/lessons.md`
- Run the full CI/CD verification gate
- Run `yarn template:sync`
- Check `BACKWARD_COMPATIBILITY.md`
- Apply the full review checklist
- Verify test coverage and cross-module impact

Merge findings from step 5 into the final review report. Do not duplicate the same issue twice.

### 7. Classify the result

Use the same severity rules as the `code-review` skill:

| Condition | Decision |
|-----------|----------|
| Any Critical, High, or Medium finding | `changes_requested` |
| Only Low findings | `approved` |
| No findings | `approved` |

### 8. Submit the verdict and labels

If approved, submit an approval review. If there are Critical, High, or Medium findings, submit a changes-requested review.

The review body must contain the full structured report from the code-review skill. For re-reviews, explicitly note that it is a re-review in the title or summary.

Use the GraphQL label mutation flow, not `gh pr edit --add-label`.

Label rules:

- `merge-queue`: `#0E8A16` — PR approved and ready to merge
- `changes-requested`: `#BA6609` — changes requested during review
- Always add the correct label and remove the opposite label

### 9. If blockers remain, ask the user whether to implement fixes

After posting a `changes_requested` review, stop and ask the user:

`This PR still has blockers. Do you want me to implement the fixes, commit them, and push the result?`

Do not modify code until the user answers yes.

### 10. Autofix and fix-forward flow after user approval

If the user approves implementation, continue inside the isolated worktree.

Do not stop after the first patch. Treat autofix as an iterative loop:

1. Convert the current review findings into a concrete fix list.
2. If the PR is currently conflicted, resolve conflicts against the latest base branch first.
3. Implement the next batch of fixable findings.
4. Run validation for the updated code:
   - Run relevant unit tests for every changed package or module.
   - Run relevant typecheck commands for every changed package or module.
   - If the review findings touched shared contracts or multiple packages, expand validation to the affected workspace scope.
5. Re-run the code review on the updated diff in the same worktree.
6. If new or remaining actionable findings exist, repeat from step 1.
7. Stop only when:
   - the re-review outcome is `approved`, or
   - a real blocker remains that cannot be resolved autonomously in the current turn.

Examples of real blockers:

- ambiguous product or architecture decisions that require user input
- environment or infrastructure failures unrelated to the changed code
- missing credentials or missing external access

Conflict-resolution rules for autofix mode:

- Resolve conflicts only inside the isolated worktree or carry-forward branch.
- Never attempt conflict resolution in the user's active worktree.
- Always fetch the latest `{baseRefName}` before resolving conflicts.
- After conflicts are resolved, rerun the relevant unit tests, typecheck, and code review before deciding the branch is ready.
- If conflict resolution introduces additional findings, continue the autofix loop instead of stopping.

For autofix mode, the goal is not "submit one fix commit". The goal is "finish the PR". Keep iterating until the code review is clean and validation passes, unless a real blocker stops progress.

#### 10a. Same-repo PRs

If the PR head branch is in the main repository and you have push access, implement the fixes on the checked-out PR branch, resolve any base-branch conflicts there if needed, run the autofix loop above, then commit and push to that branch only after the latest re-review is approvable.

Rules:

- Never force-push unless the user explicitly asked for it.
- Prefer a normal follow-up commit.
- Before pushing, ensure the latest autofix cycle included unit tests, typecheck, and a fresh code review on the final diff.

#### 10b. Fork PRs

For fork PRs, do not wait on the original author and do not push to the contributor’s branch by default.

Instead:

1. Keep the current worktree based on the fetched PR head SHA so the original commits and authorship are preserved.
2. Create a new branch in the main repository, for example `carry/pr-{prNumber}-ready`.
3. Implement the fixes there.
4. Resolve any conflicts against `{baseRefName}` on that carry-forward branch.
5. Run the autofix loop above until the branch is re-reviewed as approvable or a real blocker remains.
6. Commit and push the new branch to `origin`.
7. Open a replacement PR against `{baseRefName}`.
8. Close the original PR only after the replacement PR exists successfully.

Validation requirements for autofix mode:

- On every cycle, run unit tests for changed packages or modules.
- On every cycle, run typecheck for changed packages or modules.
- Before the final push, run at least one last unit-test pass and one last typecheck pass against the final branch state.
- If the original review required broader workspace validation, rerun the broader validation before opening or updating the replacement PR.

Replacement PR requirements:

- Include the original PR link
- Credit the original PR author explicitly
- State that the new PR carries forward the original work plus the requested fixes
- Mention that the branch was re-reviewed after autofix and is intended to be merge-ready

Suggested replacement PR body:

```markdown
Supersedes #{prNumber}: {originalUrl}

Credit: original implementation by @{originalAuthor}. This follow-up PR carries that work forward with the requested fixes so it can merge without waiting on the original branch.

## Included work
- Original changes from #{prNumber}
- Follow-up fixes applied during re-review
```

Suggested original PR closing comment:

```markdown
Closing in favor of #{newPrNumber} ({newPrUrl}).

Credit to @{originalAuthor} for the original implementation. The replacement PR carries the same work forward with the requested fixes so it can merge without waiting on the fork branch.
```

### 11. Report back

Print a concise summary to the user:

```text
PR #{prNumber}: {title}
Mode: {review | re-review}
Decision: {APPROVED | CHANGES REQUESTED}
Label: {merge-queue | changes-requested}
Findings: {X critical, Y high, Z medium, W low}
Worktree: {path}
Review submitted successfully.
```

If blockers remain, the summary must end by asking whether to implement the fixes.

## Rules

- Always fetch the specific PR from GitHub before acting
- Always use an isolated worktree for checkout, review, validation, and optional fixes
- The main worktree must remain unchanged
- Always restore Yarn install state inside the isolated worktree before running build, test, or typecheck commands
- On the first review pass, conflicts are an early-stop review outcome
- In autofix mode, conflicts must be resolved as part of the second run instead of being left as a permanent blocker
- In autofix mode, always rerun code review after each fix batch instead of assuming the previous findings list is complete
- In autofix mode, always run unit tests and typecheck for the changed scope on every iteration and again on the final branch state
- In autofix mode, continue iterating until the PR is ready or a real blocker is reported explicitly
- Must run the full CI/CD verification gate from the `code-review` skill
- Must use the `code-review` skill severity model
- Must run the diff-level automated checks in step 5
- The review body must contain the full structured report
- Always add the chosen label and remove the opposite label
- Always use the GraphQL API for label operations
- Never force-push unless the user explicitly approved it
- For fork PRs, prefer a replacement PR in the main repository over waiting for the original author
- Never close the original PR until the replacement PR is created successfully
- Always clean up the temporary worktree at the end
