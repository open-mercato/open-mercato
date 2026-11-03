# Issue #8014 — replacement-order undo

## Plan

- [x] Check issue ownership, existing fixes, specifications, and affected code.
- [x] Reuse the cockpit's isolated worktree and record the root cause.
- [x] Implement the guarded approval exception and audit error localization.
- [x] Add regression and integration coverage; run relevant validation.
- [x] Commit and publish PR #8033, handing off the issue lock.
- [ ] Resolve independent review findings, verify current-head CI, and release the PR lock.

## Validation

Runner: local (Docker is unavailable).
Affected unit suites: 106 passed, 1,217 tests passed. Both package-build passes, generation, and typecheck passed. Changed-file ESLint and translation sync passed. CI at a01badf86 passed all non-integration jobs and 382 integration cases, including both TC-WC-040 cases (3.9s / 3.0s). A concurrent CI sweep corrected the remaining TC-WC-037 upload probe in 6d45e6e69; its fresh CI is being checked.

Docker CLI is unavailable locally; live API evidence comes from CI, and no browser QA approval is claimed.

Independent review found that the direct sales-order delete command did not consume the forwarded version header. It now refreshes and row-locks the scoped order inside the deletion transaction before checking the version. The race regression fails when this guard is removed; matching-version and headerless deletes retain their behavior. Review of this correction and current-head CI remain required.

## Scope

Preserve approval workflow behavior and refusal after substantive changes. The exception requires an exact audited version chain; historical logs without that evidence fail closed.
