---
name: auto-sec-report
description: "Driver that loops `auto-sec-report-pr` across a window (date, PR-number floor, branch, spec, or default last 7 days of merged PRs) and aggregates findings into one docs-only PR against `develop`. Writes markdown + HTML under `.ai/analysis/` with a top-level \"Next steps — go deeper\" list."
---

# Auto Security Report — Driver

Aggregate a security analysis across a window of units of work. This
skill does not perform the per-unit analysis itself; it delegates that
to `auto-sec-report-pr` (the single-unit skill) and combines the
resulting fragments into a single docs-only PR. The report preserves
every per-unit finding, every "Apply elsewhere" pointer, and every
"Next steps — go deeper" suggestion so the reviewer can keep drilling
into specific areas with additional `auto-sec-report-pr` runs.

## Arguments

`{windowSpec}` (optional) — one of:

- A date in `YYYY-MM-DD` form — every PR merged on or after that date
  into `--base` (default `develop`) up to today (UTC).
- A PR number — every PR whose number is greater than or equal to
  this value and that is merged into `--base`.
- A branch name (e.g. `feat/foo`) — treated as a single unit of work;
  the driver invokes `auto-sec-report-pr branch:{name}` exactly once
  and still produces the aggregate report layout.
- A spec path (any path ending in `.md` under `.ai/specs/` or
  `.ai/specs/enterprise/`) — treated as a single unit of work;
  driver invokes `auto-sec-report-pr spec:{path}` exactly once.
- Omitted — defaults to the last 7 days (UTC) of merged PRs into
  `--base`.

Options:

- `--base <branch>` (optional) — base ref for PR / branch diffs.
  Defaults to `develop`. Merges into `main` are still reported and
  flagged when a different base is specified.
- `--include-open` (optional) — also include open non-draft PRs in
  the queue, flagged as "not yet merged". Off by default.
- `--deep-scan` (optional) — pass `--deep-scan` through to every
  sub-unit call so the apply-elsewhere sweeps cover the whole repo.
  Off by default.
- `--max-units <n>` (optional) — cap the number of sub-unit runs.
  Default: 50. Larger caps are allowed but keep the run paged.
- `--slug <kebab-case>` (optional) — override the slug used in the
  plan and artifact filenames. Default: derived from the window.
- `--force` (optional) — bypass the claim-conflict check when a
  previous run left a branch or plan behind.

## Relationship to other skills

- **Delegates** to `.ai/skills/auto-sec-report-pr/SKILL.md` for every
  unit of work. All paranoid checks, deep vectors, apply-elsewhere
  sweeps, and next-step suggestions live in that skill. This driver
  only orchestrates.
- **Reuses** `.ai/skills/auto-create-pr/SKILL.md` for
  branch/worktree/commit/validation/label discipline when opening the
  aggregate PR.
- **Hands off** to `.ai/skills/auto-continue-pr/SKILL.md` when the run
  cannot finish in one invocation.

## Workflow

### 0. Pre-flight and claim

Follow `.ai/skills/auto-create-pr/SKILL.md` step 0 verbatim.

```bash
DATE=$(date -u +%Y-%m-%d)
SLUG="${SLUG_OVERRIDE:-auto-sec-report-${DATE}}"
PLAN_PATH=".ai/runs/${DATE}-${SLUG}.md"
BRANCH="feat/${SLUG}"
```

### 1. Build the unit queue

Translate `{windowSpec}` into an ordered list of units. Each entry is
one of `pr:{n}`, `spec:{path}`, or `branch:{name}`.

- **Date mode**: `gh pr list --state merged --base {base}` paginated
  until everything merged on or after the date is captured. Emit
  `pr:{n}` for each.
- **PR number floor**: same listing, filtered by number ≥ floor.
- **Branch mode**: a single-entry queue with `branch:{name}`.
- **Spec mode**: a single-entry queue with `spec:{path}`.
- **Default**: last 7 days of merged PRs.

Sort the queue newest-first for PR lists so the driver surfaces the
most recent risk first. Honor `--max-units`; if the queue is longer,
truncate with a noted residue in the plan's Risks section and
propose a follow-up invocation for the remainder.

Record the resolved window (start date or PR floor, end date or
target name, base branch, queue size) in the plan's Overview.

### 2. Draft the execution plan

Follow `.ai/skills/auto-create-pr/SKILL.md` step 3 with a Progress
section shaped like this:

```markdown
### Phase 1: Queue and plan

- [ ] 1.1 Resolve unit queue and record the window

### Phase 2: Per-unit analysis

- [ ] 2.N {target caption} — auto-sec-report-pr {target} --out-fragment ...
```

Phase 2 MUST list one checkbox per unit in the queue, in order. The
checkbox title MUST include the exact `auto-sec-report-pr` command
the driver will run. Append commit SHA on each flip so
`auto-continue-pr` can resume precisely.

