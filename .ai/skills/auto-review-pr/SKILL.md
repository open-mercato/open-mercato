---
name: auto-review-pr
description: Review or re-review a GitHub pull request by number in an isolated git worktree. Fetch the specific PR from GitHub, run the full code-review skill, submit approve or request-changes, manage labels, and if blockers remain offer an optional autofix and fix-forward flow that iterates through conflict resolution, code fixes, unit tests, typecheck, and re-review until the PR is merge-ready or a real blocker remains. Usage - /auto-review-pr <PR-number>
---

# Auto Review PR

Review a GitHub pull request by number without touching the current worktree. Always fetch the exact PR from GitHub, review it in an isolated worktree, submit the verdict, and if the PR still has blockers offer an explicit autofix flow that keeps resolving conflicts, fixing code, testing, typechecking, and re-reviewing until the PR is actually ready or a non-actionable blocker remains.

## Arguments

- `{prNumber}` (required) — the PR number to review or re-review (for example `1234`)
- `--force` (optional) — bypass the in-progress concurrency check; use when intentionally taking over a PR that another auto-skill or human already claimed

## Workflow

### 0. In-progress concurrency check (claim the PR)

Auto-skills MUST NOT clobber each other. Before doing anything else, decide whether you may claim this PR.

```bash
CURRENT_USER=$(gh api user --jq '.login')
gh pr view {prNumber} --json assignees,labels,number,title,comments
```

A PR is considered **already in progress** when ANY of the following is true:

- It carries the `in-progress` label
- It has at least one assignee whose login is not `$CURRENT_USER`
- A claim comment newer than 30 minutes exists from another actor (look for the `🤖` start marker)

Decision tree:

| State | `--force` set? | Action |
|-------|---------------|--------|
| Not in progress | — | Claim and proceed |
| In progress, current user owns the lock | — | Treat as re-entry; proceed without re-claiming |
| In progress, someone else owns the lock | no | **STOP**. Ask the user via `AskUserQuestion`: "PR #{prNumber} is in progress (owner: {owner}, signal: {label/assignee/comment}). Override and continue?" Only continue when the user explicitly says yes. |
| In progress, someone else owns the lock | yes | Post a force-override comment naming the previous owner, then claim and proceed |

Stale lock recovery:

- If the `in-progress` label is older than 60 minutes and the assignee did not push or comment in that window, treat it as expired. Still ask the user before overriding unless `--force` was set.

#### Claim the PR (only after the check above passes)

```bash
gh pr edit {prNumber} --add-assignee "$CURRENT_USER"

# Apply the in-progress label via the same GraphQL flow used for pipeline labels
# (kept atomic with the pipeline label transitions in step 8)

gh pr comment {prNumber} --body "🤖 \`auto-review-pr\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). Other auto-skills will skip this PR until the lock is released."
```

The release step happens in step 11 — the lock MUST be released even on failure.

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

Never review directly in the repository’s primary worktree.

First detect whether you are already inside a linked worktree:

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

If you reused an existing linked worktree, repoint it deliberately to the PR branch or a fresh local branch for that PR before continuing. If you created a new worktree, use the GitHub pull ref so the checkout works for both same-repo PRs and fork PRs.

After selecting the worktree, ensure you are on the correct PR branch context:

```bash
cd "$WORKTREE_DIR"
git fetch origin "pull/{prNumber}/head"
git checkout -B "review/pr-{prNumber}" FETCH_HEAD
git fetch origin "{baseRefName}"
```

Rules:

- If you are already in a linked worktree, reuse it instead of creating a nested worktree.
- The repository’s main worktree must remain untouched.
- Review, testing, and any optional follow-up fixes must happen inside the isolated worktree.
- Always clean up the temporary worktree at the end, even on failure, but only if you created it in this run.

Before running any Yarn-based validation in the new worktree, restore the package-manager install state:

```bash
yarn install --mode=skip-build
```

If `--mode=skip-build` is unavailable in the current Yarn version, run plain `yarn install`.

Cleanup sequence:

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then
  git worktree remove --force "$WORKTREE_DIR"
