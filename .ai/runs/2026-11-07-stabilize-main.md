# Stabilize main — 2026-11-07

## Goal
Verify main and the stabilization PR with the full CI suite; fix only demonstrated failures.

## Scope
Base: main at 620dfa185f340dddbd8cb0d20637e64040a27ef2. Branch: stabilize/main-2026-11-07.
The existing ci.yml FORCE_FULL_SUITE expression already covers same-repository stabilization branches and ci-full labels. Main snapshot run 42245972055 failed TC-CRM-032 because the global Close locator matches an unrelated alert dismiss button. Qualify the sidebar back button by its visible Views text and reuse that locator for both closes. No workflow or application change is required.

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
Main currently passes: https://github.com/open-mercato/open-mercato/actions/runs/42245972084 (15 successful integration shards). The focused integration test fix must pass the PR full suite. Snapshot publishing itself is not triggered from this PR; equivalent source integration coverage runs in all 15 PR shards. No local dependencies are installed; remote full-suite checks provide the executable gate. Any skipped, failed, or pending check remains explicit in the final evidence.

## Progress
PR: #8970

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baseline and verification
- [x] 1.1 Audit current main CI and confirm full shard coverage.
- [ ] 1.2 Open draft stabilization PR and verify its full suite; fix demonstrated failures.

### Phase 2: Review and handoff
- [ ] 2.1 Obtain independent final review and resolve actionable findings.
- [ ] 2.2 Record green CI evidence and apply automerge only after approval and green checks.
