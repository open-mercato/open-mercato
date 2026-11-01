# Checkpoint 9 — Steps 4.1..4.4

**Range:** Step 4.1 (`4e97db75cd`) .. Step 4.4 (`008238bd42`), including the `4.2-fix` fix-forward
commit (`2c25fb7bbf`)
**Date:** 2026-10-28 (UTC)
**Runner:** local (no Docker `app` container running in this environment)

## Touched areas

- `packages/checkout/src/modules/checkout/` — B.4 submit sequence parts 1+2 (4.1, 4.2);
  `expire-awaiting-payment` job (4.2-fix)
- `packages/core/src/modules/customer_groups/` — `linkCreditReservationToOrder` added (4.2)
- `packages/core/src/modules/cart/` — `toSalesSnapshots`, `getSalesSnapshot`, lock refinements
  (4.1); exported completion/compensation helpers for 4.2-fix's reuse
- `packages/core/src/modules/sales/` — `externalReference`/`customerReference` on quote create,
  `(tenant_id, external_reference)` index (D-R5-30)
- `packages/core/src/modules/assisted_selling/` — NEW MODULE: store settings (4.3); thread/
  participant/message/proposal entities + staff author routes (4.4)

This completes checkout's entire B.4 submit sequence — the release's single most complex
orchestration point, composing cart lock, availability reserve/commit, credit reserve/link,
promotion code usage, document creation, and the payment gateway — plus opens the
`assisted_selling` module.

## Checks run

| Check | Scope | Result |
|---|---|---|
| `rm tsconfig.tsbuildinfo` (all packages) + `yarn typecheck --force` | full monorepo (40 packages) | ✅ pass — `40 successful, 40 total`, `0 cached` |
| `jest --config packages/core/jest.config.cjs src/modules/{cart,customer_groups,availability,promotions,assisted_selling}` | every `core` module touched across Phase 4 so far | ✅ pass — 121/124 suites, 1401/1418 tests (3 suites / 17 tests skipped: Postgres-gated real-concurrency suites, expected) |
| `jest --config packages/checkout/jest.config.cjs` (full package) | all of `checkout`'s submit sequence + the new expiry job | ✅ pass — 53/53 suites, 407/407 tests |

Two genuine, real gaps were found and tracked (not papered over) during this window:
`expire-awaiting-payment` (fixed in `4.2-fix`, already verified above) and the `assisted_selling`
terminal-state subscriber + Step 3.3's provisional re-author migration (appended as `4.4-fix`,
not yet built — next Step). Both are the kind of cross-cutting integration gap that only becomes
visible once the pieces are composed, which is exactly what this phase's own Steps are doing —
flagging each as it's found, rather than discovering them all at once in Step 6.1, is working as
intended.

No UI touched in this window. UI-verification debt unchanged.

Step review: skipped — no `engine.stepReview` configured.

## Outcome

Checkpoint **passes**. No regressions. Proceeding to Step 4.4-fix (assisted_selling terminal-state
subscriber + re-author migration), then Step 4.5 (closes Phase 4).
