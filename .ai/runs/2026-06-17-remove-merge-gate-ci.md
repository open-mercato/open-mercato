# Remove the `merge-gate` CI check

## Overview

The `Merge gate` workflow (`.github/workflows/merge-gate.yml`) triggers on every
`labeled` / `unlabeled` event (plus `opened` / `reopened` / `synchronize`). The PR-automation
skills normalize several labels per PR (pipeline + priority + risk + category), so each PR
accumulates a long stack of "Merge gate" runs in the Actions list. A label-driven gate must
re-run on label changes to stay accurate, so the stacking cannot be removed while keeping the
check functional. Per the maintainer's instruction, remove the check from CI and convert the
QA-approval gate into a reviewer/automation-enforced label policy.

### Goal

Delete the `merge-gate` GitHub Actions workflow and sync every doc/skill that claims the gate is
"CI-enforced" so the QA-approval policy reads as enforced by reviewers + PR-automation tooling
(and optionally branch protection), not by a CI workflow.

### Scope

- Delete `.github/workflows/merge-gate.yml`.
- Update `AGENTS.md`, `.github/QA-DEPLOYMENT.md`, and the 8 PR-automation skill SKILL.md files that
  reference the `merge-gate` CI check.
- Keep the QA-approval *policy* (a `needs-qa` PR needs `qa-approved` to merge) intact — only the
  enforcement mechanism wording changes.

### Non-goals

- Do NOT weaken or remove the QA-approval policy itself.
- Do NOT touch branch-protection settings (cannot be changed from a PR; flagged for the maintainer).
- Do NOT change any other workflow (`ci.yml`, `release.yml`, etc.).
- No code changes — docs + CI config only.

### Risks

- **Required-status-check stranding (HIGH):** the maintainer confirmed `merge-gate` is currently a
  REQUIRED branch-protection check. Deleting the workflow means it never reports, so open PRs —
  including this one — will be blocked on the stale required check until the maintainer removes
  "Merge gate" from branch-protection required checks. Flagged prominently in the PR body.
- Doc drift if any `merge-gate` reference is missed — mitigated by a final repo-wide grep.

## Implementation Plan

### Phase 1: Remove the workflow and canonical policy docs

- 1.1 Delete `.github/workflows/merge-gate.yml`
- 1.2 Update `AGENTS.md` merge-gate references (CI-enforced → reviewer/automation-enforced policy)
- 1.3 Update `.github/QA-DEPLOYMENT.md` merge-gate reference

### Phase 2: Sync PR-automation skill references

- 2.1 Update `om-merge-buddy`, `om-auto-create-pr`, `om-auto-review-pr` SKILL.md references
- 2.2 Update `om-auto-fix-github`, `om-auto-verify-and-fix-github`, `om-auto-create-pr-loop` SKILL.md references
- 2.3 Update `om-auto-continue-pr`, `om-auto-continue-pr-loop` SKILL.md references

### Phase 3: Validate and open PR

- 3.1 Repo-wide grep to confirm no stale `merge-gate` CI claims remain; re-read full diff
- 3.2 Open PR against `develop`, apply labels, run review pass, post summary

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remove the workflow and canonical policy docs

- [x] 1.1 Delete `.github/workflows/merge-gate.yml` — fc6a0e420
- [x] 1.2 Update `AGENTS.md` merge-gate references — fc6a0e420
- [x] 1.3 Update `.github/QA-DEPLOYMENT.md` merge-gate reference — fc6a0e420

### Phase 2: Sync PR-automation skill references

- [x] 2.1 Update `om-merge-buddy`, `om-auto-create-pr`, `om-auto-review-pr` SKILL.md references — b287e351f
- [x] 2.2 Update `om-auto-fix-github`, `om-auto-verify-and-fix-github`, `om-auto-create-pr-loop` SKILL.md references — b287e351f
- [x] 2.3 Update `om-auto-continue-pr`, `om-auto-continue-pr-loop` SKILL.md references — b287e351f

### Phase 3: Validate and open PR

- [x] 3.1 Repo-wide grep + diff re-read — confirmed only docs/CI-config changed; historical run/spec/CHANGELOG records intentionally left
- [ ] 3.2 Open PR, labels, review pass, summary
