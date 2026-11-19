# Process DI root and isolated caller scopes — #8989

## Goal
Eliminate repeated process registration/bootstrap work while preserving isolated caller EntityManagers, auth, services and event dispatch.

Source doc: .ai/specs/2026-11-18-process-root-request-scopes.md
Status: implemented; awaiting external review and QA
Engine: om-auto-create-pr (steps: 8, --loop: no)

## Scope
Implement the separately published service-lifetime design. Stack on #9628 for execution-local event context. Do not incorporate #9717's shared EntityManager approach. Preserve all existing registrar APIs, fallback for unaudited modules/app hooks, override order, encryption/RBAC, CLI/jobs and standalone parity. No database changes, search-result changes, new production dependencies or unrelated CI repairs.

## Implementation plan
Phase 1 adds and proves lifecycle primitives. Phase 2 migrates bootstrap, events, query-index setup and first-party registrations. Phase 3 wires entry points and verifies API behavior, isolation and bounded setup work. All changes stay opt-in until live qualification supports default activation.

## Risks
Captured mutable services, shared identity maps, subscriber duplication, incomplete HMR generations, legacy registrar ordering, and premature streaming disposal are explicit test targets. Initial qualification encountered attachment-fixture failures; review 5977893022 follow-up below records their repair and corrects the dependency-related MDX diagnosis. No performance claim without enabled/disabled evidence. Missing integration infrastructure blocks completion rather than weakening coverage.

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
- [x] 3.3 Complete validation, independent review, workload evidence and documented rollout decision. — 585a93fe8a

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

### Review 5977893022 plan (2026-11-19)
1. Dispose callers when initialization fails without replacing the original error; defer process event setup until module and app registration and custom-bus detection finish. Add lifecycle/event regressions.
2. Resolve the attachment assertion failures and MDX dialog heap exhaustion at their root causes, preserving the existing assertions and heap limit.
3. Run the configured gate, template/DI checks and both feature modes of runtime integration; publish results and request re-review.

### Review 5977893022 results (2026-11-19)
- Revision 585a93fe8a disposes partially initialized callers and preserves the original failure even if disposal or diagnostics throw. The shared helper also preserves root initialization/activation errors. Shared lifecycle23 and core bootstrap9 regression tests pass; healthy roots remain reusable.
- Process event hooks finalize once after module/app registration and custom-bus detection. Tests verify app-hook delivery through the caller bus and generation isolation. Independent review found no remaining blocker in these fixes.
- Attachment fixtures now include outbound provenance and scoped conversation records required by the existing command. All seven original cases pass; the full communication-channel scope also passes.
- Correction to earlier MDX/base attribution: copied dependencies contained stale nested Radix versions absent from this branch's lockfile. `yarn install --immutable` repaired the graph without dependency/lockfile changes; the original unchanged dialog test then passed at 1 GiB. The earlier base reproduction used the same drifted graph and did not establish a source-level MDX defect. The updated fixture exercises the actual production overlay container with its original behavioral assertions; removing overlay routing fails the new containment assertion.
- Full configured local gate passes: build/generate/build, translation checks, 42 workspace typechecks, exact `yarn test`, and `yarn build:app`. Unit result: 50,758 passed, zero failed, 456 existing skips; 51/51 tasks (five cached build dependencies, no cached test tasks). Template parity, CLASSIC DI checks and diff checks also pass.
- Unit/build/runtime qualification uses checksum-verified official Node 24.22.3 after Node 24.13.1 repeatedly crashed inside native V8 GC. The original 1 GiB unit heap and Turbo concurrency2 remain unchanged. Local IPC access and an isolated npm cache resolve environment permissions without changing tests.
- Next.js emitted a security advisory for the existing dependency. Its normal in-place build retry passed; the native disposable launcher clears the retry receipt before each build, so a local-only wrapper retries that identical build once in place. No security settings, receipts, dependencies or source were altered to suppress the notice. The advisory remains outstanding as dependency-maintenance work.
- Final-source production app builds pass. Native runtime integration passes13/13 in both enabled and disabled modes, without retries, flakes or skips in the test cases. Coverage includes real PostgreSQL unit-of-work separation, tenant/organization isolation, partial updates, concurrent workers, cart jobs and promotion evaluation.
- Both modes retain120 distinct caller EntityManagers. Enabled workload adds63 registrar executions for20 generation-cold callers and none for100 warm callers; disabled executes7,560 across120 callers. This is generation setup with warm ORM/imports, not a process cold-start or general HTTP performance claim.
- Rollout decision: keep `OM_PROCESS_CONTAINER_ROOT` default-off. Technical implementation/qualification is complete; external re-review and the existing `needs-qa` approval gate remain outstanding. The ready-for-review state is preserved; no merge or QA approval is claimed. Disposable app/database resources were stopped and verified absent. Earlier incomplete-gate and draft-state notes above are historical and superseded by these results.

