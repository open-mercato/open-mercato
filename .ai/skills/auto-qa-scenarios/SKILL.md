---
name: auto-qa-scenarios
description: Generate a human QA report for a window of merged pull requests and deliver it as a docs-only PR. Accepts a date (reports PRs merged on or after that date), a PR number floor (reports PRs whose number is >= that value), or defaults to the last 7 days when nothing is specified. Groups merged work into practical testing routes (P0/P1/P2), lists where QA should click, what to verify, and what can go wrong. Writes both markdown and HTML artifacts under `.ai/analysis/`. Uses the `auto-create-pr` workflow to open a PR against `develop` (never merges), and hands off to `auto-continue-pr` when the run cannot finish in one pass.
---

# Auto QA Scenarios

Produce a QA-tester-facing report that translates a window of merged pull
requests into a practical manual verification plan. The report groups PRs by
product area, recommends a testing order, tells QA where to click, what to
verify, and what can go wrong. The final deliverable is a docs-only PR
against `develop` with markdown and HTML artifacts under `.ai/analysis/`.

This skill is a specialization of `auto-create-pr`. It adopts that skill's
worktree, branch, commit, validation, self-review, and label discipline
verbatim. The sections below describe only the QA-specific content and the
few places where the flow deviates from the generic `auto-create-pr`
workflow.

## Arguments

- `{windowSpec}` (optional) — one of:
  - A date in `YYYY-MM-DD` form (e.g. `2026-04-10`). Report covers every PR
    merged on or after that date, up to today (UTC).
  - A PR number (e.g. `1200`). Report covers every PR whose number is
    greater than or equal to the given number and that is merged.
  - Omitted — defaults to the last 7 days (UTC), i.e. everything merged
    between today minus 7 days and today.
- `--base <branch>` (optional) — which base branch to count merges into.
  Defaults to `develop`. `main` merges are still reported but flagged when
  a different base is specified.
- `--include-open` (optional) — also include open non-draft PRs in the
  report, labelled as "not yet merged" so QA can sanity-check upcoming
  changes. Off by default.
- `--slug <kebab-case>` (optional) — override the slug used in the plan
  and artifact filenames. Default: derived from the window.
- `--force` (optional) — bypass the claim-conflict check when a previous
  run left a branch or plan behind.

## Workflow

### 0. Pre-flight and claim

Follow `.ai/skills/auto-create-pr/SKILL.md` step 0 verbatim. Branch name
MUST use the `feat/` prefix (this is a new docs artifact, not a
corrective change):

```bash
DATE=$(date -u +%Y-%m-%d)
SLUG="${SLUG_OVERRIDE:-auto-qa-scenarios-${DATE}}"
RUN_DIR=".ai/runs/${DATE}-${SLUG}"
PLAN_PATH="${RUN_DIR}/PLAN.md"
HANDOFF_PATH="${RUN_DIR}/HANDOFF.md"
NOTIFY_PATH="${RUN_DIR}/NOTIFY.md"
BRANCH="feat/${SLUG}"
```

### 1. Resolve the PR window

Translate `{windowSpec}` into a concrete query:

```bash
# Date mode
gh search prs --repo $(gh repo view --json nameWithOwner --jq .nameWithOwner) \
  --merged --base "${BASE:-develop}" --sort updated --order desc \
  --merged-at ">=${DATE_FLOOR}" --limit 500 \
  --json number,title,url,author,body,labels,headRefName,baseRefName,mergedAt,mergeCommit,files

# PR-number-floor mode (fetch list, filter by number >= floor, merged == true)
gh pr list --state merged --base "${BASE:-develop}" --limit 500 \
  --json number,title,url,author,body,labels,headRefName,baseRefName,mergedAt

# Default (last 7 days) — same as date mode with DATE_FLOOR = today - 7
```

Rules:

- Paginate until you reach the floor. Never silently cap at 100 PRs.
- Record the resolved window (start date or PR floor, end date) in the plan
  Overview so the report caption is unambiguous.
- Count merges into `main` separately and mention them in the executive
  summary. Do not silently drop them.

### 2. Gather per-PR evidence

For each PR in the window, fetch enough context to group it reliably:

```bash
gh pr view {number} --json number,title,url,author,body,labels,baseRefName,mergeCommit,mergedAt,files,additions,deletions
gh pr diff {number} --patch | head -n 400   # sample; do not paste into the report
```

From each PR, extract:

- Title, number, URL, merged date, base branch.
- Labels (category, pipeline, meta).
- Issue references from the body (`#\d+` and `Fixes #\d+`).
- Affected top-level module/package paths from the file list (e.g.
  `packages/core/src/modules/sales/`, `packages/ui/`).
- Heuristic area tag: auth, sales, catalog, customers, workflows, webhooks,
  events, notifications, search, ai, ui, docs, tests, infra, other.

