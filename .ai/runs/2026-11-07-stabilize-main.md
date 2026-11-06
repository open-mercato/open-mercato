# Stabilize main — 2026-11-07

## Goal
Verify main and the stabilization PR with the full CI suite; fix only demonstrated failures.

## Scope
Base: main at 620dfa185f340dddbd8cb0d20637e64040a27ef2. Branch: stabilize/main-2026-11-07.
The existing ci.yml FORCE_FULL_SUITE expression already covers same-repository stabilization branches and ci-full labels. No workflow or application change is needed unless verification reveals a defect.

## Non-goals
Do not merge into main, alter contracts, weaken checks, or introduce speculative fixes.

## Implementation Plan
### Phase 1: Baseline and verification
1.1 Audit current main CI and confirm full shard coverage.
1.2 Open draft stabilization PR and verify its full suite; fix demonstrated failures.
### Phase 2: Review and handoff
2.1 Obtain independent final review and resolve actionable findings.
2.2 Record green CI evidence and apply automerge only after approval and green checks.

## Risks
Main currently passes: https://github.com/open-mercato/open-mercato/actions/runs/42245972084 (15 successful integration shards). This may be a verification-only PR. No local dependencies are installed; remote full-suite checks provide the executable gate. Any skipped, failed, or pending check remains explicit in the final evidence.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baseline and verification
- [ ] 1.1 Audit current main CI and confirm full shard coverage.
- [ ] 1.2 Open draft stabilization PR and verify its full suite; fix demonstrated failures.

### Phase 2: Review and handoff
- [ ] 2.1 Obtain independent final review and resolve actionable findings.
- [ ] 2.2 Record green CI evidence and apply automerge only after approval and green checks.