```markdown
### Phase 3: Aggregation

- [ ] 3.1 Concatenate fragments into `.ai/analysis/auto-sec-report-${DATE}.md`
- [ ] 3.2 Build consolidated "Next steps — go deeper" list
- [ ] 3.3 Render HTML mirror to `.ai/analysis/auto-sec-report-${DATE}.html`
- [ ] 3.4 Spot-check artifacts: links resolve, redactions held, secret-grep clean

### Phase 4: PR delivery

- [ ] 4.1 Commit artifacts, push branch, open PR against `develop` (do not merge)
- [ ] 4.2 Apply `review`, `documentation`, `security`, `skip-qa` labels with comments
```

### 3. Isolated worktree and first commit

Follow `.ai/skills/auto-create-pr/SKILL.md` steps 4–5 verbatim.

### 4. Execute the queue

For each unit in Phase 2, invoke `auto-sec-report-pr` in sub-unit
mode. Pass `--out-fragment` so no per-unit PR is opened and no
autofix pass is triggered:

```bash
FRAGMENT_DIR=".ai/tmp/auto-sec-report/${DATE}-${SLUG}/fragments"
mkdir -p "$FRAGMENT_DIR"

for UNIT in "${QUEUE[@]}"; do
  FRAGMENT_PATH="${FRAGMENT_DIR}/$(slug "$UNIT").md"
  invoke_skill "auto-sec-report-pr" \
    --target "$UNIT" \
    --base "${BASE:-develop}" \
    ${DEEP_SCAN:+--deep-scan} \
    --out-fragment "$FRAGMENT_PATH"
done
```

Rules during the loop:

- Honor the in-progress lock protocol owned by `auto-sec-report-pr`
  when the unit is a PR. If a PR is locked by someone else, skip it,
  note the skip in the plan under the unit's Progress line, and
  continue.
- If a sub-unit exits non-zero, capture the partial fragment (if
  any), mark the unit's Progress line with `⚠ partial` and the
  reason, and continue to the next unit. Do not abort the batch.
- Flip the unit's Progress checkbox to `- [x]` with the commit SHA
  once the fragment lands. Commit the progress update as its own
  `docs(runs): mark ${SLUG} unit X complete` commit.
- Push after every 5 units so `auto-continue-pr` always has a
  recent checkpoint to resume from.

### 5. Aggregate

After every unit is processed, build the aggregate markdown at
`.ai/analysis/auto-sec-report-${DATE}.md` using this outline:

```markdown
# Auto Security Report — {window caption}

Window: **{start date or PR floor} through {end date} | branch:{name} | spec:{path}** (base: `{base}`).
Units analyzed: {count} ({N PRs, M branches, L specs}).
Partial / skipped units: {if any, inline with reasons}.

## Executive Summary

- Total findings: {N blocker, M major, L minor, K nit, I info}.
- Top OWASP categories: {A01, A08, A10}.
- Top paranoid vectors surfaced across units: {TOCTOU, cache-key
  cross-tenant leakage, SSRF redirect chain, JWT alg confusion}.
- Single sentence on the riskiest residual area the reviewer should
  double-check.

## Consolidated Next Steps — Go Deeper

Every "Next steps" entry produced by per-unit fragments is listed
here, deduplicated and ordered by expected impact. The single
highest-impact entry is marked `[recommended]`.

- **[recommended]** `auto-sec-report-pr {target}` — {why}.
- `auto-sec-report-pr {target}` — {why}.
- Audit `packages/core/src/modules/sales/` for TOCTOU on concurrent
  shipment creation — {why}.
- ...

## Risk Heatmap

| OWASP Category | Blocker | Major | Minor | Notes |
|---|---|---|---|---|
| A01 Broken Access Control | {n} | {n} | {n} | {one sentence} |
| A02 Cryptographic Failures | {n} | {n} | {n} | {one sentence} |
| ... continue through A10 ... | | | | |
| Out of scope (not OWASP) | — | — | — | {n} findings |

## Paranoid Deep Vectors — Coverage Matrix

Row per vector, column per unit outcome (`covered`, `risk surfaced`,
`not applicable`, `inconclusive`). Abbreviated when units are many;
full tables remain in the per-unit fragments.

## Per-Unit Findings

{Concatenate every sub-unit fragment here, in queue order. Do not
rewrite the fragments — keep the per-unit "Next Steps" sections
intact so a reviewer can trace each consolidated entry back to its
unit.}

## Appendix — Queue

Each item below is one unit from the window with the exact invocation
that was run.

### {YYYY-MM-DD}

- `auto-sec-report-pr pr:{n}` — [#{n}]({url}) {title} — status: {complete|partial|skipped}
- `auto-sec-report-pr branch:{name}` — status: {...}
- ...
```

