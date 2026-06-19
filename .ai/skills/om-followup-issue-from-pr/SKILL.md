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
     If there is no actionable comment but the PR adds a spec, skip comment mode and proceed
     with spec mode only (step 2a).
   - The comment body is the **source of the action** — preserve the user's actual words (quote them in the issue).

2a. **Detect spec files in the PR (spec mode).** Always run this for plain PR links; for comment links, run it too so a new spec is never silently missed.
   ```bash
   gh pr view <num> --repo <owner>/<repo> --json files \
     --jq '.files[].path | select(test("^\\.ai/specs/(enterprise/)?[^/]+\\.md$"))'
   ```
   - Keep only spec files **at the top level** of `.ai/specs/` or `.ai/specs/enterprise/`. **Skip** anything under an `implemented/` subdirectory — moving a spec to `implemented/` (or editing an already-implemented spec) is not new work to track. **Skip** `AGENTS.md` and any other non-spec doc (a real spec is named `YYYY-MM-DD-<slug>.md`, or has a legacy `SPEC-*`/`SPEC-ENT-*` prefix).
   - Prefer files the PR **added** (status `added`) over files it merely modified. A pure edit to an existing, still-pending spec usually already has a tracking issue; treat modified-only specs as a soft signal and confirm with the user before filing.
   - If no qualifying spec file is found, spec mode is a no-op — continue with comment mode only.
   - For each qualifying spec, derive its `<slug>`: strip the directory, the trailing `.md`, and any leading `YYYY-MM-DD-` date prefix (legacy `SPEC-*`/`SPEC-ENT-*` prefixes: strip the prefix too). Note whether the path is under `enterprise/`.

2b. **Dedupe against existing tracking issues (spec mode).** Before creating anything, check for an open issue that already tracks implementing this spec:
   ```bash
   gh issue list --repo <owner>/<repo> --state open \
     --search "<slug> in:title,body" --json number,title,url
   ```
   - A match is an open issue whose title is `Implement: …` for this feature **or** whose body references the spec path. Also scan the PR body for an explicit `Tracking issue: #<n>` line.
   - If a tracking issue already exists, **do not** create a duplicate — instead report it, and (optionally, with the user's nod) add a one-line comment on that issue linking the spec PR.
   - If none exists, create the tracking issue per step 6a.

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

6a. **Create the spec tracking issue (spec mode).** Only when step 2a found a qualifying spec and step 2b found no existing tracking issue. Follow the `om-prepare-issue` tracking-issue convention so it interoperates with `/om-implement-spec` and `/om-auto-fix-github`:
   - **Title:** `Implement: <feature title>` — derive the feature title from the spec's H1 / `<slug>`, not a date.
   - **Body:**
     ```markdown
     ## Spec
     - Implementation spec: `.ai/specs/<path>.md`
     - Spec PR: <pr-url>

     ## Summary
     - 2–4 lines describing what the spec proposes (from the spec's overview/goal).

     ## How to implement
     - Once the spec PR merges, run `/om-implement-spec .ai/specs/<path>.md` or `/om-auto-fix-github <thisIssueNumber>`.
     - Do not start implementation until the spec PR is merged into `develop`.

     Related: #<num>
     ```
   - **Labels:** `feature` (or `refactor`/`bug` if the spec is clearly corrective). Add `enterprise` when the spec lives under `.ai/specs/enterprise/`. Optionally mirror priority/risk from the PR. **Never** apply pipeline labels (`review`, `qa`, `merge-queue`, …) — this is a tracking issue, not a PR. Only apply labels that already exist in the repo.
   - **Assignee:** the spec PR author (`author.login`). A spec PR author is the natural owner of the implementation tracking issue; if they decline, the user can reassign.
   - **Create:**
     ```bash
     gh issue create --repo <owner>/<repo> \
       --title "Implement: <feature title>" \
       --assignee <author-login> \
       --label feature \
       --body "<body>"
     ```
   - **Cross-link:** after creation, leave a one-line comment on the spec PR pointing at the tracking issue (e.g. `Tracking implementation in #<issue>`), so the spec and its tracking issue reference each other.

7. **Report** each issue created (URL, assignee, one-line summary). Make clear which were follow-up issues (comment mode) and which were spec tracking issues (spec mode), and note any tracking issue that already existed and was reused.

## Rules

### Comment mode

- **Assignee:** an explicit @-mention in the comment wins; otherwise the PR author. Never the comment/reviewer author just because they wrote it (a reviewer files work for someone else to do).
- Faithfully represent the comment — quote it; don't invent scope it didn't ask for.
- One follow-up issue per invocation unless the user points at multiple comments.
- If the comment is not actionable (praise, a question, "LGTM"), say so and ask the user what to file instead of inventing a task.

### Spec mode

- Spec mode is **additive** — it never replaces comment mode. A single PR can produce both a follow-up issue and a spec tracking issue in one run.
- Only treat top-level `.ai/specs/**.md` / `.ai/specs/enterprise/**.md` files as specs. **Skip** `implemented/` subdirectories — those are completed work, not new tracking work.
- **Always dedupe first.** Never create a tracking issue when an open `Implement: …` issue (or a `Tracking issue: #<n>` line in the PR body) already covers the spec; report and reuse it instead.
- Spec tracking issues follow the `om-prepare-issue` convention: title `Implement: <feature>`, body with `## Spec` + `## How to implement`, labelled `feature` (+`enterprise` for enterprise specs). **Never** put pipeline labels on an issue.
- Assign the spec tracking issue to the spec PR author.
- Cross-link the spec PR and the new tracking issue so they reference each other.

### Both modes

- Always link back to the PR and any issue it `Fixes`. Only apply labels that already exist in the repo.
- Follows the Open Mercato PR/issue label conventions in `AGENTS.md` (category labels are additive: `bug`, `feature`, `refactor`, `security`, …).