### 3. Group PRs into QA areas

Cluster by heuristic area tag, then refine manually from titles and file
paths. Target **3–6 named QA areas plus one "no direct manual QA" bucket**
so the report stays usable. Typical areas:

- Auth, Access Control, Sessions, Organization Scope
- Sales, Checkout, Quotes, Orders, Payments, Shipments
- Workflows, Webhooks, Events, Notifications, Scheduler, Queue
- Customers, Customer Accounts, Custom Fields, Business Rules
- Catalog, Attachments, Shared Backend UI, Visual Regressions
- Low-Priority Manual QA And Broad Smoke Only

Assign a priority to each area:

- **P0** — auth/sessions/tenant scope, money flows, event/webhook
  reliability, anything that can leak data across tenants or double-charge.
- **P1** — CRM, catalog UX, attachments, table/UI rendering, custom fields.
- **P2** — docs, tooling, tests, infra, DX. No dedicated admin pass.

### 4. Draft the execution plan

Follow `.ai/skills/auto-create-pr/SKILL.md` step 3. The plan at
`$PLAN_PATH` MUST include:

- Window (start date or PR floor, end date, base branch).
- External References subsection set to `None` unless `--skill-url`
  actually passed something.
- A **Progress** section with the exact convention block from
  `auto-create-pr`. Required phases:

```markdown
### Phase 1: Data gathering

- [ ] 1.1 Resolve PR window and fetch merged PR metadata
- [ ] 1.2 Enrich PRs with files, labels, and linked issue refs

### Phase 2: Analysis

- [ ] 2.1 Cluster PRs into QA areas and assign priorities
- [ ] 2.2 Draft "Where QA should click", "What to verify", and "What can go wrong" per area

### Phase 3: Artifact generation

- [ ] 3.1 Write markdown report to `.ai/analysis/auto-qa-scenarios-${DATE}.md`
- [ ] 3.2 Render HTML mirror to `.ai/analysis/auto-qa-scenarios-${DATE}.html`
- [ ] 3.3 Spot-check artifacts render correctly and links resolve

### Phase 4: PR delivery

- [ ] 4.1 Commit artifacts, push branch, open PR against `develop` (do not merge)
- [ ] 4.2 Apply `review`, `documentation`, and `skip-qa` labels with comments
```

### 5. Isolated worktree, branch, first commit

Follow `.ai/skills/auto-create-pr/SKILL.md` steps 4–5 verbatim. Branch
base is always `develop`. Commit the plan first, then push.

### 6. Execute the phases

Run steps 1.1 → 3.3 inside the worktree. After each step, flip its
checkbox to `- [x]`, append the commit SHA, and commit the progress
update as a dedicated `docs(runs): mark ${SLUG} Phase N step X complete`
commit. Push after every phase.

#### 6a. Markdown artifact layout

Write to `.ai/analysis/auto-qa-scenarios-${DATE}.md` using this outline:

```markdown
# Auto QA Scenarios — {window caption}

Report window: **{start date or PR floor} through {end date}** (base: `{base}`).

## Executive Summary

- Reviewed **{count} merged PRs** in the requested window.
- Base branches covered: **{n} into `develop`** and **{m} into `main`**.
- Grouped into {N} practical testing routes below. Use the appendix for
  full PR-by-PR traceability.
- {one sentence on the riskiest theme in this window}.

## Recommended QA Order

| Priority | Area | Suggested focus |
|---|---|---|
| P0 | {Area name} | {one sentence} |
| P0 | {Area name} | {one sentence} |
| P1 | {Area name} | {one sentence} |
| P2 | Low-priority manual QA and broad smoke only | {one sentence} |

## QA Areas

### P0 — {Area name}

{2–3 sentences describing what changed in this area during the window.}

**Representative PRs in this area:** [#...](...), [#...](...)
**Linked issue refs surfaced in these PRs:** [#...](...), [#...](...)

**Where QA should click**
- `/backend/...`
- `/backend/...`

**What human QA should verify**
- {Concrete manual action with expected outcome}
- {Concrete manual action with expected outcome}

**What can go wrong**
- {Concrete regression symptom}
- {Concrete regression symptom}

{Repeat per area.}

## Appendix: Full Merged PR Inventory

Each item below is one merged PR from the requested window with direct
GitHub links for the PR and any linked or mentioned issue refs.

### {YYYY-MM-DD}

- [#{n}]({url}) {title}; Issue refs: [#{k}]({issue url}) | None
- ...
```

Rules for the markdown:

- Never paste raw diffs or PR bodies into the report.
- Never invent PR numbers. If the fetch for a PR fails, note it in the
  appendix with `(metadata unavailable)` and continue.
- Never mention secrets, tokens, `.env` values, or internal URLs that
  were leaked into PR bodies. Redact if found.
