# Tracker provider: GitHub

This file is the GitHub implementation of the tracker operations contract (see `TEMPLATE.md` for the contract itself). Every skill in the collection performs issue/PR state management through **named tracker operations** — `**get-issue**`, `**comment-pr**`, and so on — and this file defines what each operation means for GitHub, using the `gh` CLI.

How it is used at runtime: `om-setup-agent-pipeline` copies this file into the repository at `.ai/trackers/github.md`, and the config's `tracker` field selects it. When a skill says "tracker operation **get-pr**", execute the command documented under that operation heading in the repo's copy. The repo's copy is authoritative: teams extend or override any operation by editing it — add flags, swap a command, append repo-specific conventions — and every skill picks the change up on its next run. An operation not covered by an edit keeps its behavior from this file's text as copied.

## Prerequisites

- `gh` CLI installed and authenticated. Verify with the **auth-check** operation before a batch run; fail fast when unauthenticated.
- All operations accept an optional `{repo}` (`owner/name`); when omitted, `gh` infers it from the current checkout's git remote. Pass `--repo {owner}/{repo}` explicitly whenever a skill operates on a repository other than the current one.

## Conventions

- Issue and PR identifiers are numbers; in text they are written `#123`.
- A PR is linked to the issue it resolves with `Fixes #{issueId}` (or `Closes #{issueId}`) in the PR body; GitHub then closes the issue on merge. To reference without auto-closing, use a plain issue link.
- PRs open as **drafts** when a skill says so; a human (or **mark-pr-ready**) promotes them.
- Claim/lock signals on an issue or PR are: assignee set to the automation user, the `in-progress` label, and a `🤖`-prefixed claim comment. All three are set on claim; the label is guarded (below).
- Long, multi-line comment bodies are posted with `--body-file` (or a heredoc via process substitution) so formatting is preserved.
- CI status truth comes from **get-pr-checks**; the set of *required* checks comes from **get-required-checks** (branch protection). When branch protection is not readable (404), treat every reported check as required.

## Label guards

Every label mutation goes through an existence guard so a missing label degrades to a logged skip instead of a failure, and `labels.enabled: false` in the config skips label operations entirely.

```bash
label_exists() {
  gh label list --limit 200 --json name --jq '.[].name' | grep -Fxq "$1"
}

# PR labels
apply_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  if label_exists "$1"; then
    gh pr edit "$2" --add-label "$1"
  else
    echo "Skipping label '$1' (not defined in this repo). Create it with: gh label create '$1'"
  fi
}

# Issue labels
apply_issue_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  if label_exists "$1"; then
    gh issue edit "$2" --add-label "$1"
  else
    echo "Skipping label '$1' (not defined in this repo). Create it with: gh label create '$1'"
  fi
}

remove_issue_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  if label_exists "$1"; then
    gh issue edit "$2" --remove-label "$1"
  fi
}

# Pipeline labels are mutually exclusive: setting one removes the others first.
set_pipeline_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  for label in $PIPELINE_LABELS; do
    [ "$label" = "$2" ] && continue
    gh pr edit "$1" --remove-label "$label" 2>/dev/null || true
  done
  apply_label "$2" "$1"
}
```

When operating on a different repository than the current checkout, add `--repo "$REPO"` to each command inside the guards and check label existence against that repo (`gh label list --repo "$REPO"`).

## Operations

### Identity and repository

#### auth-check
Verify the CLI is authenticated. → exit status.
```bash
gh auth status
```

#### current-user
→ the automation user's login.
```bash
CURRENT_USER=$(gh api user --jq '.login')
```

