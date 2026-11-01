# Checkpoint 4 — Steps 2.1..2.5

**Range:** Step 2.1 (`04f87ab424`) .. Step 2.5 (`5db46425d1`)
**Date:** 2026-10-26 (UTC)
**Runner:** local (no Docker `app` container running in this environment)

## Touched areas

- `packages/core/src/modules/availability/` — `AvailabilityReservation` entity + migration (2.1);
  reserve/release/commit service with CAS, per-line outcomes, allocation (2.2); expiry +
  reconciliation jobs, events (2.3)
- `packages/core/src/modules/wms/` — two additive read methods on `wmsReservationService` for
  reconciliation drift checks (2.3); `convertInTransaction` implemented for real (2.2, was a stub)
- `packages/core/src/modules/customer_groups/` — `CustomerPurchaseApproval` entity + migration
  (2.4); approval service with CAS decide/withdraw, `expire-approvals` job (2.5); fixed
  `resolveTerms` to actually resolve `approvalPolicy` (found missing from Step 1.5, fixed as part
  of 2.5 — `termsCurrencyCode`/`allowQuoteRequests`/`requiresPoNumber` are STILL unresolved,
  tracked for Steps 3.1/5.1, see `NOTIFY.md`)

## Checks run

| Check | Scope | Result |
|---|---|---|
| `yarn typecheck --force` (bypasses the cross-worktree shared turbo cache) | full monorepo (40 packages) | ✅ pass — `40 successful, 40 total`, `0 cached` |
| `jest --config packages/core/jest.config.cjs src/modules/{availability,wms,customer_groups}` | `packages/core`, every module touched this window | ✅ pass — 115/118 suites, 973/990 tests (3 suites / 17 tests skipped: Postgres-gated real-concurrency suites from Steps 2.2, 2.5, plus 1.6's pre-existing gated suite — all expected, no Postgres instance in this environment) |

Two Steps in this window (2.2, 2.5) carry the release's two highest-stakes concurrency mechanisms
after Step 1.6's credit lock: the availability "last unit, parallel" gate and the approval
double-decide CAS. Both were mutation-tested by their own executors (lock/CAS condition
temporarily removed, confirmed the test then fails, restored, reverified green) — recorded in
each Step's own landing report, not re-verified independently here since the pg-gated suites
cannot run without a live Postgres in this environment. This is accepted risk, consistent with
how Steps 1.6/2.2 were already accepted at prior checkpoints.

No UI touched in this window. Step review: skipped — no `engine.stepReview` configured.

## Outcome

Checkpoint **passes**. No regressions, no fix-forward Steps needed. One tracked, non-blocking
follow-up logged in `NOTIFY.md` (`resolveTerms` gaps for Steps 3.1/5.1). Proceeding to Step 2.6.
