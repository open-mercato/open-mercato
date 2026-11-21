# PR #9717 conflict and isolation review repair

Starting head: `557efde5e4`. Declared base: `fix/request-scoped-module-event-bus` at `cf005fd0a8`. Review: `5987348538`.

## Plan

- [x] Merge the declared base while preserving its owned request/response lifecycle and safe process-root registrations.
- [x] Replace unsafe initialized-request-container sharing with the author-approved memo alias to the existing audited process root. Keep explicit process-flag precedence, default off, caller isolation, legacy fallback and the fresh option.
- [x] Preserve the earlier caller-auth/EntityManager and eager-registrar regressions; add alias precedence and response-ownership tests.
- [x] Run focused DI, API/startup and worker regressions; independently audit caller isolation.
- [x] Give detached workflow execution its own resource lifetime and prove the regression detects premature disposal.
- [ ] Run the configured local gate and enabled/disabled cart/promotion/evaluation/CRM integration coverage.
- [ ] Push, respond to the review, request re-review and release the claim. Do not wait for hosted CI.

The earlier waiting-status report did not complete conflict resolution. The author has since approved the concrete lifetime change; this run completes that work without another permission gate. No new lifecycle architecture is introduced beyond the already-integrated base implementation.

## Validation

Pending; results will be recorded on the PR after actual completion. No merge or QA approval is implied by the local gate.
