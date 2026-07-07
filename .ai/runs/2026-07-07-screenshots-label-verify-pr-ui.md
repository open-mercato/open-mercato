# Execution plan: `screenshots` meta-label for om-auto-verify-pr-ui

Tracking plan: .ai/runs/2026-07-07-screenshots-label-verify-pr-ui.md
Status: in-progress

## Goal

Add an informational, additive `screenshots` meta-label that `om-auto-verify-pr-ui`
applies whenever it actually attaches UI QA visual evidence, and document the label
in the root `AGENTS.md` label taxonomy.

## Scope

Docs + automation-config only. No app code, no tests, no build impact.

- `.ai/skills/om-auto-verify-pr-ui/SKILL.md` — apply `screenshots` (variant A: default-on
  whenever screenshots were actually posted; skipped on PARTIAL/env-limited runs with no
  screenshots).
- `AGENTS.md` (root, PR Workflow section) — enumerate + define the label (additive, informational).

## Non-goals

- Do NOT create the repo label (`gh label create`) — the PR comment documents the exact
  command for the maintainer to run (label taxonomy / QA-flow is an "Ask First" area).
- Do NOT change pipeline/priority/risk semantics or any verdict logic.
- Do NOT touch other skills that read the label taxonomy.

## Design notes

- `screenshots` is a **meta (additive)** label — informational marker "UI QA visual evidence
  attached". It does not gate merge and is orthogonal to `needs-qa`/`qa-approved`.
- Trigger is tied to the real deliverable (screenshots posted in SKILL step 7), NOT to
  "run finished" — honoring the skill's never-fabricate discipline. Applies on PASS and FAIL
  (a failing-state screenshot is still evidence); skipped when no screenshots exist.
- Applied via the GraphQL label flow (per om-auto-review-pr step 8), with a short label comment,
  consistent with every-label-change-gets-a-comment.
- This is a deliberate, documented narrowing of the `--evidence-only` "changes no labels"
  contract: the only label it now touches by default is this informational marker.

## Risks

- The repo label must exist before the skill can apply it. Mitigation: PR comment ships the exact
  `gh label create` command; label creation is independent of PR merge and left to the maintainer.
- Label-taxonomy edits are an "Ask First" surface. Mitigation: maintainer-directed and additive-only;
  the PR body states this explicitly.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Skill update

- [ ] 1.1 Add the `screenshots` label rule to SKILL.md step 9 (Labels)
- [ ] 1.2 Clarify `--evidence-only` in Arguments + the "Default behavior changes no labels" Rules bullet
- [ ] 1.3 Include `+screenshots` in the step 10 Report-back `Labels:` line

### Phase 2: AGENTS.md documentation

- [ ] 2.1 Append `screenshots` to the "Meta labels are additive" enumeration
- [ ] 2.2 Add the `screenshots` definition bullet next to `qa-approved`
