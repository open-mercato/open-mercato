---
title: Add auto-qa-scenarios and auto-sec-report skills
status: in-progress
---

# Execution Plan — `auto-qa-scenarios` and `auto-sec-report` skills

## Goal

Add two autonomous reporting skills to `.ai/skills/` that take a PR range
(date, PR number floor, or default "last 7 days") and deliver a human-readable
report as a docs-only PR against `develop`. Both skills reuse the
`auto-create-pr` workflow for branch/worktree/commit/PR discipline and leave
resumable progress via `auto-continue-pr` when the run cannot finish in one
pass.

## Scope

- `.ai/skills/auto-qa-scenarios/SKILL.md` — QA-tester-facing report that
  groups merged PRs by practical testing routes (P0/P1/P2), tells QA where
  to click, what to verify, and what can go wrong.
- `.ai/skills/auto-sec-report/SKILL.md` — Security-engineer-facing report
  that maps each merged PR against OWASP Top 10 categories, calls out
  security-fix PRs, and proposes where the same fix should also be applied.
- Both reports land under `.ai/analysis/` with a dated filename and both a
  markdown and an HTML rendering.
- Update `.ai/skills/README.md` to list the two new skills.

## Non-goals

- Do not change the existing `auto-create-pr` / `auto-continue-pr` /
  `auto-review-pr` skills. The new skills reuse them by reference.
- Do not run any real analysis in this PR. This PR only adds the skill
  definitions; actual analysis runs will be triggered later by the user.
- Do not touch packages, apps, or generated files.

## External References

None. The reference report format at
<https://github.com/open-mercato/open-mercato/pull/1527/files> was consulted
for structure (Executive Summary → Recommended Order → Grouped Areas →
Appendix). We adopt the section shape and reject the exact filename
convention so we can use `.ai/analysis/` with a dated `auto-qa-scenarios-*`
/ `auto-sec-report-*` slug.

## Implementation Plan

### Phase 1 — Skill authoring

- Draft `auto-qa-scenarios/SKILL.md` covering argument parsing (date / PR
  floor / default last week), data gathering with `gh`, grouping heuristics,
  the exact markdown report sections, the HTML rendering rule, the
  `auto-create-pr` handoff, and the `auto-continue-pr` resume contract.
- Draft `auto-sec-report/SKILL.md` with the same shape but focused on OWASP
  Top 10 2021 categories, PR-level security-fix detection, and
  cross-codebase "apply the same fix elsewhere" audit prompts.

### Phase 2 — Wiring

- Add both skills to `.ai/skills/README.md`'s "Available Skills" table with
  one-line descriptions matching the SKILL.md frontmatter.

### Phase 3 — PR delivery

- Commit the plan first, then the skill files.
- Push `feat/auto-qa-and-sec-report-skills` and open a PR against `develop`.
- Do not merge. Apply the `review`, `documentation`, and `skip-qa` labels
  (docs-only change; no customer-facing behavior).

## Risks

- Skill descriptions must be precise enough that agents auto-select them
  without accidentally firing on unrelated PR-reporting requests. Mitigation:
  keep the trigger words narrow ("QA scenarios", "QA report for PRs",
  "security audit", "OWASP", "auto-sec-report").
- Reports can run long. SKILL.md must cap the per-PR narrative and push raw
  inventory to an appendix so the artifact stays usable.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a
> step lands. Do not rename step titles.

### Phase 1: Skill authoring

- [ ] 1.1 Write `auto-qa-scenarios/SKILL.md`
- [ ] 1.2 Write `auto-sec-report/SKILL.md`

### Phase 2: Wiring

- [ ] 2.1 Register both skills in `.ai/skills/README.md`

### Phase 3: PR delivery

- [ ] 3.1 Push branch and open PR against `develop` (do not merge)
