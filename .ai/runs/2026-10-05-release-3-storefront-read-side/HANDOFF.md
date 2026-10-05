# Handoff — 2026-10-05-release-3-storefront-read-side

**Last updated:** 2026-10-05T13:27:32Z
**Branch:** spec/storefront-release-phase0-reconciliation
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12 (draft)
**Current phase/step:** Phase 3 Step 3.1 (not started — safety stop for owner review)
**Last commit:** c0ef621f3d — test(ecommerce): integration coverage for storefront resolution, buyer context, cache and tenant isolation

## What just happened
- Phases 1–2 done: prerequisites (shared scope hash, PricingContext priceKindId/customerIds, Phase 2b indexes, customer_groups multi-id + assortment_scope) and the ecommerce module through SPEC-029 Phase 1 (entities, admin CRUD, store/buyer resolution, /context, subscribers, search). SPEC-029 Phase 1 gate green (12/12 integration, checkpoint 4).
- Run paused at the executor-dispatch safety stop (~20 consecutive Steps).

## Next concrete action
- Owner review, then resume with `om-auto-continue-pr-loop 12` → Step 3.1 (Omnibus CatalogPriceHistoryEntry entity + migration, spec .ai/specs/2026-06-30-omnibus-price-tracking.md).

## Blockers / open questions
- None blocking. Resolution P95 budget still unmeasured (final gate).

## Environment caveats
- Dev runtime runnable: yes, via the ephemeral env (`JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral:start`); it may still be running at http://127.0.0.1:5001 — stop it before a fresh start.
- Packages must be rebuilt (`yarn build:packages` → `yarn generate` → `yarn build:packages`, turbo --force) before the ephemeral app sees new module code.
- Browser / UI checks: start in Phase 7.
- Database/migration state: local DB untouched; 3 new migrations committed (catalog indexes, customer_groups assortment_scope, ecommerce tables); applied only inside the ephemeral DB.
- `yarn db:generate` always emits unrelated wms snapshot drift — delete it.
- Commit-column convention: a Step's row carries `pending`; the next commit writes the real SHA.
- `.ai/qa/email-capture.jsonl` gets modified by ephemeral runs — never commit it.

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr-loop/release-3-storefront-read-side-20261005-124454
- Created this run: yes (kept for resume)
