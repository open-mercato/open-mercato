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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish full-suite evidence

- [ ] 1.1 Open draft PR from current main and independently investigate historical failures versus current fixes.
- [ ] 1.2 Run full CI on the stabilization PR and fix remaining root causes with regression coverage.

### Phase 2: Verify and review

- [ ] 2.1 Complete the configured validation gate and all PR CI checks.
- [ ] 2.2 Dispatch one final independent review; address findings and add automerge only after green checks and approval.
