---
name: merge-buddy
description: Scan open GitHub pull requests, classify merge readiness from labels, reviews, CI, and mergeability, then report which PRs can merge now and which ones are close but blocked.
---

# Merge Buddy

Use this skill to triage all open PRs and answer one question: what can merge right now?

## Workflow

### 1. Fetch open PRs

```bash
gh pr list --state open --json number,title,url,author,labels,reviewDecision,mergeable,mergeStateStatus,headRefName,baseRefName,updatedAt,isDraft --limit 100
```

### 2. Collect gate status for each PR

For every non-draft PR:

```bash
gh pr checks {number} --json name,state,link
```

Evaluate these gates:

- review decision must be `APPROVED`
- required CI checks must be green
- `mergeable` must not be `CONFLICTING`
- `mergeStateStatus` must not be `DIRTY` or `BLOCKED`
- the PR must not carry `changes-requested`, `qa-failed`, `blocked`, or `do-not-merge`
- the PR must not carry `in-progress`
- if `needs-qa` is present, the pipeline label must already be `merge-queue`

Treat `PENDING` CI as a blocker, but classify it as "almost ready" rather than "blocked" when it is the only missing gate.

### 3. Classify

- **Ready to merge**: all gates pass
- **Almost ready**: only 1-2 minor blockers remain
- **Blocked**: conflicts, failing CI, blocking labels, missing approval, or multiple blockers

### 4. Report

Use this output shape:

```markdown
## Merge Buddy Report — {date}

### Ready to Merge ({count})

| # | Title | Author | Labels | Age |
|---|-------|--------|--------|-----|
| [#123](url) | Fix auth flow | @alice | `bug`, `merge-queue` | 2d |

### Almost Ready ({count})

| # | Title | Author | Blocker | Action needed |
|---|-------|--------|---------|---------------|
| [#456](url) | Add catalog search | @bob | CI pending | Wait for checks or rerun |

### Blocked ({count})

| # | Title | Blocker(s) |
|---|-------|------------|
| [#789](url) | Refactor events | Merge conflicts, changes-requested |
```

## Rules

- Never merge anything without explicit user confirmation.
- Sort ready PRs by oldest first.
- Sort almost-ready PRs by fewest blockers first.
- Skip draft PRs entirely.
- Skip `in-progress` PRs and mention them only if the user asks for a full inventory.
- If nothing is ready, say that directly and highlight the top almost-ready PRs.
