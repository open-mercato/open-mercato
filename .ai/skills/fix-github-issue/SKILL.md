---
name: fix-github-issue
description: Fix a GitHub issue by number from the current repository. First check whether the issue is already solved or already has an open solution, then use an isolated git worktree to implement the minimal fix, add unit tests, run code review and backward-compatibility checks, run validation including i18n, typecheck, unit tests, and other required checks, then push a branch and open a pull request with a full description linked to the original issue.
---

# Fix GitHub Issue

Fix a GitHub issue end to end without disturbing the user’s active worktree. Start by proving the issue still needs work. If it does, implement the smallest correct fix, add regression coverage, run the required checks, review the change against project rules, and open a PR that links back to the original issue.

## Arguments

- `{issueId}` (required) — the GitHub issue number, for example `1234`
- `{repo}` (optional) — `owner/name`; if omitted, infer from the current git remote
- `--force` (optional) — bypass the in-progress concurrency check; use when intentionally taking over an issue that another auto-skill or human contributor already claimed

## Workflow

### 0. In-progress concurrency check (claim the issue)

Auto-skills MUST NOT clobber each other. Before doing anything else, decide whether you may claim this issue.

```bash
CURRENT_USER=$(gh api user --jq '.login')
gh issue view {issueId} --repo {owner}/{repo} --json assignees,labels,number,title,comments
```

An issue is considered **already in progress** when ANY of the following is true:

- It carries the `in-progress` label
- It has at least one assignee whose login is not `$CURRENT_USER` (a human contributor or another bot has already taken it)
- A claim comment newer than 30 minutes exists from another actor (look for the `🤖` start marker)
- An open PR already references it via `Fixes #{issueId}` / `Closes #{issueId}` (handled in step 2 below — but the lock check still applies)

Decision tree:

| State | `--force` set? | Action |
|-------|---------------|--------|
| Not in progress | — | Claim and proceed |
| In progress, current user owns the lock | — | Treat as re-entry; proceed without re-claiming |
| In progress, someone else owns the lock | no | **STOP**. Ask the user via `AskUserQuestion`: "Issue #{issueId} is in progress (owner: {owner}, signal: {label/assignee/comment}). Override and continue?" Only continue when the user explicitly says yes. |
| In progress, someone else owns the lock | yes | Post a force-override comment naming the previous owner, then claim and proceed |

Stale lock recovery:

- If the `in-progress` label is older than 60 minutes and the assignee did not push or comment in that window, treat it as expired. Still ask the user before overriding unless `--force` was set.

#### Claim the issue (only after the check above passes)

```bash
gh issue edit {issueId} --repo {owner}/{repo} --add-assignee "$CURRENT_USER"
gh issue edit {issueId} --repo {owner}/{repo} --add-label "in-progress"
gh issue comment {issueId} --repo {owner}/{repo} --body "🤖 \`fix-github-issue\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). Other auto-skills will skip this issue until the lock is released."
```

The release step happens at the end of step 11 — the lock MUST be released even on failure. Use a `trap` or finally-block so a crash still clears the label and posts a completion comment.

### 1. Resolve repository and fetch the issue

If `{repo}` is not provided, infer it from the current checkout:

```bash
gh repo view --json nameWithOwner,defaultBranchRef
gh issue view {issueId} --repo {owner}/{repo} --json number,title,body,state,author,url,labels,assignees,comments
```

Capture at least:

- repository name
- issue title, URL, state, author
- issue body and recent comments

**Base branch**: Always use `develop` as the base branch for fix branches and PRs, regardless of the repository's default branch. The `develop` branch is the active integration branch; `main` receives merges from `develop` at release time.

### 2. Check whether the issue is already solved or already has a solution in progress

Do this before creating a worktree or writing code.

Recommended checks:

```bash
gh issue view {issueId} --repo {owner}/{repo} --json state
gh search prs --repo {owner}/{repo} "#{issueId}" --state open --json number,title,url,state
gh search prs --repo {owner}/{repo} "#{issueId}" --state merged --json number,title,url,state
git fetch origin develop
git log origin/develop --grep="#{issueId}" --oneline
```

Also inspect issue comments for phrases like:

- `fixed by`
- `duplicate of`
- `superseded by`
- links to PRs or commits

