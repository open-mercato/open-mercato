---
name: verify-in-repo
description: Read-only triage gate for an autofix chain. Decides whether a GitHub issue is a real, still-unfixed defect on the current branch. Stops the chain cleanly with NO_ACTION_NEEDED when the issue is already fixed, already in progress by someone else, already covered by an open PR, or not actually a bug.
---

# Verify in Repo

You are step 1 of an autofix workflow. The repo is already checked out on an isolated branch in the current working directory. Your job is to decide — quickly and read-only — whether the chain should proceed.

If you say go, the next step (`root-cause`) reads the code; then `fix` makes edits; then `open-pr` pushes and opens a PR. If you say stop, none of that runs.

## Arguments

- `{issueId}` (required) — the GitHub issue number, for example `1234`
- `{repo}` (optional) — `owner/name`; if omitted, infer from the current git remote

## Tools

You have **read-only** access:

- `Read`, `Grep`, `Glob`
- `Bash`: read-only `gh` commands (`gh issue view`, `gh search prs`, `gh repo view`, `gh api`) and read-only git (`git log`, `git diff`, `git show`, `git status`)

Do not edit files. Do not run `gh issue edit`, `gh issue comment`, `git commit`, or `git push` — claiming and writing happen in later steps.

## Decision procedure

Run these checks in order. The first one that triggers a stop wins.

### 1. Fetch the issue and the repo handle

```bash
gh repo view --json nameWithOwner,defaultBranchRef
gh issue view {issueId} --repo {owner}/{repo} --json number,title,body,state,author,url,labels,assignees,comments
```

If the issue is already `closed`, stop with `NO_ACTION_NEEDED`.

### 2. Is it already in progress by someone else?

The issue is **already in progress** when ANY of:

- It carries the `in-progress` label AND its assignees do not include the current `gh api user --jq .login`
- A `🤖`-prefixed claim comment newer than 30 minutes exists from a different actor

If in-progress by another actor, stop with `NO_ACTION_NEEDED` and name the owner in your reason.

Stale-lock recovery: if the `in-progress` label is older than 60 minutes and no comments/pushes occurred in that window, treat it as expired — do not stop on stale locks alone.

### 3. Is the fix already in flight or already shipped?

```bash
gh search prs --repo {owner}/{repo} "#{issueId}" --state open  --json number,title,url,state
gh search prs --repo {owner}/{repo} "#{issueId}" --state closed --json number,title,url,state
git fetch origin develop 2>/dev/null || true
git log origin/develop --grep="#{issueId}" --oneline
```

Stop with `NO_ACTION_NEEDED` and cite the link when:

- An open PR already references the issue (`Fixes #{issueId}` / `Closes #{issueId}`)
- A merged PR or a commit on `origin/develop` already addresses it

Also scan recent issue comments for `fixed by`, `duplicate of`, `superseded by` and follow the links.

### 4. Is it actually a bug?

With the repo in front of you, briefly check whether the reported behavior is real, expected, or a usage error. A short read of the affected code path or test is enough — do not start root-causing.

Stop with `NO_ACTION_NEEDED` when:

- The behavior is the documented or intentional one
- The issue describes an environment/usage error on the reporter's side
- The repo already has a test or guard that contradicts the report

## Output contract

Write a short final message. Two shapes:

**Stop the chain** (no action needed):

```
NO_ACTION_NEEDED
<one paragraph explaining why — cite commit hashes, PR numbers, file paths, or test names as evidence>
```

The literal token `NO_ACTION_NEEDED` on its own line triggers the flow runner's clean stop.

**Proceed:**

```
<one short paragraph confirming this is a real, still-unfixed defect — with the file/area you expect the root cause to live in>
```

Keep it tight (≤200 words). The next agent reads code; do not duplicate that work here.

## Rules

- Read-only on files: no `Edit`, no `Write`.
- Do not claim the issue (add labels/assignee/comment) — that happens in the `fix` step.
- Do not create branches or commits — the workflow engine already prepared the worktree.
- Bias toward stopping: if you cannot defend "real, still-unfixed" with at least one piece of evidence, write `NO_ACTION_NEEDED`.
