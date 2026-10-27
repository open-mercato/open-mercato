# Issue #8014 — replacement-order undo

## Plan

- [x] Check issue ownership, existing fixes, specifications, and affected code.
- [x] Reuse the cockpit's isolated worktree and record the root cause.
- [x] Implement the guarded approval exception and audit error localization.
- [ ] Add regression and integration coverage; run relevant validation.
- [ ] Review, commit, publish the PR, and release the chain lock.

## Validation

Runner: local (Docker is unavailable).
Affected unit suites: 106 passed, 1,217 tests passed. Both package-build passes and generation passed. Changed-file ESLint and translation sync passed. Remaining configured gates are being checked.

Playwright discovers both TC-WC-040 scenarios. Managed execution is blocked because Docker CLI is unavailable; no live API/UI verdict is claimed.

## Scope

Preserve approval workflow behavior and refusal after substantive changes. The exception requires an exact audited version chain; historical logs without that evidence fail closed.
