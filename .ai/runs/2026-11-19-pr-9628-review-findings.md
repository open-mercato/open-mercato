# PR #9628 review findings

Review: 5933113837. Starting head: 0890901404 (includes #9837). Base merged: a32bf6fd20.

## Plan

- [x] Reconcile the lessons catalog with actual merged records, preserving both branches' focused lessons. Count is 191; catalog validation and all five checker regressions pass.
- [x] Resolve main conflicts while preserving caller-safe DI factories and current fixture behavior; independently review affected registrations.
- [x] Run the configured validation gate, repository guards and runtime coverage for the inherited process-root feature.
- [x] Publish the changes and evidence, request re-review and release the worktree/claim.

The review's direct-global-bus observation is explicitly outside the original request-scoped module-emitter patch; this run does not expand that contract. No UI/database/API change is introduced by the review fix.

Conflict resolutions preserve main additions and bind new attachment, AI reader and enterprise observer/dispatcher factories to the resolving caller. Five DI regressions and 22 attachment/payment/search checks pass; independent review found no concrete blocker. Package build and generation prerequisites pass. Final configured gate remains pending.

## Results

Code revision 1028aed361 passes the complete configured local Node 24.22.3 gate: build/generate/build, translation checks, workspace typecheck, full units and production build. Units: 55,406 passed, zero failed, 481 existing skips; 51/51 tasks, five cached build dependencies and no cached tests. Original 1 GiB heap and concurrency 2 retained.

Repository-wide guards pass all 50 test files, including the lessons-catalog checker. CLASSIC DI passes 29 files/255 keys; template parity and diff checks pass. Native integration passes 13/13 enabled and 13/13 disabled with zero retries, flakes or skips. Authenticated real Next.js HEAD checks pass in both modes: 200, empty body, matching JSON Content-Type. Native builds passed without retry. Owned apps/databases stopped and verified absent.

Re-review is requested from haxiorz. GitHub CI is running; its final status is recorded in the PR response rather than claimed green here. No merge performed. The title and QA-routing labels predate the included #9837 feature; the requested maintainer decision on changing them remains pending, so existing routing is preserved.

## CI follow-up

Final-head CI at 4ee8839626 exposed an inherited-main LookupSelect typed-search timing failure. Its captured DOM still showed the loading indicator and old browse options before the 220ms debounce/result commit; the full local suite had passed. The test now advances pending debounce work with scoped fake timers inside awaited React act, asserts the exact query, and retains all original option-absence/count/content checks. No production component changed and no timeout increased.

Full UI validation passes 339 suites/3,112 tests at the original 1 GiB heap. The eight-test affected group passed ten consecutive runs under concurrent UI-suite load; a mutation reinserting the stored selection failed the exact-one-option assertion. Independent review found no blocker. This test-only follow-up reuses the completed product build/runtime evidence above; GitHub CI will rerun on the final revision.

Repository routing was subsequently updated externally to feature/needs-qa/risk-high. Those labels are preserved; QA approval remains pending.