### Review 5979805899 plan (2026-11-19)
- [x] Track generation ownership through caller and nested-scope lifetimes; retire invalidated roots and dispose their singletons once all callers finish. Preserve original failure behavior and observe cleanup failures.
- [x] Add race, active-caller, nested-scope and failure-path regressions; independently review the lifecycle change.
- [x] Run the configured gate and enabled/disabled runtime coverage, publish evidence and request re-review. — d5cab8599d

- Retirement focused validation: all 62 DI tests across 7 suites and shared typecheck pass. Independent review found no remaining major finding under the explicit scope-disposal contract. Full-gate evidence follows after completion.

### Review 5979805899 results (2026-11-19)
- d5cab8599d retires invalidated published generations and retains their singletons until all caller, background and nested scopes finish disposal. Cleanup is idempotent and awaits all resource disposers before releasing ownership, even when one rejects. Failed initialization and acquisition/activation races preserve the original error and safely select a replacement generation.
- Independent review found no remaining major issue. All 62 focused DI tests across 7 suites and shared typecheck pass. Runtime documentation explicitly requires each scope owner to dispose its scope; abandoned scopes do not provide deterministic cleanup. Public signatures and the legacy builder remain unchanged.
- Full configured gate passes on the local Node 24.22.3 runner: package build → generate → package build → translation sync/usage → workspace typecheck → unit tests → production app build. Unit totals: 50,769 passed, zero failed, 456 existing skips; 51/51 tasks. Five build dependencies were cached, with no cached test jobs. Original 1 GiB unit heap and Turbo concurrency 2 retained. Production build passed without retry.
- Native runtime integration passes 13/13 enabled and 13/13 disabled, zero retries/flakes/skips in the tests. Both modes retain 120 distinct EntityManagers; enabled generation setup executes 63 registrars versus 7,560 disabled. No general HTTP speedup claim. Owned test app/database resources were stopped and verified absent.
- Translation/template hooks, lessons catalog, CLASSIC DI bundling and diff checks pass. Base 4ee923350e remains unchanged. The feature stays default-off; re-review is requested and external review/QA approval remain outstanding. No merge performed.

### Review 5980488282 plan (2026-11-19)
- [x] Own scopes at application/API boundaries through completion, error and stream termination; mirror standalone entry points and cover direct app-shell acquisitions.
- [x] Add real app-entry regressions proving generation singleton disposal after completed requests and preserving independent/deferred work; independently review the boundary change.
- [ ] Run the configured gate and both runtime feature modes, publish evidence and request re-review.

- Boundary focused checks: 68 shared tests, 60 API tests and 40 portal/layout/backend/health/start tests pass; shared typecheck passes. Independent review found and verified fixes for async stream cancellation races, then reported no remaining concrete blocker. Template sync and lessons checks pass.

- Deferred-work audit found legacy scheduler cold-start reconciliation still borrowing the request container. Both registrar modes now use the existing independently owned background reconciliation path. Its focused regression and all 563 scheduler tests pass. The first full unit pass succeeded before this correction; final qualification reruns on the complete source.
