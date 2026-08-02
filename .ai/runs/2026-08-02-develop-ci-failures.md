# Stabilize current develop CI failures

## Goal

Restore green CI on `develop` by fixing the four failures independently reproduced while preparing PR #4462, without weakening coverage or changing unrelated behavior.

## Scope

- Diagnose the CLI module-facts performance guard and standalone guide-parity failure.
- Diagnose the notification organization-scoping integration failure.
- Diagnose the WMS reservation-shortfall notification integration failure.
- Add or strengthen focused regression coverage for every behavior change.
- Run the repository validation gate, review the diff, and ship a separate PR against `develop`.

## Non-goals

- Do not modify PR #4462 or absorb its authorization-policy changes.
- Do not raise timeouts, remove assertions, skip tests, or disable CI checks merely to make the gate green.
- Do not change public contracts, migrations, or feature behavior unless the root cause proves such a change is necessary and backward-compatible.

## Implementation Plan

### Phase 1: Reproduce and classify

1. Reproduce each failing test with the smallest supported runner and identify whether the defect is in production code, fixtures, test isolation, or build orchestration.
2. Record the minimal change surface and verify there is no open PR already fixing the same root cause.

### Phase 2: Implement deterministic fixes

1. Fix the module-facts performance and standalone guide-parity failures while preserving the intended generator contracts.
2. Fix notification organization-scoping isolation with focused regression coverage.
3. Fix WMS shortfall notification delivery with focused regression coverage.

### Phase 3: Validate and publish

1. Run targeted validation for every changed area and the full configured validation gate in order.
2. Perform compatibility, security, and code-review passes; fix all actionable findings.
3. Open the base-fix PR, normalize labels, and run `om-auto-review-pr` in autofix mode.

## Risks

- The integration failures may share runner-state leakage rather than product-code defects; diagnosis must preserve the assertions and repair isolation at the correct layer.
- Generator performance depends on CI contention; the fix must improve or isolate measured work rather than increase the 30-second budget blindly.
- Notification timing fixes can mask event-delivery bugs if implemented as longer waits; prefer deterministic queue/event completion signals.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Reproduce and classify

- [ ] 1.1 Reproduce and classify all four failures
- [ ] 1.2 Confirm minimal change surfaces and duplicate-free scope

### Phase 2: Implement deterministic fixes

- [ ] 2.1 Fix module-facts performance and standalone guide parity
- [ ] 2.2 Fix notification organization-scoping isolation
- [ ] 2.3 Fix WMS shortfall notification delivery

### Phase 3: Validate and publish

- [ ] 3.1 Run targeted and full validation gates
- [ ] 3.2 Complete compatibility, security, and code review
- [ ] 3.3 Open and review the base-fix PR
