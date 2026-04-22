---
name: sync-merged-pr-issues
description: Iterate recently merged (and recently closed-but-not-merged) pull requests and reconcile them with the GitHub issue tracker — auto-close the open issues they actually fix (via `fixes`/`closes`/`resolves` keywords or GitHub's own `closingIssuesReferences`), and post informational comments on issues whose PRs were closed without merging. Use this for post-merge housekeeping, release prep, and keeping the issue backlog honest. Respects claim locks so two automation runs cannot double-close.
---

# Sync Merged PR ↔ Issue Tracker

Maintenance skill. Walk a window of recent pull requests; where a PR authoritatively closes an issue, close the issue with a linked comment; where a PR *was closed without merge* and claimed to fix an issue, leave an informational comment on the issue instead of closing it. Never act on bare `#N` mentions — only on authoritative close links.

## When to use

- Before tagging a release, to flush stale "fixed" issues.
- After a batch merge day, to reconcile the tracker.
- On a weekly schedule via the `loop` skill or a cron-scheduled remote agent.

## Arguments

- `--since <value>` (optional) — lower bound for `mergedAt` / `closedAt`. Accepts an ISO date (`2026-04-01`), a git ref (`v0.4.10`), or the literal `last-release`. Default: `last-release` → resolve to the most recent `# X.Y.Z (YYYY-MM-DD)` heading date in `CHANGELOG.md`; if that cannot be parsed, fall back to the last 7 days.
- `--limit <n>` (optional) — maximum number of PRs to process. Default: 100.
- `--dry-run` (optional) — print planned mutations but do **not** post comments or close issues.
- `--repo <owner>/<name>` (optional) — override repo detection. Default: inferred from `gh repo view --json nameWithOwner`.

## Workflow

### 0. Pre-flight

```bash
CURRENT_USER=$(gh api user --jq '.login')
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')
SINCE_DATE="<resolved from --since>"
```

Fail fast when `gh` is not authenticated (`gh auth status`). Print the resolved window, the repo, and the default branch before any mutation.

### 1. Enumerate recently merged PRs

```bash
gh pr list \
  --state merged \
  --search "merged:>=${SINCE_DATE}" \
  --json number,title,url,body,author,mergedAt,mergeCommit,baseRefName,headRefName,closingIssuesReferences,labels \
  --limit {limit}
```

`closingIssuesReferences` is GitHub's authoritative parse of `Closes #N` / `Fixes #N` / `Resolves #N` links across PR body, title, and commit messages. Treat it as the primary signal.

### 2. Enumerate recently closed-but-not-merged PRs

```bash
gh pr list \
  --state closed \
  --search "closed:>=${SINCE_DATE} is:unmerged" \
  --json number,title,url,body,author,closedAt,baseRefName,headRefName,closingIssuesReferences,labels \
  --limit {limit}
```

### 3. Extract referenced issues per PR

For each PR, build a set of referenced issue numbers using this precedence (stop at the first signal that yields results):

1. `closingIssuesReferences` from the JSON above. This is authoritative — GitHub already parsed it.
2. Regex on PR body + title: `\b(fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\s+#(\d+)\b`, case-insensitive. Reject matches where the prefix is inside a fenced code block or an inline backtick span.
3. Stop there. **Do not** act on bare `#N` mentions — those are conversational references, not close links.

Record `(prNumber, issueNumbers[], prState, mergedIntoDefault)` for each PR.

### 4. For each `(pr, issue)` pair

Fetch the issue state first:

```bash
gh issue view {issue} --repo "$REPO" --json number,state,title,url,labels,assignees,comments
```

Skip and log when any of the following holds:

- Issue state is not `OPEN`.
- Issue carries `do-not-close`, `blocked`, or `in-progress` labels.
- Issue is assigned to a user other than `${CURRENT_USER}` **and** carries `in-progress` (claimed by another run).
- Issue belongs to a different repository (cross-repo references are explicitly out of scope).

Otherwise, branch by PR state:

#### 4a. Merged into the default branch

```bash
# Claim
gh issue edit {issue} --repo "$REPO" --add-assignee "$CURRENT_USER"
gh issue edit {issue} --repo "$REPO" --add-label "in-progress"
gh issue comment {issue} --repo "$REPO" --body "🤖 \`sync-merged-pr-issues\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). Other auto-skills will skip this issue until the lock is released."

# Close with link
gh issue close {issue} --repo "$REPO" --reason completed --comment "$(cat <<EOF
✅ Fixed by #{prNumber} ({prUrl}) — merged at ${mergedAt} (commit \`${mergeCommitSha:0:7}\`).

Closed automatically by the \`sync-merged-pr-issues\` skill. Credit to @${prAuthor} (or the original author when the PR is a carry-forward — see the PR body for credit details).

If this is incorrect, reopen the issue and add the \`do-not-close\` label so future runs leave it alone.
EOF
)"

# Release
gh issue edit {issue} --repo "$REPO" --remove-label "in-progress"
```

#### 4b. Merged into a non-default branch

Post an informational comment but **do not** close:

```bash
gh issue comment {issue} --repo "$REPO" --body "ℹ️ #{prNumber} ({prUrl}) references this issue and was merged into \`${baseRefName}\`, which is not the default branch (\`${DEFAULT_BRANCH}\`). Leaving this issue open until the change lands on \`${DEFAULT_BRANCH}\`.

Posted automatically by the \`sync-merged-pr-issues\` skill."
```

#### 4c. Closed without merge

Post an informational comment; do **not** close. When a different merged PR in the same window declares `Supersedes #{prNumber}`, link it:

```bash
gh issue comment {issue} --repo "$REPO" --body "ℹ️ #{prNumber} ({prUrl}) referenced this issue but was closed **without merging** on ${closedAt}.${supersededBySuffix}

This issue remains open. Posted automatically by the \`sync-merged-pr-issues\` skill."
```

Where `supersededBySuffix` expands to ` It was superseded by #{newPr} ({newPrUrl}).` when a replacement was detected, and empty otherwise.

### 5. Dry-run behavior

When `--dry-run` is set:

- Do **not** post comments.
- Do **not** close issues.
- Do **not** add/remove labels or assignees.
- Print every mutation the real run *would* have made, one per line, prefixed with `DRY-RUN:`.

### 6. Release the claim

Always remove `in-progress` from issues the run added it to, even on error. Wrap the mutation block in a `trap`/finally so a crash or early stop still clears the lock.

### 7. Report

Print a table when the run finishes:

```markdown
## sync-merged-pr-issues — {since} → {today}

| PR | Issue | Action | Reason |
|----|-------|--------|--------|
| #1421 | #1350 | closed | merged into develop at commit abc1234 |
| #1419 | #1288 | commented-not-closed | PR #1419 was merged into `release/0.5.0` (non-default branch) |
| #1412 | #1299 | commented-unmerged | PR #1412 closed without merging; superseded by #1415 |
| #1410 | #1270 | skipped | issue already carries `do-not-close` |
| #1408 | #1260 | skipped | issue already closed |
```

Finish with counts: `closed N`, `commented M`, `skipped K`, `dry-run-would-have X`.

## Rules

- Never close an issue on a bare `#N` mention. Require `closingIssuesReferences` or an explicit close-keyword (`fix(es|ed)?`, `close(s|d)?`, `resolve(s|d)?`) followed by the `#N` token.
- Never close an issue whose PR was merged into a non-default branch — only comment.
- Never close an issue whose PR was closed without merge — only comment.
- Never act on draft PRs (`gh pr view --json isDraft`). Skip them.
- Never follow cross-repository issue references. Scope every action to `$REPO`.
- Never overwrite an existing `in-progress` lock held by another user — skip and report `skipped: claimed by @other`.
- Always release the `in-progress` label in a `trap`/finally so a crash still unlocks the issue.
- Always post a short claim comment before the close/comment action so humans can see which automation run acted.
- Respect `--dry-run` absolutely: no mutating `gh` commands may fire when it is set.
- Respect `do-not-close` and `blocked` labels — always skip and report the reason.
- Never paste PR bodies verbatim into issue comments — only the number, URL, merge SHA, merge branch, and closed-at timestamp. PR bodies can contain secrets.
- Never credit a bot account (`github-actions[bot]`, `dependabot[bot]`, `copilot`, etc.) in the close comment.

## Examples

### Dry-run preview

```text
$ /sync-merged-pr-issues --since 2026-04-01 --dry-run

Window: 2026-04-01 → 2026-04-17
Repo:   open-mercato/open-mercato
Default branch: develop

DRY-RUN: would close #1350 with link to PR #1421 (merged into develop)
DRY-RUN: would comment on #1288 about PR #1419 (merged into release/0.5.0, not closing)
DRY-RUN: would comment on #1299 about PR #1412 (closed unmerged; superseded by #1415)
DRY-RUN: would skip #1270 — carries `do-not-close`
DRY-RUN: would skip #1260 — already closed

Summary: would-close 1, would-comment 2, would-skip 2.
```

### Close comment template (merged)

```markdown
✅ Fixed by #1421 (https://github.com/open-mercato/open-mercato/pull/1421) — merged at 2026-04-15T14:02:31Z (commit `8a60110`).

Closed automatically by the `sync-merged-pr-issues` skill. Credit to @pkarw (or the original author when the PR is a carry-forward — see the PR body for credit details).

If this is incorrect, reopen the issue and add the `do-not-close` label so future runs leave it alone.
```

### Informational comment template (closed unmerged + superseded)

```markdown
ℹ️ #1412 (https://github.com/open-mercato/open-mercato/pull/1412) referenced this issue but was closed **without merging** on 2026-04-10T09:15:00Z. It was superseded by #1415 (https://github.com/open-mercato/open-mercato/pull/1415).

This issue remains open. Posted automatically by the `sync-merged-pr-issues` skill.
```

### Informational comment template (merged to non-default branch)

```markdown
ℹ️ #1419 (https://github.com/open-mercato/open-mercato/pull/1419) references this issue and was merged into `release/0.5.0`, which is not the default branch (`develop`). Leaving this issue open until the change lands on `develop`.

Posted automatically by the `sync-merged-pr-issues` skill.
```

## Notes

- This skill does **not** delegate to `auto-create-pr`. It only mutates issue state, never repository files.
- Designed to compose with `loop` (hourly/daily cadence) and `schedule` (cron-scheduled remote agent).
- Closely related: `auto-update-changelog` consumes the same PR window but writes the changelog entry — the two can run back-to-back at release time.