#### repo-info
→ `owner/name` handle and default branch of the current repository.
```bash
gh repo view --json nameWithOwner,defaultBranchRef
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

#### default-branch
→ the repository's default branch name (used when the config's `baseBranch` is `"auto"`).
```bash
BASE_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || true)
[ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$BASE_BRANCH" ] && BASE_BRANCH="main"
```

### Issues

#### get-issue
`{issueId}`, field list → issue data. Request only the fields the calling skill names.
```bash
gh issue view {issueId} --repo {owner}/{repo} --json number,title,body,state,author,url,labels,assignees,comments
```

#### search-issues
Query (text, `in:title,body`, state) → matching issues.
```bash
gh issue list --repo {owner}/{repo} --state open --search "<query> in:title,body" --json number,title,url
```

#### create-issue
Title, body, assignee, labels → created issue URL.
```bash
gh issue create --repo {owner}/{repo} --title "<title>" --assignee <login> --label <labels> --body "<body>"
```

#### close-issue
`{issueId}`, reason, closing comment.
```bash
gh issue close {issueId} --repo {owner}/{repo} --reason completed --comment "<comment>"
```

#### comment-issue
`{issueId}`, body (use a heredoc/body-file for multi-line bodies).
```bash
gh issue comment {issueId} --repo {owner}/{repo} --body "<body>"
```

#### assign-issue / unassign-issue
```bash
gh issue edit {issueId} --repo {owner}/{repo} --add-assignee "<login>"
gh issue edit {issueId} --repo {owner}/{repo} --remove-assignee "<login>"
```

#### label-issue / unlabel-issue
Always through the guards: `apply_issue_label "<label>" {issueId}` / `remove_issue_label "<label>" {issueId}`.

#### get-issue-comment
Comment id → body, author, URL.
```bash
gh api repos/{owner}/{repo}/issues/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
```

#### list-issue-comments
`{issueId or prNumber}` → conversation comments (PR conversation comments are issue comments on GitHub).
```bash
gh api repos/{owner}/{repo}/issues/{number}/comments --jq '.[] | {id,user:.user.login,body}'
```

### Pull requests

#### get-pr
`{prNumber}`, field list → PR data. Request only the fields the calling skill names; the full field set skills use:
```bash
gh pr view {prNumber} --json number,title,url,body,state,author,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,maintainerCanModify,mergeable,mergeStateStatus,reviewDecision,labels,latestReviews,reviews,commits,files,assignees,comments,mergedAt,mergeCommit,closingIssuesReferences
```

#### list-prs
State/search filters, field list, limit → PRs.
```bash
gh pr list --state open --json number,title,url,author,labels,reviewDecision,mergeable,mergeStateStatus,headRefName,baseRefName,updatedAt,isDraft,assignees --limit 100
gh pr list --state merged --search "merged:>=${SINCE_DATE}" --json number,title,url,body,author,mergedAt,mergeCommit,baseRefName,headRefName,closingIssuesReferences,labels --limit {limit}
gh pr list --state closed --search "closed:>=${SINCE_DATE} is:unmerged" --json number,title,url,body,author,closedAt,baseRefName,headRefName,closingIssuesReferences,labels --limit {limit}
```

#### search-prs
Free-text query (for example an issue reference) and state → matching PRs.
```bash
gh search prs --repo {owner}/{repo} "#{issueId}" --state open --json number,title,url,state
```

#### create-pr
Base branch, draft flag, title, body → PR.
```bash
gh pr create --repo {owner}/{repo} --base "$BASE_BRANCH" --draft --title "<title>" --body "<body>"
PR_URL=$(gh pr view --json url --jq .url)
PR_NUMBER=$(gh pr view --json number --jq .number)
```

#### comment-pr
`{prNumber}`, body. For long structured comments:
```bash
gh pr comment {prNumber} --body-file <path-or-process-substitution>
```

#### assign-pr / unassign-pr
```bash
gh pr edit {prNumber} --add-assignee "<login>"
gh pr edit {prNumber} --remove-assignee "<login>"
```

#### label-pr / unlabel-pr
Always through the guards: `apply_label "<label>" {prNumber}` / `set_pipeline_label {prNumber} "<label>"` for the mutually exclusive pipeline group; direct removal:
```bash
gh pr edit {prNumber} --remove-label "<label>"
```

#### get-pr-diff
`{prNumber}` → full diff, or the changed-file list with `--name-only`.
```bash
gh pr diff {prNumber}
gh pr diff {prNumber} --name-only
```

#### get-pr-files
`{prNumber}` → changed files with per-file status (added/modified/removed), paginated.
```bash
gh api "repos/{owner}/{repo}/pulls/{prNumber}/files" --paginate --jq '.[] | {path: .filename, status: .status}'
```

#### checkout-pr
`{prNumber}` → the PR's head available locally (needed for cross-repository fork PRs where the head branch cannot be fetched from `origin`).
```bash
gh pr checkout {prNumber} --recurse-submodules=no
```

#### review-pr
`{prNumber}`, verdict (approve / request changes), body.
```bash
gh pr review {prNumber} --approve --body "<body>"
gh pr review {prNumber} --request-changes --body "<body>"
```
GitHub rejects self-approval (reviewing your own PR); surface that instead of working around it.

#### merge-pr
`{prNumber}`; squash is the default merge strategy. `--auto` merges when checks pass; `--delete-branch` only when asked.
```bash
gh pr merge {prNumber} --squash
```

#### mark-pr-ready
Promote a draft PR.
```bash
gh pr ready {prNumber}
```

#### get-pr-checks
`{prNumber}` → CI check runs with name, state, and link.
```bash
gh pr checks {prNumber} --json name,state,link
```

#### get-required-checks
Base branch → the set of required status checks. A 404 means branch protection is not readable — treat all reported checks as required.
```bash
gh api repos/{owner}/{repo}/branches/{baseRefName}/protection/required_status_checks --jq '.contexts[]' 2>/dev/null
```

#### get-pr-comment / get-review-comment
Conversation comment id (`issuecomment-<id>` links) vs inline review comment id (`discussion_r<id>` links) → body, author, URL.
```bash
gh api repos/{owner}/{repo}/issues/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
gh api repos/{owner}/{repo}/pulls/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
```

### CI runs

CI status for a *PR* comes from **get-pr-checks** / **get-required-checks** above. The operations here address CI runs directly — needed when working from a bare branch, or when a failure diagnosis needs the actual logs.

#### list-runs
Branch (or head SHA) → recent workflow runs with id, workflow name, status, and conclusion.
```bash
gh run list --branch {branch} --limit 20 --json databaseId,workflowName,name,status,conclusion,headSha,url,createdAt
```

#### get-run
Run id → status, conclusion, and per-job breakdown.
```bash
gh run view {runId} --json status,conclusion,workflowName,headSha,url,jobs
```

#### get-run-failed-logs
Run id → the log output of failed steps only. This is the primary diagnosis input for CI failures.
```bash
gh run view {runId} --log-failed
```

#### rerun-failed
Run id → re-execute only the failed jobs of that run. Use to disambiguate flaky failures before changing any code.
```bash
gh run rerun {runId} --failed
```

#### watch-run
Run id → block until the run completes, exiting non-zero on failure. Prefer this over sleep-polling; fall back to periodic **get-run** when watching is unavailable.
```bash
gh run watch {runId} --exit-status
```

### Labels

#### list-labels
→ all label names defined in the repo.
```bash
gh label list --limit 200 --json name --jq '.[].name'
```

#### create-label
Name, color, description. Never delete, rename, or recolor existing labels.
```bash
gh label create <name> --color <hex> --description "<description>"
```

#### ensure-label-taxonomy
Create every label from the config's taxonomy that does not exist yet (used by `om-setup-agent-pipeline`; skip ones that already exist per **list-labels**):
```bash
gh label create review            --color 0366d6 --description "Ready for code review"
gh label create changes-requested --color b60205 --description "Reviewer requested changes"
gh label create qa                --color fbca04 --description "Manual QA in progress"
gh label create qa-failed         --color b60205 --description "Manual QA failed"
gh label create merge-queue       --color 0e8a16 --description "Approved, ready to merge"
gh label create blocked           --color b60205 --description "Blocked by a dependency"
gh label create do-not-merge      --color b60205 --description "Hard merge block"
gh label create bug               --color d73a4a --description "Bug fix"
gh label create feature           --color a2eeef --description "New capability"
gh label create refactor          --color cfd3d7 --description "No behavior change"
gh label create security          --color b60205 --description "Security-relevant change"
gh label create dependencies      --color 0366d6 --description "Dependency update"
gh label create documentation     --color 0075ca --description "Docs only"
gh label create needs-qa          --color fbca04 --description "Requires manual QA before merge"
gh label create skip-qa           --color 0e8a16 --description "Low risk, QA not required"
gh label create qa-approved       --color 0e8a16 --description "Manual QA passed"
gh label create qa-self-verified  --color c5def5 --description "Self-QA exception used"
gh label create in-progress       --color c5def5 --description "An automated skill is working on this"
gh label create do-not-close      --color c5def5 --description "Humans only: never auto-close this issue"
gh label create priority-low      --color e4e669 --description "Cosmetic or follow-up work"
gh label create priority-medium   --color fbca04 --description "Ordinary bug or feature"
gh label create priority-high     --color d93f0b --description "Release-blocking"
gh label create priority-extreme  --color b60205 --description "Outage or security incident"
gh label create risk-low          --color 0e8a16 --description "Isolated, low blast radius"
gh label create risk-medium       --color fbca04 --description "Ordinary change with tests"
gh label create risk-high         --color b60205 --description "Wide blast radius, review deeply"
```
