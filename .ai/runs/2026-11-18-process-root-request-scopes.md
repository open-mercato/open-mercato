# Process DI root and isolated caller scopes — #8989

## Goal
Eliminate repeated process registration/bootstrap work while preserving isolated caller EntityManagers, auth, services and event dispatch.

Source doc: .ai/specs/2026-11-18-process-root-request-scopes.md
Status: in-progress
Engine: om-auto-create-pr (steps: 8, --loop: no)

## Scope
Implement the separately published service-lifetime design. Stack on #9628 for execution-local event context. Do not incorporate #9717's shared EntityManager approach. Preserve all existing registrar APIs, fallback for unaudited modules/app hooks, override order, encryption/RBAC, CLI/jobs and standalone parity. No database changes, search-result changes, new production dependencies or unrelated CI repairs.

## Implementation plan
Phase 1 adds and proves lifecycle primitives. Phase 2 migrates bootstrap, events, query-index setup and first-party registrations. Phase 3 wires entry points and verifies API behavior, isolation and bounded setup work. All changes stay opt-in until live qualification supports default activation.

## Risks
Captured mutable services, shared identity maps, subscriber duplication, incomplete HMR generations, legacy registrar ordering, and premature streaming disposal are explicit test targets. Current main has a known communication-channel attachment-test failure, independent of this work; report inherited failures honestly. No performance claim without enabled/disabled evidence. Missing integration infrastructure blocks completion rather than weakening coverage.

## Progress

PR: #9837

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Lifecycle primitives
- [x] 1.1 Add audited registrar/scoped-factory helpers and generation lifecycle tests.
- [x] 1.2 Integrate process root and isolated caller builder with compatibility regression tests.

### Phase 2: Bootstrap and registrations
- [x] 2.1 Split process infrastructure from scoped encryption, search and event dispatch.
- [x] 2.2 Move query-index bridge subscription setup to generation ownership.
- [x] 2.3 Audit and migrate first-party module and app/template registrars.

### Phase 3: Entry points and qualification
- [x] 3.1 Wire startup, independent execution contexts and standalone parity.
- [x] 3.2 Add and run self-contained request, caller, tenant and worker integration coverage. — c01dd6e65a
- [ ] 3.3 Complete validation, independent review, workload evidence and documented rollout decision.

### Validation evidence
- Phase 1: 30 shared lifecycle tests and 9 worker handler tests passed (local runner).
- First package build: all 42 package tasks passed using worktree-local workspace links.
- Phase 2: scoped event suites 179 tests, search focused suites 14, registrar isolation 2, module activation/preflight 8, channel validation 1, workspace capacity 2; all passed locally. Full unit suite remains in progress.
- Build/generate/build, template parity, translation checks and full typecheck (42 tasks) passed.
- Independent review fixed caller-local event listener leakage, unknown-domain query-index bridging and nested caller-singleton identity/disposal. Focused re-review reports no residual blockers; events180, bootstrap7, query-index20 and DI31 tests pass. Final typecheck42/42 passes.
- Real enabled-path integration: five cases pass (person/company partial edits, concurrent tenant/org reads, real PostgreSQL unit-of-work isolation, cold/warm DI workload). Twenty generation-cold callers initialize one root and run 63 registrars; the next 100 run none; all 120 EntityManagers are distinct. ORM/imports were already warm, so this is not a process-start benchmark.
- Live qualification found and fixed the unmarked generated-value registrar used by CLI/workers. Focused dynamic-loader4, lifecycle16 and cache4 tests pass; full typecheck42/42 passes again.
- Configured unit gate is not green. Exact base 4ee923350e independently reproduces all seven communication-channel attachment failures and the MDX focus loop. Other worker-crash/dependency/mock failures passed focused rechecks; 2,857 core suites and 1,251 create-app tests passed in the broad run.

### Qualification status
- Integration coverage committed in c01dd6e65a: real caller unit-of-work isolation, cross-tenant/org access, person/company partial edits, generation-cold/warm workloads and concurrent worker event ownership. Disabled mode passes all 13 selected CRM/cart/promotion/worker cases; strengthened same-event worker also passes its targeted recheck.
- Disabled workload executes 7,560 registrars for 120 callers; enabled preliminary workload executes 63 once. Both keep 120 distinct EntityManagers. Warm generation timings are indicative only, with ORM/imports already loaded.
- Forty sequential authenticated HTTP list requests after five warmups: enabled median 21.75ms / p95 32.12ms; disabled median 20.88ms / p95 26.97ms. A final enabled repeat measured median 17.71ms / p95 27.77ms, showing sample variability rather than a demonstrated general end-to-end improvement.
- Final-source production build passes. Full configured gate remains blocked by the independently reproduced baseline failures above; step 3.3 stays pending and the PR stays draft/default-off. Resume qualification with om-auto-continue-pr 9837 once the baseline gate is repaired.
- Final enabled run: all 13 CRM/cart/promotion/worker cases pass on c01dd6e65a with retries disabled, including the strengthened same-event worker assertions and deterministic failure cleanup. Both feature modes are covered.
- Final enabled setup timing: 20 generation-cold callers 9.374ms, 100 warm callers median 0.316ms / p95 0.463ms; disabled 15.387ms, median 0.542ms / p95 0.639ms. These measure caller construction with warm imports/ORM, not full requests or process cold starts.

### Review 5965672633 follow-up (2026-11-19)
- Scheduler reconciliation is deferred until activation and runs in an independently owned background caller; caller setup only attaches its EM subscriber.
- Fulltext drivers reuse generation-owned initialization when encrypted-field filtering is off, without retaining caller SQL/config accessors.
- Module/app custom event buses select the full legacy builder, preserving their query-index CRUD bridge; fallback is cached per generation and invalidated with registrations.
- Example calendar/provider/webhook publication is deferred to activation in app and template; discarded roots publish nothing.
- Focused regression validation: shared lifecycle18, example9, search700 and scheduler562 tests pass. Independent review reports no new blocker. Exact-successor validation results follow below.
- Review-fix revision 789a3dbffe: build/generate/build, translation checks, all 42 workspace typechecks, template parity, CLASSIC DI bundling and production builds pass. Both enabled and disabled runtime suites pass all 13 cases without retries, flakes or skips.
- Repaired exact unit gate fails at the unchanged MDX dialog suite with worker OOM under its configured 1 GiB limit. Continued coverage reproduces the same seven attachment failures as the exact-base test; no additional product failures. Combined collection: 50,742 passing assertions, seven failing assertions, 456 skipped, plus the MDX suite that could not complete.
- An initial dependency-copy failure changed ts-jest peer resolution; the local install was repaired before rerunning the exact command. It is not a baseline/product failure. A reusable dependency-resolution lesson records the correction.
- The four actionable findings in review 5965672633 are addressed. Step 3.3 remains pending on full-gate qualification/QA; the feature remains default-off. The existing ready-for-review PR state is preserved (superseding earlier draft-state notes), and re-review is requested.
