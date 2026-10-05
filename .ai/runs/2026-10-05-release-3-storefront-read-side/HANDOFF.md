# Handoff — 2026-10-05-release-3-storefront-read-side

**Last updated:** 2026-10-05T17:48:10Z
**Branch:** spec/storefront-release-phase0-reconciliation
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12 (draft)
**Current phase/step:** Phase 4 Step 4.1
**Last commit:** 2ea735bc2d — test(catalog): omnibus integration coverage

## What just happened
- Phase 3 (Omnibus MVP) closed: 8/8 integration tests green (checkpoint 7).

## Next concrete action
- Step 4.1 — catalog product filters extraction to lib with descendant expansion.

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
