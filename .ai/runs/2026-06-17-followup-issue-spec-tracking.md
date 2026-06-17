# Execution plan: spec-tracking-issue support in `om-followup-issue-from-pr`

Tracking plan for an `om-auto-create-pr` run.

## Goal

Extend the `om-followup-issue-from-pr` skill so that, in addition to turning a review
comment into a follow-up issue, it also detects when the target PR **adds/contains a
spec file** (`.ai/specs/**.md`). When a spec is present, the skill checks whether a
tracking issue for *implementing that spec* already exists and, if not, creates the
tracking issue (using the repo's existing "Implement: …" tracking-issue conventions).

## Scope

- Edit only `.ai/skills/om-followup-issue-from-pr/SKILL.md` (docs/process automation).
- No code changes. No new dependencies. No contract surfaces touched.

### Non-goals

- Not changing `om-prepare-issue`, `om-spec-writing`, or `om-implement-spec`.
- Not auto-implementing specs; only opening the tracking issue.
- Not altering the existing comment→issue behavior; spec handling is additive.

## Conventions reused (from research)

- Spec files: `.ai/specs/**.md` and `.ai/specs/enterprise/**.md`; new names are
  `YYYY-MM-DD-<slug>.md` (legacy `SPEC-*` deprecated). `implemented/` subdirs = done.
- Detect PR spec files: `gh pr view <num> --repo <owner>/<repo> --json files --jq …`.
- Tracking-issue convention (from `om-prepare-issue`): title `Implement: <feature>`,
  body has `## Spec` (spec path + spec PR) and `## How to implement` (run
  `/om-implement-spec <path>` after the spec PR merges); labels `feature`
  (+`enterprise` for enterprise specs); never pipeline labels on issues.
- Existing-issue search: `gh issue list --state open --search "<slug> in:title,body"`.

## Risks (brief)

- False positives: a PR that only *edits* an already-implemented spec, or moves a spec
  into `implemented/`, should not spawn a tracking issue. Mitigated by skipping
  `implemented/` paths and de-duplicating against existing open issues.
- Ambiguity when a PR carries both an actionable comment and a new spec: the skill must
  handle both paths without forcing a choice. Mitigated by making spec handling an
  additive branch with its own dedupe + confirmation.

## Implementation Plan

### Phase 1: Skill rewrite

- 1.1 Update frontmatter `description` + intro so the skill advertises both modes
  (comment→follow-up issue, and spec→tracking issue).
- 1.2 Add a "Detect spec files in the PR" step and a dedicated "Spec tracking issue"
  workflow (dedupe search, compose `Implement: …` issue, create, cross-link).
- 1.3 Update Inputs (plain PR link now also triggers spec detection) and Rules
  (dedupe, skip `implemented/`, additive behavior, label conventions).

### Phase 2: Validation

- 2.1 Re-read the diff for correctness, internal-link integrity, and consistency with
  cited skills/conventions. Confirm frontmatter YAML is still valid.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Skill rewrite

- [ ] 1.1 Update frontmatter description and intro for dual-mode
- [ ] 1.2 Add spec-detection step and spec tracking-issue workflow
- [ ] 1.3 Update Inputs and Rules sections

### Phase 2: Validation

- [ ] 2.1 Re-read diff; verify YAML frontmatter and internal references