Rules for the aggregate:

- Do NOT paraphrase unit fragments. Include them verbatim under
  Per-Unit Findings.
- Deduplicate the consolidated "Next steps" list on exact command
  equality; keep the highest-severity justification.
- Mark exactly one `[recommended]` across the consolidated list,
  even when multiple units each marked their own.
- Never paste raw diffs, secrets, tokens, `.env` content,
  credentials, internal hostnames, or user PII. Redact to
  `{REDACTED}`.

### 6. Render HTML mirror

Write `.ai/analysis/auto-sec-report-${DATE}.html` following the HTML
rules from `.ai/skills/auto-sec-report-pr/SKILL.md` step 6a:

- Stand-alone `<!DOCTYPE html>`, inline `<style>`, no JS, no remote
  assets, `rel="noopener noreferrer"` on every link.
- Mirror every section of the aggregate markdown.

### 7. Validation gate (docs-only)

Same as `auto-sec-report-pr` step 7:

- `git diff --check` on the artifact files.
- Secret-leak grep on the diff before commit.
- Manual re-read; every PR/issue/CVE link resolves.

### 8. Self-review and BC review

Apply `.ai/skills/code-review/SKILL.md` to the artifact diff. Verify
no PII, no internal hostnames, no secrets leaked through.

### 9. Open the PR

Follow `.ai/skills/auto-create-pr/SKILL.md` step 9 with:

- Title: `docs(analysis): add auto-sec-report for {window caption}`.
- Base: `develop`. Never merge directly.
- Body MUST include `Tracking plan: .ai/runs/${DATE}-${SLUG}.md` and
  the correct `Status:` line.
- Body MUST link the aggregate markdown + HTML, state the queue size,
  the blocker/major count, and the top OWASP categories, and repeat
  the `[recommended]` next step verbatim so the reviewer can trigger
  the drill-deeper run in one line.

### 10. Labels

Apply in order, each with a short explanatory comment:

- `review` — "PR is ready for code review."
- `documentation` — "docs-only deliverable under `.ai/analysis/`."
- `security` — "security-posture report; merits a security-savvy reviewer."
- `skip-qa` — "docs-only report; no customer-facing behavior."

Never `needs-qa`.

### 11. Auto-review pass

Run `.ai/skills/auto-review-pr/SKILL.md` against the new PR in
autofix mode. Apply fixes as new commits. Never rewrite history.

### 12. Summary comment

Post the comprehensive summary comment required by
`.ai/skills/auto-create-pr/SKILL.md` step 12. In the "What can go
wrong" section, be honest about report limitations:

- Findings are aggregated from per-unit heuristic analysis; confirm
  before acting.
- "Apply elsewhere" and "Next steps" pointers are suggestions; a
  human reviewer must confirm.
- A large window can mask per-unit context; if anything looks
  surprising, re-run the single-unit skill against the suspect unit.

### 13. Cleanup and resumability

Follow `.ai/skills/auto-create-pr/SKILL.md` step 13.

If the run cannot finish in a single invocation:

1. Leave `Status: in-progress` in the PR body.
2. Ensure the Phase-2 Progress checklist reflects which units
   completed and which are pending, each with commit SHAs and the
   exact `auto-sec-report-pr` command to resume.
3. Post a PR comment that says verbatim:
   `🤖 auto-sec-report is not complete. Resume with /auto-continue-pr {prNumber}.`
4. Release any `in-progress` lock per `auto-continue-pr` rules.

## Rules

- This skill delegates per-unit analysis to `auto-sec-report-pr`.
  Never re-implement the paranoid checks or the "Next steps"
  production here — always call the sub-unit skill.
- Always run in an isolated worktree. Never nest worktrees.
- Always open a docs-only PR against `develop`. Never merge from
  within this skill.
- Default window is the last 7 days of merged PRs (UTC) when
  `{windowSpec}` is omitted.
- Branch and spec inputs are first-class: a single-entry queue is
  still a valid driver run; the aggregate format is unchanged.
- Aggregate markdown concatenates sub-unit fragments verbatim. Do not
  rewrite them.
- Consolidated "Next steps" list MUST deduplicate on exact command
  equality and MUST mark exactly one entry `[recommended]`.
- Never paste raw diffs, secrets, tokens, `.env` content,
  credentials, internal hostnames, or user PII.
- On partial batch runs (a unit skipped or failed), record the reason
  inline and continue — do not abort the whole driver.
- On partial completion of the driver itself, leave
  `Status: in-progress` and post a `/auto-continue-pr {prNumber}`
  hand-off comment.
- Labels: `review`, `documentation`, `security`, `skip-qa`. Never
  `needs-qa`.
