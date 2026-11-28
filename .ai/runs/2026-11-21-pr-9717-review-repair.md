# PR #9717 conflict and isolation review repair

Starting head: `557efde5e4`. Declared base: `fix/request-scoped-module-event-bus` at `cf005fd0a8`. Review: `5987348538`.

## Plan

- [x] Merge the declared base while preserving its owned request/response lifecycle and safe process-root registrations.
- [x] Replace unsafe initialized-request-container sharing with the author-approved memo alias to the existing audited process root. Keep explicit process-flag precedence, default off, caller isolation, legacy fallback and the fresh option.
- [x] Preserve the earlier caller-auth/EntityManager and eager-registrar regressions; add alias precedence and response-ownership tests.
- [x] Run focused DI, API/startup and worker regressions; independently audit caller isolation.
- [x] Give detached workflow execution its own resource lifetime and prove the regression detects premature disposal.
- [x] Run the configured local gate and enabled/disabled cart/promotion/evaluation/CRM integration coverage.
- [x] Prepare the validated changes and completion report for publication. Push, re-review request and claim release are recorded in the PR completion comment; do not wait for hosted CI.

The earlier waiting-status report did not complete conflict resolution. The author has since approved the concrete lifetime change; this run completes that work without another permission gate. No new lifecycle architecture is introduced beyond the already-integrated base implementation.

## Validation

Code revision `08f52fbec6` passed all eight configured commands in local mode on Node 24.22.3: build/generate/build, translation sync/usage, typecheck, full tests and production app build. Full suite: 56,371 passed, 519 skipped, zero failures; no cached test tasks. Focused DI/API/startup/worker checks: 118 passed. Workflow route suite: 61 passed; removing the ownership fix makes both new regressions fail. Template parity, instruction-budget and lessons guards passed. Independent source audit found no remaining blocker.

Native integration passed 19/19 with the memo alias enabled and 19/19 disabled, without flakes or skips. The original cart/promotion selection and six CRM cases were exercised. Ten valid promotion-evaluation HTTP requests returned 200 in each mode. The canonical process-root flag was absent from the app and test processes, so these runs exercise the alias itself.

The enabled workload created one root and ran 63 registrars for 120 isolated caller scopes, with zero legacy containers and 120 distinct EntityManagers. The disabled control created 120 legacy containers and ran 7,560 registrars, also with 120 distinct EntityManagers. These are counter deltas from the workload attachments, not production latency benchmarks.

Both owned apps and disposable databases were stopped and verified absent. Hosted checks, independent human review and required QA are not asserted passed. No merge or QA approval is implied by the local gate.
