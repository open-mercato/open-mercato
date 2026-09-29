# Checkpoint 3 — after steps 2.1–2.5 (flow-logic step types)

- Date: 2026-07-28 (UTC)
- Window: commits `5e07f0091`..`694f173cc` (5 steps)
- Runner: local

## Steps covered

| Step | Commit | Summary |
|------|--------|---------|
| 2.1 | 5e07f0091 | IF_ELSE + SWITCH step types as pure transition sugar; `minEngineVersion` guard (`lib/engine-version.ts`); otherwise-route warning |
| 2.2 | 0c197f20a | If/Else + Switch inspectors (ConditionBuilder inline, BR toggle, ledger-backed field picker, case→transition compilation) |
| 2.3 | b97a7730d | WAIT_FOR_CONDITION engine core: `lib/condition-handler.ts`, queue backstop with absolute `deadlineAt`, branch-aware resume |
| 2.4 | abdac1cc3 | `PATCH /api/workflows/instances/[id]/context` waking condition waiters; scoped read; new ACL feature |
| 2.5 | 694f173cc | WAIT_FOR_CONDITION node + config panel + fail-closed `superRefine` validation |

## Checks

- Workflows-scoped unit suite: **1111 suites / 8728 tests passed** (checkpoint 2 was 1104/8629).
- `yarn typecheck`: green. `yarn lint`: 0 errors. `yarn i18n:check-sync`: in sync.
- `yarn generate`: no churn; tracked enterprise manifest unmodified.

## Independently verified claims

- **Branching stayed sugar (2.1).** The step-handler delegate returns `{ status: 'COMPLETED' }` immediately, mirroring the activity-less AUTOMATED path; all routing remains in `findValidTransitions`. A regression test asserts a legacy definition emits a byte-identical `STEP_ENTERED`/`STEP_EXITED` trace.
- **Pre-existing bug found and fixed (2.1).** `workflowTransitionSchema` on `origin/feat/agent-orchestrator-mvp` declares no `condition` field (verified via `git show`), while the engine reads `transition.condition` at `transition-handler.ts:714`/`:736`. Zod's default object-stripping therefore silently discarded route conditions on every save. The additive optional `condition` field (typed by business_rules' own `conditionExpressionSchema`) closes the gap and was a hard prerequisite for If/Else and Switch persisting their routes. **Call this out prominently in the PR body** — it is a real behavior fix, not just enabling work.
- **ACL deviation is correct (2.4).** `setup.ts` grants admin `workflows.*` (line 13), which covers the new `workflows.instances.update_context` (declared at `acl.ts:92`) and reaches existing tenants through `sync-role-acls`. The employee role's explicit feature list deliberately omits it — arbitrary context writes are a broader capability than sending a signal. No redundant literal added alongside the wildcard.
- **Tenant scoping (2.4).** The new route reads through a new `updateWorkflowContextScoped` (tenant+org in the filter), never the pre-existing unscoped `updateWorkflowContext`, which is left intact for BC with a JSDoc warning. Cross-tenant 404 asserted via a new single-record helper in `api/__tests__/helpers/orgScopeAssertions.ts`.

## Notes / decisions in window

- Engine version bumped to **3**; `STEP_TYPE_MIN_ENGINE_VERSIONS` maps each new step type to its introducing version, so old engines refuse to instantiate rather than misexecute.
- `__park` added to the reserved-key rejection set beyond the two the WFC spec names — it is a real engine-internal marker, and letting a client write it would corrupt a parked agent step. Correct hardening.
- `enforceCommandOptimisticLockWithGuards` (the async DI seam) used rather than the bare sync helper, per the repo's `optimistic-lock-command-coverage` guard.
- **Framework constraint learned:** `CrudForm` validates every *declared* field, not only fields in the active group — so marking the WFC timeout `required: true` blocked saves on unrelated node types. Requirement enforced in `formValuesToNodeUpdates` + `superRefine` instead. Worth remembering for future per-type dialog fields.
- A pre-existing test that coupled the IF_ELSE stamp to `WORKFLOW_ENGINE_VERSION` (breaking on any bump) now asserts `STEP_TYPE_MIN_ENGINE_VERSIONS.IF_ELSE`.
- **Post-merge action for the maintainer:** `yarn mercato auth sync-role-acls` (new ACL feature). Not run here.
- UI browser verification still deferred to the integration batch (3.15) + final gate.