fi
```

### 4a. Check for duplicated or already-merged changes

Before proceeding with the full review, verify that the PR does not duplicate work already present in the base branch. This catches cases where:

- The base branch already contains the same fix (e.g., merged via a different PR)
- A parallel PR landed the same feature while this one was open
- The PR's changes are a subset of recently merged work

Steps:

1. Get the list of changed files from the PR diff:
   ```bash
   gh pr diff {prNumber} --name-only
   ```

2. For each changed file, compare the PR version against the base branch version to identify overlap:
   ```bash
   git diff origin/{baseRefName} -- <file>
   ```

3. Check recent commits on the base branch that touch the same files:
   ```bash
   git log origin/{baseRefName} --oneline -20 -- <files>
   ```

4. Look for semantic duplication — the same logic, function, or fix already present in the base branch even if the code differs slightly.

If the PR's core changes are already present in the base branch:
- Submit a changes-requested review explaining that the changes duplicate already-merged work.
- List the specific commits or PRs in the base branch that already contain the equivalent changes.
- Apply `changes-requested`, remove `merge-queue`, and stop.

If partial overlap exists (some changes are new, some are redundant):
- Note the redundant parts as a finding in the review.
- Continue reviewing the genuinely new changes.

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
| New raw `em.findOne(` or `em.find(` in non-test production code (grep the diff: `gh pr diff {prNumber} \| grep "^+" \| grep -v "test\." \| grep -v "__tests__" \| grep "em\.find"`) | High: must use `findOneWithDecryption`/`findWithDecryption` from `@open-mercato/shared/lib/encryption/find` |
| Behavior change with no corresponding test file in the diff | High: behavior changes must include tests |

#### Medium auto-detections

| Pattern in diff | Finding |
|-----------------|---------|
| Hardcoded user-facing string in API errors or UI labels | Medium: must use i18n |
| New `any` type annotation outside tests | Medium: use zod plus `z.infer` |
| `alert(` or custom toast instead of `flash()` | Medium: use `flash()` |
| Hand-written migration SQL file | Medium: never hand-write migrations |
| Entity schema changed but no migration file in the diff | Medium: run `yarn db:generate` |
| Missing explicit tenant scoping in sub-entity queries | Medium: defense in depth |
| New or modified i18n locale JSON keys not in alphabetical order | Medium: CI i18n-check-sync requires sorted keys — run `yarn i18n:check-sync --fix` or sort manually |

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

Pipeline labels:

- `review`
- `changes-requested`
- `qa`
- `qa-failed`
- `merge-queue`
- `blocked`
- `do-not-merge`

Keep `in-progress` separate from the pipeline-state helper. It is a lock, not a workflow state.

Define and reuse a shared helper such as `setPipelineLabel(prNumber, newLabel)` that:

- adds `newLabel`
- removes every other pipeline label from the list above
- preserves category labels (`bug`, `feature`, `refactor`, `security`, `dependencies`, `enterprise`, `documentation`) and meta labels (`needs-qa`, `skip-qa`, `in-progress`)
- uses the GraphQL API for atomicity

After every pipeline-label change, post a short PR comment explaining why that label was chosen. Keep it to one short sentence.

Label rules:

- If the PR has no pipeline label when review starts, set `review` before continuing so the state machine is explicit.
- If the verdict is changes requested, set `changes-requested`.
- If the verdict is approved and the PR has `needs-qa` but not `skip-qa`, set `qa`.
- If the verdict is approved and the PR does not require QA, set `merge-queue`.
- Never leave `review`, `changes-requested`, `qa`, `qa-failed`, and `merge-queue` on the same PR together.

Suggested label comments:

- `review`: `Label set to \`review\` because this PR is ready for code review.`
- `changes-requested`: `Label set to \`changes-requested\` because review found actionable issues.`
- `qa`: `Label set to \`qa\` because code review passed and manual QA is still required.`
- `merge-queue`: `Label set to \`merge-queue\` because the required review gates passed.`
- `blocked`: `Label set to \`blocked\` because progress depends on an external blocker.`
- `do-not-merge`: `Label set to \`do-not-merge\` because this PR should not merge yet.`

#### Author handoff on `changes-requested`

When the verdict is `changes-requested`, reassign the PR back to the original PR author after the review and pipeline label are posted, unless the author is the current reviewer, a bot account, or otherwise unavailable.

Suggested flow:

```bash
PR_AUTHOR=$(gh pr view {prNumber} --json author --jq '.author.login')

if [ -n "$PR_AUTHOR" ] && [ "$PR_AUTHOR" != "$CURRENT_USER" ]; then
  gh pr edit {prNumber} --remove-assignee "$CURRENT_USER"
  gh pr edit {prNumber} --add-assignee "$PR_AUTHOR"
  gh pr comment {prNumber} --body "Thanks @${PR_AUTHOR} — review found actionable items, so I’m handing this PR back to you for the next pass. When the updates are pushed, re-request review and the automation can pick it up from the latest head."
fi
```

Rules:

- Do this for every `changes-requested` outcome, including early exits for conflicts, failing required checks, or duplicate/already-merged work.
- If the author cannot be assigned (bot/deleted account/permission issue), keep the current assignee and leave the same handoff comment without the reassignment claim.
- The handoff comment is separate from the short pipeline-label comment; keep both.

### 9. Autonomous autofix flow

After posting a `changes_requested` review, **immediately proceed to fix all actionable findings** without asking the user. The auto-review-pr skill must be fully autonomous — it reviews, fixes, re-reviews, and iterates until the PR is merge-ready or a truly critical blocker remains.

Only stop and ask the user in these critical situations:

- Ambiguous product or architecture decisions that could go multiple valid ways
- Missing credentials, environment access, or infrastructure failures
- Changes that would break backward compatibility in ways not covered by the deprecation protocol
- Scope expansion that would fundamentally change what the PR does

For everything else — missing tests, code style issues, i18n problems, type errors, lint failures, missing metadata exports, security hardening — fix them autonomously.

### 10. Autofix and fix-forward loop

Continue inside the isolated worktree.

Do not stop after the first patch. Treat autofix as an iterative loop:

0. **Unit test audit**: Before fixing code findings, check whether the PR includes unit tests for the changed behavior. If the PR has no test files in the diff (`*.test.ts`, `*.spec.ts`, `__tests__/*`), add appropriate unit tests as the first autofix action. Every behavior change, bug fix, or new feature must have corresponding test coverage — this is non-negotiable in autofix mode.
1. Convert the current review findings into a concrete fix list.
2. If the PR is currently conflicted, resolve conflicts against the latest base branch first.
3. Implement the next batch of fixable findings.
4. Run validation for the updated code:
   - Run relevant unit tests for every changed package or module.
   - Run relevant typecheck commands for every changed package or module.
   - If i18n locale files were added or modified, verify keys are alphabetically sorted (CI runs `yarn i18n:check-sync` which enforces this).
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
- Use conventional-commit-style messages scoped to the affected area: `fix(<area>): <summary>`, `feat(<area>): <summary>`, `refactor(<area>): <summary>`, etc.
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

- Use conventional-commit-style PR title scoped to the affected module or area: `fix(<area>): <summary>`, `feat(<area>): <summary>`, `refactor(<area>): <summary>`, etc. Where `<area>` is the primary affected module or package (e.g., `auth`, `catalog`, `ui`, `shared`)
- Include the original PR link
- Credit the original PR author explicitly
- State that the new PR carries forward the original work plus the requested fixes
- Mention that the branch was re-reviewed after autofix and is intended to be merge-ready
- Reassign the replacement PR to the original PR author when possible, and leave a handoff comment inviting them to do the next recheck from the carried-forward branch

Suggested replacement PR body:

```markdown
Supersedes #{prNumber}

Credit: original implementation by @{originalAuthor}. This follow-up PR carries that work forward with the requested fixes so it can merge without waiting on the original branch.

## Included work
- Original changes from #{prNumber}
- Follow-up fixes applied during re-review
```

Suggested replacement PR handoff comment:

```markdown
Thanks @{originalAuthor} — this replacement PR carries your original work forward with the requested fixes applied. Reassigning it to you so you can do the next recheck from the merge-ready branch.
```

Suggested original PR closing comment:

```markdown
Closing in favor of #{newPrNumber} ({newPrUrl}).

Credit to @{originalAuthor} for the original implementation. The replacement PR carries the same work forward with the requested fixes so it can merge without waiting on the fork branch.
```

### 11. Release the in-progress lock

Always release before the skill exits — even on failure. Use a `trap` or equivalent finally-block so a crash or early stop still clears the lock.

```bash
# Remove the in-progress label (use the same GraphQL label flow used elsewhere)

gh pr comment {prNumber} --body "🤖 \`auto-review-pr\` completed: ${VERDICT}. Lock released."
```

Rules:

- For `changes-requested` outcomes, the assignee should already be handed back to the original PR author before the lock is released
- For approved outcomes, keep the current assignee unless a later handoff explicitly changed it
- Remove the `in-progress` label
- Post a completion comment with the verdict (`APPROVED` or `CHANGES REQUESTED`) and a short summary
- If autofix mode ran, mention how many fix iterations completed

### 12. Report back

Print a concise summary to the user:

```text
PR #{prNumber}: {title}
Mode: {review | re-review}
Decision: {APPROVED | CHANGES REQUESTED}
Label: {qa | merge-queue | changes-requested}
Findings: {X critical, Y high, Z medium, W low}
Worktree: {path}
Review submitted successfully.
```

If all findings were auto-fixed, the summary should note that fixes were applied and the PR is ready for merge.

If a critical blocker remains that requires human judgment, the summary must describe the blocker and ask for guidance.

## Rules

- Always run the step 0 in-progress check before any other action; never silently override another actor's claim
- Always release the `in-progress` lock in step 11, even if the run fails or is aborted (use a trap/finally)
- Always fetch the specific PR from GitHub before acting
- After posting a changes-requested review, immediately proceed to auto-fix all actionable findings without asking the user — only stop for critical architectural decisions, missing credentials, or BC-breaking scope changes
- Always use an isolated worktree for checkout, review, validation, and optional fixes
- Reuse the current linked worktree when already inside one; do not create nested worktrees
- The repository’s main worktree must remain unchanged
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
- Always add the chosen pipeline label and remove every other pipeline label
- Always add a short PR comment explaining why the chosen pipeline label was applied
- Always hand `changes-requested` PRs back to the original author with an explicit reassignment/comment handoff when possible
- Approved PRs with `needs-qa` and without `skip-qa` must land in `qa`, not `merge-queue`
- Approved PRs without a QA requirement must land in `merge-queue`
- When a review starts on an unlabeled PR, apply `review` before continuing
- Always use the GraphQL API for label operations
- Never force-push unless the user explicitly approved it
- For fork PRs, prefer a replacement PR in the main repository over waiting for the original author
- Never close the original PR until the replacement PR is created successfully
- Always clean up any temporary worktree created by the current run
- In autofix mode, always verify the PR includes unit tests for changed behavior; if tests are missing, add them before addressing other findings
