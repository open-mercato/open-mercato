# Checkpoint 11 — Steps 5.1..5.4 (closes Phase 5)

**Range:** Step 5.1 (`db87581207`) .. Step 5.4 (`a17a1c94ba`)
**Date:** 2026-10-28 (UTC)
**Runner:** local (no Docker `app` container running; a local Homebrew PostgreSQL@17 instance
**is** running on `127.0.0.1:5432` — discovered this checkpoint, see below)

## Touched areas

- `packages/checkout/src/modules/checkout/` — B.5 B2B (PO number, `min_order_value`,
  `request_quote`, quote branch, 5.1); approval-resume subscriber + D-R5-33 audit (5.2)
- `packages/core/src/modules/customer_groups/` — `resolveTerms` fully complete now
  (`allowQuoteRequests`/`requiresPoNumber` added, closing the last of the Step 2.5 tracked gaps)
- `packages/core/src/modules/assisted_selling/` — rep console (inbox, thread, composer, proposal
  builder, 5.3); Phase 4 attribution (entity, subscriber, route, console report, 5.4)

Phase 5 completes the release's entire main implementation scope — every wave from the
cross-spec's "Final implementation order" table (1 through 5) is now built.

## New this checkpoint: real-Postgres re-verification of the three highest-stakes mechanisms

A local Homebrew PostgreSQL@17 server was discovered running on `127.0.0.1:5432` (`pg_isready`
confirmed; `brew services list` shows it `started`) — every prior checkpoint in this run assumed
no live Postgres was available and accepted the gated concurrency suites' skip as unavoidable
residual risk. That assumption was wrong. Two disposable throwaway databases were created
(`om_r5_availability_pg_test`, `om_r5_customer_groups_pg_test`), the three gated suites run
against them, and both databases dropped immediately after:

| Suite | Mechanism | Result |
|---|---|---|
| `reservationCommands.concurrency.pg.test.ts` (Step 2.2) | availability "last unit, parallel" reserve | ✅ 1/1 suite, 9/9 tests — independently confirmed, not just self-reported |
| `customerCreditService.concurrency.pg.test.ts` (Step 1.6) | credit row-lock reserve | ✅ pass (part of the 2/2 below) |
| `customerPurchaseApprovalService.concurrency.pg.test.ts` (Step 2.5) | approval double-decide CAS | ✅ pass (part of the 2/2 below) |
| combined customer_groups run | both above | ✅ 2/2 suites, 8/8 tests |

This closes the single largest standing verification gap in the whole run — every prior
checkpoint's "accepted risk, no live Postgres" note for these three mechanisms is now resolved.
**From this checkpoint forward, re-run each newly-added `.pg.test.ts` suite against a throwaway
local database at its own checkpoint, rather than deferring all of them to the final gate** — the
infrastructure for this is now proven (`createdb`/`dropdb` against the local Homebrew instance,
zero persistent state left behind).

## Checks run

| Check | Scope | Result |
|---|---|---|
| `rm tsconfig.tsbuildinfo` (all packages) + `yarn typecheck --force` | full monorepo (40 packages) | ✅ pass — `40 successful, 40 total`, `0 cached` |
| `jest --config packages/core/jest.config.cjs src/modules/{cart,customer_groups,checkout}` | cross-module regression guard | ✅ pass — 75/77 suites, 922/930 tests (2 expected skips — see below, now resolved separately) |
| `jest --config packages/core/jest.config.cjs src/modules/{availability,promotions,assisted_selling,ecommerce}` | every remaining `core` module touched | ✅ pass — 127/128 suites, 1495/1504 tests (1 expected skip — resolved separately) |
| `jest --config packages/checkout/jest.config.cjs` (full package) | all of checkout | ✅ pass — 55/55 suites, 462/462 tests |
| Real-Postgres re-verification (see table above) | the 3 gated suites the two sweeps above still skipped | ✅ pass — 3/3 suites, 17/17 tests, against disposable throwaway DBs, cleaned up immediately |

No UI browser verification run yet for Step 5.3's rep console or Step 5.4's attribution report —
this checkpoint's own UI-verification debt note (carried since Checkpoint 6) is NOT yet closed.
Given that a working local Postgres is now confirmed available, a real dev-server + browser pass
across ALL deferred surfaces (credit panel, cart admin, checkout — no UI, console, attributions)
is now feasible in this environment and is the next concrete action, ahead of Phase 6's remaining
work.

Step review: skipped — no `engine.stepReview` configured.

## Outcome

Checkpoint **passes**. Phase 5 is complete, full retrospective sweep green, and — newly — the
three highest-risk concurrency mechanisms are independently confirmed against real Postgres.
Proceeding to the deferred UI browser verification pass, then Phase 6 (full gate, integration
coverage, UPGRADE_NOTES, review, QA).