Stop early when any of these are true:

- the issue is already closed with a credible fix
- an open PR already appears to solve the issue
- the default branch already contains a fix for the issue

If you stop, report what you found and include the relevant PR or commit link instead of duplicating work.

### 3. Triage the issue before coding

Read enough project context to avoid blind fixes:

- relevant `AGENTS.md` files from the root router
- related specs in `.ai/specs/` or `.ai/specs/enterprise/`
- `.ai/lessons.md`

Then reduce the issue to:

- expected behavior
- actual behavior
- likely root cause
- affected module or package
- the smallest safe fix scope

If the issue is ambiguous, try to infer the intended behavior from code, tests, specs, or issue comments before asking the user.

### 4. Create an isolated issue-fix worktree

Never implement the fix in the repository’s primary worktree.

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
WORKTREE_PARENT="$REPO_ROOT/.ai/tmp/fix-github-issue"
CREATED_WORKTREE=0

if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  WORKTREE_DIR="$PWD"
else
  WORKTREE_DIR="$WORKTREE_PARENT/issue-{issueId}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$WORKTREE_PARENT"
  git fetch origin develop
  git worktree add --detach "$WORKTREE_DIR" "origin/develop"
  CREATED_WORKTREE=1
fi

cd "$WORKTREE_DIR"
git checkout -B "codex/issue-{issueId}-{slug}" "origin/develop"
yarn install --mode=skip-build
```

If `--mode=skip-build` is unavailable, run plain `yarn install`.

Rules:

- If you are already in a linked worktree, reuse it instead of creating a nested worktree.
- The repository’s main worktree must remain untouched.
- All debugging, code changes, testing, and PR prep happen inside the isolated worktree.
- Always clean up the temporary worktree at the end, but only if you created it in this run.

Cleanup sequence:

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then
  git worktree remove --force "$WORKTREE_DIR"
fi
```

### 5. Reproduce or anchor the bug

Before fixing, anchor the issue in code or tests.

Preferred order:

1. Reproduce via an existing failing unit or integration test.
2. Reproduce via a targeted command or local code path.
3. If reproduction is expensive or indirect, encode the missing behavior as a failing unit test first.

Do not skip the reproduction step unless the issue is a trivial static defect and the intended fix is self-evident.

### 6. Implement the minimal fix

Fix the issue with the smallest defensible code change.

Rules:

- Do not refactor unrelated code.
- Do not broaden scope “while you’re here”.
- Preserve existing contracts unless the issue explicitly requires a compatibility-managed change.
- Prefer modifying the narrowest module or function that owns the bug.

### 7. Add regression tests (mandatory, autonomous)

Every issue fix MUST include test coverage. This is non-negotiable and must be done autonomously — never skip tests or ask the user whether to add them.

Minimum requirement:

- add or update unit tests that fail before the fix and pass after it

Escalate beyond unit tests when needed:

- add integration tests for risky user flows, permissions, tenant isolation, workflows, or multi-module behavior

Test requirements:

- tests must prove the issue is fixed
- tests must be self-contained
- tests should target the smallest meaningful scope
- tests must pass before the fix is pushed — iterate until they do

### 8. Run the fix-validation loop

Do not stop after one edit. Keep iterating until the issue is fixed and the change is reviewable.

Per iteration:

1. Run unit tests for every changed package or module.
2. Run typecheck for every changed package or module.
3. If i18n files or user-facing strings changed, run:
   - `yarn i18n:check-sync`
   - `yarn i18n:check-usage`
4. If module structure, generated files, entities, or routes changed, run the required generators and follow-up checks:
   - `yarn generate`
   - `yarn build:packages`
   - `yarn db:generate` when entity schema changed
   - `yarn template:sync` when template-covered files changed
5. Re-read the diff and remove any accidental scope creep.

Before publishing, run the full CI/CD verification gate from the `code-review` skill:

- `yarn build:packages`
- `yarn generate`
- `yarn build:packages`
- `yarn i18n:check-sync`
- `yarn i18n:check-usage`
- `yarn typecheck`
- `yarn test`
- `yarn build:app`

If the full gate is too expensive to run immediately while debugging, do targeted checks first, but the full gate must pass before you open or update the PR unless a real blocker prevents it.

