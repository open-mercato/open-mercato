# Stabilize main CI — 2026-11-06 (v3)

## Goal
Verify main with the complete CI suite and fix reproducible root causes on one stabilization branch.

## Scope
CI workflows and only defects established by failing checks. Existing ci-full and stabilize/* full-suite selection are retained. Earlier same-day stabilization branches were merged (#8841, #8904); v3 avoids overwriting their artifacts.

## Non-goals
No releases, production changes, base-branch merges, or unrelated refactors.

## Implementation Plan
### Phase 1: Establish full-suite evidence
1.1 Open draft PR from current main and independently investigate historical failures versus current fixes.
1.2 Run full CI on the stabilization PR and fix remaining root causes with regression coverage.
### Phase 2: Verify and review
2.1 Complete the configured validation gate and all PR CI checks.
2.2 Dispatch one final independent review; address findings and add automerge only after green checks and approval.

## Risks
Main moves while this isolated PR runs. Historical initialization failures may already be fixed by merged changes; do not duplicate fixes. No claim that CI is green without completed current-head checks.

## Validation evidence

- Full GitHub CI [run 42228289164](https://github.com/open-mercato/open-mercato/actions/runs/42228289164) passed on 8a8524aa04ead6acd52d1c2c934e21ca9ed7bf77: all 15 integration shards, merge-coverage, builds, typecheck/unit tests, lint, timezone and document multi-instance checks.
- CodeQL and other applicable PR checks passed. Branch-protection context enumeration returned HTTP 403 (App permission); every reported PR check is treated as required.
- Historical initialization defect was fixed by #8916; audit-log selector collision was fixed by #8931. Both commits are ancestors of this branch. Independent investigation and local selector assertions confirmed the diagnosis.
- No runtime, API, database, dependency or workflow change was necessary. Existing ci-full and stabilize/* full-suite selection already satisfies the requested scope. Runner: GitHub checks for full gate; local read-only diff and selector assertions. Docs-only diff manually reviewed.
- Final tracking commits require fresh current-head CI before automerge is added.

## Progress
PR: #8933

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish full-suite evidence

- [x] 1.1 Open draft PR from current main and independently investigate historical failures versus current fixes.
- [x] 1.2 Run full CI on the stabilization PR and fix remaining root causes with regression coverage. — 8a8524aa0 (no remaining defect; full CI passed)

### Phase 2: Verify and review

- [x] 2.1 Complete the configured validation gate and all PR CI checks.
- [ ] 2.2 Dispatch one final independent review; address findings and add automerge only after green checks and approval.
