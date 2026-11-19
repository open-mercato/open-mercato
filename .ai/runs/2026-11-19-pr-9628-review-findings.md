# PR #9628 review findings

Review: 5933113837. Starting head: 0890901404 (includes #9837). Base merged: a32bf6fd20.

## Plan

- [x] Reconcile the lessons catalog with actual merged records, preserving both branches' focused lessons. Count is 191; catalog validation and all five checker regressions pass.
- [x] Resolve main conflicts while preserving caller-safe DI factories and current fixture behavior; independently review affected registrations.
- [ ] Run the configured validation gate, repository guards and runtime coverage for the inherited process-root feature.
- [ ] Publish the changes and evidence, request re-review and release the worktree/claim.

The review's direct-global-bus observation is explicitly outside the original request-scoped module-emitter patch; this run does not expand that contract. No UI/database/API change is introduced by the review fix.

Conflict resolutions preserve main additions and bind new attachment, AI reader and enterprise observer/dispatcher factories to the resolving caller. Five DI regressions and 22 attachment/payment/search checks pass; independent review found no concrete blocker. Package build and generation prerequisites pass. Final configured gate remains pending.
