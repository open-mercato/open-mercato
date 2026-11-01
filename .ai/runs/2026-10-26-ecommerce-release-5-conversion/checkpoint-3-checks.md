# Checkpoint 3 — Steps 1.11..1.12 (closes Phase 1)

**Range:** Step 1.11 (`9c35d9af44`, rescued after a provider rate-limit failure — `122ee35173` is
the next Step's commit) .. Step 1.12 (`122ee35173`)
**Date:** 2026-10-26 (UTC)
**Runner:** local (no Docker `app` container running in this environment)
**Trigger:** this checkpoint fires on fewer than 5 landed Steps (2: 1.11, 1.12) because the next
Step (2.1) closes Phase 1, which has 12 Steps (≥3) — per the checkpoint pass's phase-close rule.

## Touched areas

- `packages/core/src/modules/customer_groups/` — credit-account admin-create + ledger-listing
  routes (1.11), manual `/adjust` settlement command + route (1.12)

## Phase 1 summary (all 12 Steps, full retrospective sweep)

Phase 1 foundations are now complete: shared trusted-context helper; `ecommerce.resolveForBuyer`;
`wms.wmsReservationService` extraction; availability Phase 2 alignment; the full `customer_groups`
credit feature (entities → row-lock service → admin UI/ACL/encryption → notifications/jobs →
account provisioning → manual settlement); `promotions.revertCodeUse` + cancellation reversal;
un-hidden delivery promotions. Two gap-fills (1.11, 1.12) were appended mid-run and both landed
cleanly (1.11 needed one rescue attempt after an unrelated provider rate-limit interruption, not a
quality failure — the rescue, run one tier up per the escalation rule, succeeded cleanly).

## Checks run

| Check | Scope | Result |
|---|---|---|
| `yarn typecheck --force` (bypasses the cross-worktree shared turbo cache) | full monorepo (40 packages) | ✅ pass — `40 successful, 40 total`, `0 cached` |
| `jest --config packages/core/jest.config.cjs src/modules/{customer_groups,promotions,cart,wms,ecommerce}` | `packages/core`, every module touched across all of Phase 1 | ✅ pass — 214/215 suites, 2254/2256 tests (1 suite / 2 tests skipped: Step 1.6's `OM_CUSTOMER_GROUPS_PG_URL`-gated real-Postgres concurrency suite, expected — no Postgres instance in this environment). The `ERROR`/`WARN` log lines in the run output are expected negative-test-case fixtures (e.g. a deliberate `error=boom` in a sweep-worker failure test), not real failures. |

No dev-server/browser UI smoke pass run yet for the admin surfaces touched across Phase 1 (credit
panel tab, ledger list, create/adjust dialogs, promotions rule-builder picker) — still deferred,
not silently skipped. Phase 2's cart admin list (Step 2.10) and checkout session UI will need the
dev server up regardless, so the first real browser pass is planned for that checkpoint window
rather than spinning up the dev server twice.

Step review: skipped — no `engine.stepReview` configured in `.ai/agentic.config.json`.

## Known, logged, non-blocking deferrals (not re-litigated here)

- US-E2 "orphan banner" (customers eligible for on-account but with no credit account) — admin-UX
  nicety, nothing downstream depends on it; revisit only if Step 6.1's integration-coverage pass
  finds a spec test case requiring it.
- Approval notifications/ACL features (`customer_groups.approvals.*`) — intentionally undeclared
  until the `CustomerPurchaseApproval` entity exists (Step 2.4).

## Outcome

Checkpoint **passes**. Phase 1 is complete and the full retrospective sweep is green. Proceeding
to Phase 2, Step 2.1 (`availability`: `AvailabilityReservation` entity + migration, A3).
