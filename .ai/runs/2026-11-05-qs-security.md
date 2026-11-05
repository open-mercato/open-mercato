# Patch qs denial-of-service vulnerabilities

## Goal
Remove the vulnerable qs 6.15.2 resolution for Dependabot alerts 497, 318 and 308 in yarn.lock.

## Scope
Update the existing resolution to 6.16.1 and regenerate its lock entry. Add executable regressions for hostile comma serialization, hostile isBuffer round trips and bracket-comma array limits. Existing body-parser consumers request ~6.16.0/^6.16.1; a parent upgrade cannot overcome the global pin. Published 2026-10-14, the patch meets the unchanged five-day age gate.

Non-goals: other dependency groups, CodeQL work already claimed by PR 8747, fast-uri work claimed by PR 8778, issues, alert dismissals, releases, workflows and merge actions.

## Implementation Plan
Phase 1: Confirm installed paths and reproduce all three defects; update the pin and generated lock with regression tests.
Phase 2: Run the ordered configured gate, applicable lint/resolution checks and request full CI integration coverage. Obtain independent review and retain draft if verification is incomplete.

## Risks
Dependency changes affect shared transitive consumers. Verify actual installed versions and negative controls; do not infer removal from baseline-tolerant CI. Full gate may encounter unrelated main failures; disclose exact outcomes.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Patch and regression evidence

- [ ] 1.1 Reproduce vulnerabilities and patch qs with regression coverage

### Phase 2: Verification and delivery

- [ ] 2.1 Run configured gate and security checks
- [ ] 2.2 Obtain independent review and finalize PR
