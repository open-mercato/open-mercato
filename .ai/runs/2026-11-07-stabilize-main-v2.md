# Stabilize main snapshot integration — 2026-11-07

## Goal
Restore green main validation by fixing the demonstrated standalone support-routing test failure.

## Scope
Branch: stabilize/main-2026-11-07-v2 from main a68811b809b12e1f3db038365f094818cd12aebe. Original stabilization PR #8970 is already merged; do not reuse or overwrite it. Main CI 42370668190 passes all 15 shards, but Main Snapshot Release 42370668199 fails TC-STAFF-SUP-011:73 on both attempts. The scenario assumes the mutable existing fallback project is customerless. Create a test-owned project, clear its customer explicitly, point the fallback at it, preserve the null-customer assertion, and restore routing during cleanup.

Source doc: .ai/specs/2026-10-06-staff-helpdesk-support-tickets.md

## Non-goals
No production, API, database, workflow or package changes. No skipped tests or weakened assertions. Do not merge into main. Existing ci-full/stabilize routing already forces all 15 shards.

## Implementation Plan
### Phase 1: Fix and validate
1.1 Isolate the customerless project scenario and retain routing assertions.
1.2 Run full PR CI and inspect all failed checks until green.
### Phase 2: Review and handoff
2.1 Obtain independent final review and resolve actionable findings.
2.2 Record evidence, mark ready and apply automerge only with green checks and approved review.

## Risks
The snapshot workflow only triggers on main and publishes packages; do not alter or republish releases to test a test-only change. Full PR CI covers the changed source test. Snapshot standalone validation may require a separate existing standalone harness. Runner: GitHub Actions; local dependencies are absent. Any unverified standalone outcome must remain explicit. Claim run: 2b5aad0d-0a61-448a-b12b-04cf336eeebd.

## Progress
PR: #9008

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and validate

- [x] 1.1 Isolate the customerless project scenario and retain routing assertions.
- [ ] 1.2 Run full PR CI and inspect all failed checks until green.

### Phase 2: Review and handoff

- [ ] 2.1 Obtain independent final review and resolve actionable findings.
- [ ] 2.2 Record evidence, mark ready and apply automerge only with green checks and approved review.
