---
name: om-approve-merge-pr
description: Approve (submit an approving review) and squash-merge a GitHub PR given only its number. Optionally file a follow-up issue at the same time. Use when the user says "approve and merge PR 123", "ship PR 123", "om-approve-merge 123", or gives a PR number with intent to merge.
---

# Approve & Squash-Merge PR

Given a single PR number, submit an approving review and then squash-merge it. Optionally, if the user supplies a follow-up, file a tracking issue in the same run. Convenience skill for the code-review process — keep it fast and low-friction.

## Inputs

- **PR number** (required) — e.g. `2805`.
- **Repo** (optional) — defaults to the repo of the current working directory. If not in a git repo, ask which `owner/repo`.
- **Follow-up** (optional) — see [Optional follow-up](#optional-follow-up). Triggered by phrasing like
  "…and add a follow-up", "with follow-up <text>", "follow-up: <ask>", or a pasted PR/comment link alongside the merge request.

## Steps

1. **Resolve the PR and sanity-check it.** Run:
   ```bash
   gh pr view <number> --json number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,url,author
   ```
   - If `state != OPEN`, stop and report (already merged/closed).
   - If `isDraft == true`, stop and ask whether to mark ready first (`gh pr ready <number>`). Don't merge a draft silently.
   - If `mergeable == "CONFLICTING"`, stop and report the conflict — do not attempt the merge.
   - Note `title`, `url`, and `author.login` for the summary and any follow-up.

2. **Approve.** Submit an approving review:
   ```bash
   gh pr review <number> --approve --body "Approved."
   ```
   - If `gh` rejects self-approval (you authored the PR), report that GitHub forbids approving your own PR and ask whether to proceed straight to merge anyway.

3. **Squash-merge.** Default flags:
   ```bash
   gh pr merge <number> --squash
   ```
   - Add `--auto` instead of a plain merge only if the user asked to merge once checks pass, or if required checks are still running (`mergeStateStatus == "BLOCKED"` / `"BEHIND"` due to pending CI).
   - Add `--delete-branch` only if the user asks to delete the branch.
   - If the merge is blocked by required reviews/checks beyond what approval satisfies, report the `mergeStateStatus` and stop — don't force anything.

4. **Optional follow-up** (only if one was provided — see below).

5. **Report** the outcome: PR title, number, url, whether it merged now or is queued for auto-merge, and the follow-up issue URL if one was created.

## Optional follow-up

If the user provides a follow-up alongside the merge request, file it **after** the merge step succeeds (so the issue can reference a merged PR). Two shapes are supported:

- **Free-text ask** — the user types the actionable item inline (e.g. "follow-up: extract the tenant-scope check into a shared helper and reuse it"). Build the issue directly:
  - **Title:** concise restatement of the ask.
  - **Assignee:** the @-mention in the ask if present, otherwise the PR author (`author.login`).
  - **Body:** a `## Follow-up from #<number>` header linking the PR, the ask quoted verbatim, an `### Acceptance criteria` checklist, and a `Related: #<number>` footer.
  - **Labels:** infer from the PR (mirror its category labels; only apply labels that exist in the repo).
  - Create it:
    ```bash
    gh issue create --repo <owner>/<repo> --title "<title>" --assignee <login> --label <labels> --body "<body>"
    ```
- **A PR or comment link** — hand off to the **`om-followup-issue-from-pr`** skill, which extracts the actionable comment and applies the same assignee rule (@-mention wins, else PR author). Don't duplicate its logic here.

Report the created issue URL in the final summary. If no follow-up was provided, skip this entirely.

## Rules

- One PR per invocation unless the user lists several.
- Never use `--admin` to bypass branch protection unless the user explicitly asks.
- Never force-merge a conflicting or failing PR; surface the blocker instead.
- Pass the repo through with `--repo <owner>/<repo>` on every `gh` call when the user specified one or you're not inside the target repo.
- Follow-up assignee rule matches `om-followup-issue-from-pr`: an explicit @-mention wins; otherwise the PR author.
- Create the follow-up only after a successful merge (or successful `--auto` queue), so it references real merged work.
