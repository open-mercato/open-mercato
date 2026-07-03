# Step 1 — Claim the issue, prove it needs work, and triage

Load `../references/environment.md` first for base-branch/label/script/layout/claim rules.

## 1a. In-progress concurrency check (claim the issue)

Auto-skills MUST NOT clobber each other. Before doing anything else, decide whether you may claim
this issue.

```bash
CURRENT_USER=$(gh api user --jq '.login')
gh issue view {issueId} --repo {owner}/{repo} --json assignees,labels,number,title,comments
```

An issue is **already in progress** when ANY of these is true:

- It carries the `in-progress` label.
- It has at least one assignee whose login is not `$CURRENT_USER` (a human or another bot took it).
- A claim comment newer than 30 minutes exists from another actor (look for the `🤖` start marker).
- An open PR already references it via `Fixes #{issueId}` / `Closes #{issueId}` (handled in 1c — the lock check still applies).

Decision tree:

| State | `--force` set? | Action |
|-------|---------------|--------|
| Not in progress | — | Claim and proceed |
| In progress, current user owns the lock | — | Treat as re-entry; proceed without re-claiming |
| In progress, someone else owns the lock | no | **STOP.** Ask via `AskUserQuestion`: "Issue #{issueId} is in progress (owner: {owner}, signal: {label/assignee/comment}). Override and continue?" Continue only on an explicit yes. |
| In progress, someone else owns the lock | yes | Post a force-override comment naming the previous owner, then claim and proceed |

Stale lock recovery: if the `in-progress` label is older than 60 minutes and the assignee did not
push or comment in that window, treat it as expired. Still ask the user before overriding unless
`--force` was set.

### Claim the issue (only after the check above passes)

```bash
gh issue edit {issueId} --repo {owner}/{repo} --add-assignee "$CURRENT_USER"
gh issue edit {issueId} --repo {owner}/{repo} --add-label "in-progress"   # skip-and-log if the repo lacks it (environment §2/§5)
gh issue comment {issueId} --repo {owner}/{repo} --body "🤖 \`auto-fix-github\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). Other auto-skills will skip this issue until the lock is released."
```

If the `in-progress` label does not exist, claim with assignee + claim comment alone — never
silently skip the claim (environment §5). The lock MUST be released at the end (step 5) even on
failure — use a `trap`/finally so a crash still clears the label and posts a completion comment.

## 1b. Resolve repository and fetch the issue

If `{repo}` is not provided, infer it from the current checkout:

```bash
gh repo view --json nameWithOwner,defaultBranchRef
gh issue view {issueId} --repo {owner}/{repo} --json number,title,body,state,author,url,labels,assignees,comments
```

Capture at least: repository name; issue title, URL, state, author; issue body and recent comments.

Resolve the base branch with `resolve_base_branch` (environment §1) — never assume `develop`:

```bash
BASE_BRANCH="$(resolve_base_branch)"
```

## 1c. Check whether the issue is already solved or already in progress

Do this before creating a worktree or writing code.

```bash
gh issue view {issueId} --repo {owner}/{repo} --json state
gh search prs --repo {owner}/{repo} "#{issueId}" --state open --json number,title,url,state
gh search prs --repo {owner}/{repo} "#{issueId}" --state merged --json number,title,url,state
git fetch origin "$BASE_BRANCH"
git log "origin/$BASE_BRANCH" --grep="#{issueId}" --oneline
```

Also inspect issue comments for `fixed by`, `duplicate of`, `superseded by`, and links to PRs or
commits.

Stop early when any of these are true:

- the issue is already closed with a credible fix
- an open PR already appears to solve the issue
- the base branch already contains a fix for the issue

If you stop, report what you found and include the relevant PR or commit link instead of
duplicating work. Release the lock (step 5) before finishing.

## 1d. Triage before coding

Read enough project context to avoid blind fixes: relevant `AGENTS.md` files from the root Task
Router, related specs in `.ai/specs/`, and `.ai/lessons.md`. Then reduce the issue to: expected
behavior, actual behavior, likely root cause, affected module (`src/modules/<module>/` — see
environment §4), and the smallest safe fix scope.

If the issue is ambiguous, infer the intended behavior from code, tests, specs, or comments before
asking the user. Then proceed to `step-2-worktree-fix-and-tests.md`.
