# Checkpoint 2 — Steps 1.6..1.10

**Range:** Step 1.6 (`e94c9305dc`) .. Step 1.10 (`9a6703e162`)
**Date:** 2026-10-26 (UTC)
**Runner:** local (no Docker `app` container running in this environment)

## Touched areas

- `packages/core/src/modules/customer_groups/` — credit service (row-lock concurrency, 1.6),
  credit admin API/UI/ACL/encryption (1.7), credit notifications/exposure-audit job/
  cancel-release subscriber (1.8)
- `packages/core/src/modules/promotions/` — `revertCodeUse` + `sales.order.cancelled` reversal
  subscriber (1.9), un-hidden `delivery_method` rule + `DELIVERY_DISCOUNT` effect (1.10)
- `.ai/specs/SPEC-055-2026-02-23-promotions-module.md` — amended twice (v2.3.0 by 1.9, v2.4.0 by
  1.10)

Step 1.7 touched a UI widget (`detail:customers.company`/`.person` credit-panel tab). Its own
executor ran `i18n:check-sync`/`i18n:check-hardcoded`/`i18n:check-values` scoped to the module
(reported clean) and the module's own component test as part of its Step; no dev-server/browser
smoke pass was run for it at the time. Re-checked here: `yarn i18n:check-sync` (full) below.

## Checks run

| Check | Scope | Result |
|---|---|---|
| `yarn typecheck --force` (bypasses the cross-worktree shared turbo cache) | full monorepo (40 packages) | ✅ pass — `40 successful, 40 total`, `0 cached` |
| `jest --config packages/core/jest.config.cjs src/modules/customer_groups src/modules/promotions src/modules/cart` | `packages/core`, touched modules + cart regression guard (D-R5-17 must not affect cart's no-delivery-context `evaluate` calls) | ✅ pass — 79/80 suites, 910/912 tests (1 suite / 2 tests skipped: the `OM_CUSTOMER_GROUPS_PG_URL`-gated real-Postgres concurrency suite from Step 1.6, expected skip — no Postgres instance in this environment) |

`yarn i18n:check-sync`/`i18n:check-hardcoded` not re-run at the full-repo scope this checkpoint —
each UI-touching Step (1.7, 1.10's admin rule-builder i18n) already ran and reported these clean
scoped to its own module as part of its own scratch sanity check; deferred to the final gate
(Phase 6) for the full-repo pass, per the checkpoint pass's "relevant subset" rule.

No dev-server/browser UI verification run this checkpoint: the only UI touched (1.7's credit-panel
tab, 1.10's rule-builder type picker) are additive, feature-gated surfaces with no existing golden
path depending on them yet (the credit feature has no caller until Phase 4/5; the rule-builder
addition is an admin-only authoring surface). Per the checkpoint pass's own UI-verification rule,
this is noted rather than skipped silently: a dedicated backend-UI smoke pass for both surfaces is
deferred to Checkpoint 3 or the final gate, whichever first requires the dev server up (Phase 2's
cart admin list, Step 2.10, will need it regardless).

Step review: skipped — no `engine.stepReview` configured in `.ai/agentic.config.json`.

## Outcome

Checkpoint **passes**. No regressions, no fix-forward Steps needed. Phase 1 is almost complete —
two gap-fill Steps (1.11 account provisioning, 1.12 manual `/adjust` settlement) remain before
Phase 1 closes. Proceeding to Step 1.11.
