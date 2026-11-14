# Checkpoint 7 — Steps 3.1..3.4 (+ fix-forward 3.1-fix)

**Range:** Step 3.1 (`4a056a7764`) .. Step 3.4 (`469bd19c17`), including the `3.1-fix` fix-forward
commit (`efc2335eb9`)
**Date:** 2026-10-27 (UTC)
**Runner:** local (no Docker `app` container running in this environment)

## Touched areas

- `packages/core/src/modules/cart/` — approval gate in `cart.lock` (3.1); `/current/request-approval`
  + K3 lifecycle withdrawal wiring (3.2); §7a proposal seam commands — create/reject/re-author
  (3.3); §7a proposal routes, sweeper branches, undo-merge refusal (3.4)
- `packages/core/src/modules/customer_groups/` — `resolveTerms` fixed to resolve
  `termsCurrencyCode` + D-R5-37 base-currency fallback (3.1)
- `packages/core/src/modules/ecommerce/` — `3.1-fix`: fixed a real typecheck regression from
  Step 2.13 (`mergeStoreSettings` missing `shipping`, plus `shipping` was never added to the
  settings PATCH schema at all)

This completes the `cart` module's work for this wave (approval gate + proposal seam, Phase 3's
entire scope for `cart`) and closes the Step 2.5 `resolveTerms` currency gap that was tracked
since Checkpoint 4.

## On the Checkpoint 6 / Step 3.1 typecheck discrepancy

Immediately after Step 3.1 landed, a forced full `yarn typecheck` found a genuine TS error in
`ecommerce` code that Checkpoint 6's own forced typecheck (run right after Step 2.13, before
3.1) had reported clean for the identical committed source. Inspecting the commit directly
confirmed the bug WAS present in that tree. The discrepancy itself was not resolved (logged as
such in `NOTIFY.md` rather than papered over with a guessed cause) — the practical response was:
fix the real bug (`3.1-fix`), and from this checkpoint onward, wipe `tsconfig.tsbuildinfo` before
every forced typecheck run to remove TS's own incremental-build cache as a possible confound.
Step 3.4's own executor independently did the same tsbuildinfo wipe before its own verification,
unprompted — a good sign the discipline is taking hold.

## Checks run

| Check | Scope | Result |
|---|---|---|
| `rm tsconfig.tsbuildinfo` (all packages) + `yarn typecheck --force` | full monorepo (40 packages) | ✅ pass — `40 successful, 40 total`, `0 cached` |
| `jest --config packages/core/jest.config.cjs src/modules/cart` | full `cart` module (7th consecutive Step touching it) | ✅ pass — 30/30 suites, 417/417 tests |
| `jest --config packages/core/jest.config.cjs src/modules/customer_groups src/modules/ecommerce` | `resolveTerms` fix regression guard + the `3.1-fix` regression guard | ✅ pass — 112/114 suites, 1365/1373 tests (2 expected Postgres-gated skips) |

No UI touched in this window (3.1–3.4 are all backend commands/routes/sweepers). The accumulated
UI-verification debt from Checkpoints 3/5/6 (credit panel, cart admin pages) is unchanged — still
explicitly committed to the next UI-touching Step or Step 6.1 at the latest.

Step review: skipped — no `engine.stepReview` configured.

## Outcome

Checkpoint **passes**. No regressions, no further fix-forward needed beyond `3.1-fix` (already
landed and verified). Proceeding to Step 3.5 (checkout B.2 cart-backed links), which closes
Phase 3.