### 9. Run code review and backward-compatibility review on your own fix

Before publishing, run the change through the same review discipline as an incoming PR.

Use `.ai/skills/code-review/SKILL.md` and `BACKWARD_COMPATIBILITY.md`.

You must explicitly verify:

- no frozen or stable contract surface was broken without the deprecation protocol
- no API response fields were removed
- no event IDs, widget spot IDs, ACL IDs, import paths, or DI names were broken
- no tenant isolation or encryption rules were violated
- the fix remains minimal and does not introduce unrelated churn

If your self-review finds new issues, fix them and repeat the validation loop.

### 10. Commit and push the fix branch

Only publish after the latest fix state:

- includes regression tests
- passes the required validation
- passes self-review and BC checks

Suggested branch naming:

- `codex/issue-{issueId}-{slug}`

Suggested commit style:

- `fix(issue #{issueId}): {short summary}`

**PR title convention**: Use conventional-commit-style prefixes scoped to the affected module or area:

- `fix(<area>): <short summary> (#issueId)` — for bug fixes (most issue fixes)
- `feat(<area>): <short summary> (#issueId)` — for new features
- `refactor(<area>): <short summary> (#issueId)` — for refactors
- `security(<area>): <short summary> (#issueId)` — for security fixes

Where `<area>` is the primary affected module or package (e.g., `auth`, `feature_toggles`, `catalog`, `ui`, `shared`). Examples:

- `fix(auth): prevent privilege escalation via role name spoofing (#1427)`
- `feat(catalog): add bulk product import endpoint (#1500)`

Push with tracking:

```bash
git push -u origin "$(git branch --show-current)"
```

### 11. Open the PR and release the issue lock

Open a PR against `develop` using the current repository.

The PR should:

- link the original issue
- describe the root cause
- describe exactly what changed
- mention the added regression tests
- summarize the checks you ran
- call out BC status when relevant

Recommended body structure:

```markdown
Fixes #{issueId}

## Problem
- {brief issue summary}

## Root Cause
- {root cause}

## What Changed
- {change 1}
- {change 2}

## Tests
- {unit tests added or updated}
- {other checks}

## Backward Compatibility
- No contract surface changes
```

If the issue is in another repository or should not auto-close, replace `Fixes #{issueId}` with a plain issue link.

#### Release the in-progress lock on the issue

Always run this as a finally-block — even if the PR open failed or the run was aborted earlier:

```bash
gh issue edit {issueId} --repo {owner}/{repo} --remove-label "in-progress"
gh issue comment {issueId} --repo {owner}/{repo} --body "🤖 \`fix-github-issue\` completed: opened ${PR_URL:-(no PR — fix aborted)}. Lock released."
```

Rules:

- Keep the issue assignee as the current user — it shows who owns the resulting PR
- Remove the `in-progress` label so other auto-skills can act on the issue (e.g., a follow-up reviewer)
- Post a completion comment that links the PR (or notes the abort) so the timeline stays auditable

### 12. Report back

Summarize:

```text
Issue #{issueId}: {title}
Status: {fixed | already solved | already in progress | blocked}
Branch: {branch}
PR: {url}
Tests: {summary}
```

If you stopped because a fix already exists, report the existing PR or commit instead of creating a new one.

## Rules

- Always run the step 0 in-progress check before any other action; never silently override another actor's claim
- Always release the `in-progress` lock on the issue at the end of step 11, even if the run fails or is aborted (use a trap/finally)
- Always check whether the issue is already solved before writing code
- Always use an isolated worktree
- Reuse the current linked worktree when already inside one; do not create nested worktrees
- Keep the fix scope minimal
- Every fix MUST include regression tests — this is non-negotiable; never push without tests, never ask whether to add them
- Run targeted tests and typecheck while iterating — all tests must pass before pushing
- Run i18n checks when user-facing strings or locale files changed; auto-fix with `--fix` if issues are found
- Run the full code-review skill and BC check before publishing; auto-fix any actionable findings from the self-review
- Do not open a PR with known failing required checks unless a real blocker prevents completion and you explain that blocker explicitly
- Link the issue in the PR and explain what changed and why
- Always clean up any temporary worktree created by the current run
