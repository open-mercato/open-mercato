---
name: om-followup-issue-from-pr
description: Turn a PR into tracked follow-up work. Two modes (both can fire for one PR). (1) Comment mode — paste a PR or PR-comment link; the skill extracts the actionable ask, gathers PR context, and opens a follow-up issue assigned to the comment's @-mention if present, otherwise the PR author. (2) Spec mode — if the PR adds/contains a spec under `.ai/specs/`, the skill checks whether a tracking issue for implementing that spec already exists and, if not, opens an `Implement: …` tracking issue. Use during code review when the user says "make a follow-up issue", "create an issue for this", "om-followup", or pastes a PR/comment link with that intent.
---

# Follow-up Issue from PR

Companion to the code-review and spec-writing processes. The user pastes a link to a **PR** or a **specific PR comment**. This skill turns the PR into tracked follow-up work in up to two ways, and **both can apply to the same PR**:

- **Comment mode** — the linked comment (or a comment chosen from a plain PR link) contains an actionable request (usually written by the reviewer). The skill turns that request into a GitHub issue, assigned to the right person.
- **Spec mode** — the PR adds or contains a spec file under `.ai/specs/` (a spec PR). The skill checks whether a tracking issue for *implementing that spec* already exists and, if not, opens one following the repo's `Implement: …` tracking-issue convention.

When a plain PR link is pasted, always run the spec check (step 2a) in addition to the comment handling. When a specific comment link is pasted, comment mode is the primary intent, but still surface any new spec in the PR so the user can opt into a tracking issue.

## Inputs

- **A GitHub URL** (required), one of:
  - PR comment link: `…/pull/<num>#issuecomment-<id>`
  - Inline review comment link: `…/pull/<num>#discussion_r<id>`
  - Plain PR link: `…/pull/<num>` — no specific comment; runs spec detection (step 2a) and, if comments exist, comment selection (step 2).
- The repo is parsed from the URL (`owner/repo`). Don't assume the current repo.

## Steps

1. **Parse the URL** into `owner`, `repo`, PR `<num>`, and comment id (if present). Note which kind of comment id it is:
   - `issuecomment-<id>` → issue/PR conversation comment.
   - `discussion_r<id>` → inline review comment.

2. **Fetch the actionable comment.**
   - Conversation comment: `gh api repos/<owner>/<repo>/issues/comments/<id> --jq '{body,user:.user.login,url:.html_url}'`
   - Inline review comment: `gh api repos/<owner>/<repo>/pulls/comments/<id> --jq '{body,user:.user.login,url:.html_url}'`
   - **Plain PR link with no comment id:** list recent conversation comments
     (`gh api repos/<owner>/<repo>/issues/<num>/comments --jq '.[] | {id,user:.user.login,body}'`),
     identify the one with a concrete actionable ask, and confirm with the user if ambiguous.
   - The comment body is the **source of the action** — preserve the user's actual words (quote them in the issue).

3. **Gather PR context** for a useful issue body:
   ```bash
   gh pr view <num> --repo <owner>/<repo> --json number,title,url,author,body,headRefName,labels
   ```
   - `author.login` is the fallback assignee (the original PR author).
   - Pull the Problem / Root Cause / What Changed summary from the PR body to give the follow-up context. Note any `Fixes #NNNN` the PR references so the issue can link back to it.

4. **Decide the assignee.**
   - If the actionable comment **@-mentions a specific person** (e.g. "@pat-lewczuk can you…"), assign to that mentioned login — the reviewer is directing the work at them.
   - Otherwise, assign to the **PR author** (`author.login`).

5. **Compose the issue.**
   - **Title:** a concise, action-oriented restatement of the ask (not a copy of the comment).
   - **Body:** include
     - a `## Follow-up from #<num>` header linking the PR,
     - 2–4 lines of context (what the PR did, why this follow-up exists),
     - the reviewer's request, **quoting the original comment** and linking it,
     - an `### Acceptance criteria` checklist derived from the ask,
     - a `Related: #<pr>, #<linked-issues>` footer.
   - **Labels:** infer from the PR's nature — e.g. `security`, `bug`, `refactor`, `feature`. When in doubt, mirror the PR's category labels. Only apply labels that already exist in the repo.

6. **Create the issue:**
   ```bash
   gh issue create --repo <owner>/<repo> \
     --title "<title>" \
     --assignee <assignee-login> \
     --label <labels> \
     --body "<body>"
   ```
   - If the assignee can't be set (not a collaborator), create the issue anyway and report that assignment failed so the user can fix it.

7. **Report** the new issue URL, who it's assigned to, and a one-line summary of the captured action.

## Rules

- **Assignee:** an explicit @-mention in the comment wins; otherwise the PR author. Never the comment/reviewer author just because they wrote it (a reviewer files work for someone else to do).
- Faithfully represent the comment — quote it; don't invent scope it didn't ask for.
- One issue per invocation unless the user points at multiple comments.
- If the comment is not actionable (praise, a question, "LGTM"), say so and ask the user what to file instead of inventing a task.
- Always link back to the PR and any issue it `Fixes`.
- Follows the Open Mercato PR/issue label conventions in `AGENTS.md` (category labels are additive: `bug`, `feature`, `refactor`, `security`, …).