- Keep the area narrative under ~6 sentences. The appendix carries the
  completeness burden.

#### 6b. HTML artifact layout

Write a stand-alone HTML file at `.ai/analysis/auto-qa-scenarios-${DATE}.html`.
It MUST:

- Open with a `<!DOCTYPE html>` and include a `<title>` matching the
  markdown H1.
- Embed a small inline `<style>` block (no external CSS) using system
  fonts. No JavaScript. No web fonts. No remote assets.
- Mirror every section of the markdown — Executive Summary, Recommended
  QA Order (as a table), QA Areas (as `<section>` blocks with the same
  headings), and the Appendix (grouped by date with `<h3>` and `<ul>`).
- Preserve every PR and issue link as an `<a href="...">` with
  `rel="noopener noreferrer"`.
- Set text direction `ltr` and language `en` on `<html>`.

Do not attempt to convert the markdown programmatically in this SKILL —
render the HTML directly from the same source-of-truth data you used for
the markdown. This keeps the two files in sync without a build step.

### 7. Full validation gate (docs-only)

This run is docs-only. The minimum gate is:

- `yarn lint` (if it catches markdown/YAML issues in frontmatter).
- `git diff --check` — no trailing whitespace, no merge markers.
- A manual re-read of both artifacts and a spot-check that every PR link
  resolves to a real URL (`https://github.com/{owner}/{repo}/pull/{n}`).

Never run `yarn build`, `yarn test`, or `yarn typecheck` on a docs-only
run unless you actually modified code. If the run did touch code, fall
back to the full `auto-create-pr` step 7 gate.

### 8. Self-review and BC review

Apply `.ai/skills/code-review/SKILL.md` to the diff. Because the change is
docs-only, the only contract-surface risk is accidentally linking
external resources in a way that leaks user or tenant data. Redact if
needed.

### 9. Open the PR

Follow `.ai/skills/auto-create-pr/SKILL.md` step 9 with these specifics:

- Title: `docs(analysis): add auto-qa-scenarios report for {window caption}`.
- Base: `develop`. Never merge directly.
- Body MUST include `Tracking plan: .ai/runs/${DATE}-${SLUG}/PLAN.md` and `Tracking run folder: .ai/runs/${DATE}-${SLUG}/` plus
  `Status: complete` (or `in-progress` if phases remain).
- Body MUST link both artifacts under `.ai/analysis/` and summarize the
  window and the total PR count.

### 10. Labels

Apply in this order, each with a short explanatory comment (per root
`AGENTS.md` PR workflow):

- `review` — "PR is ready for code review."
- `documentation` — "docs-only deliverable under `.ai/analysis/`."
- `skip-qa` — "docs-only report; no customer-facing behavior."

Never add `needs-qa` on an `auto-qa-scenarios` PR. The report is about
other PRs; it does not itself require manual QA.

### 11. Auto-review pass

Run `.ai/skills/auto-review-pr/SKILL.md` against the new PR in autofix
mode. Apply fixes as new commits. Never rewrite history.

### 12. Summary comment

Post the comprehensive summary comment required by
`.ai/skills/auto-create-pr/SKILL.md` step 12. In the **How to verify**
section, recommend that the reviewer:

- Open the HTML artifact directly in a browser.
- Scan the appendix for PRs the reviewer personally merged and confirm
  they were categorized sanely.

### 13. Cleanup

Follow `.ai/skills/auto-create-pr/SKILL.md` step 13.

### 14. Resumability

If the run cannot finish in a single invocation:

1. Leave `Status: in-progress` in the PR body.
2. Ensure the Progress checklist in `$PLAN_PATH` reflects what actually
   landed, with commit SHAs on every completed step.
3. Post a PR comment that says verbatim:
   `🤖 auto-qa-scenarios is not complete. Resume with /auto-continue-pr {prNumber}.`
4. Release any `in-progress` lock per `auto-continue-pr` rules if one was
   claimed during this run.

## Rules

- Always deliver as a PR. Never push the report to `develop` directly.
  Never merge the PR from within this skill.
- Default window is the last 7 days (UTC) when `{windowSpec}` is omitted.
- Artifacts go under `.ai/analysis/` with a dated filename. Both markdown
  and HTML MUST be produced in the same run.
- Never invent PR numbers, issue references, or commit SHAs.
- Never paste raw diffs, PR bodies, secrets, tokens, or `.env` content
  into the report.
- Keep per-area narrative tight; push completeness to the appendix.
- Reuse `auto-create-pr` for branch/worktree/commit/validation/label
  discipline. Do not reinvent those mechanics.
- On partial completion, leave a `/auto-continue-pr {prNumber}` hand-off
  comment and keep `Status: in-progress` on the PR body.
- Labels on this skill's PR: `review`, `documentation`, `skip-qa`. Never
  `needs-qa`.
