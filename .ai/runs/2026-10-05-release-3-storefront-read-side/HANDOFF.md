# Handoff — 2026-10-05-release-3-storefront-read-side

**Last updated:** 2026-10-06T11:20:52Z
**Branch:** spec/storefront-release-phase0-reconciliation
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12 (draft)
**Current phase/step:** Phase 5 Step 5.1 (not started — safety stop for owner review)
**Last commit:** 230e652b1e — test(ecommerce): storefront public API integration coverage

## What just happened
- Phases 3–4 done: Omnibus MVP and Storefront Public API Phase 1 (scope_keys substrate, scope builder, pricing with promotion overlay D2a, listing, detail, public routes + cache). Release ACCEPTANCE green (checkpoint 9).
- Paused at the executor-dispatch safety stop (22 Steps since resume).

## Next concrete action
- Owner review, then \`om-auto-continue-pr-loop 12\` → Step 5.1 (channel binding require_authentication + resolver short-circuit).

## Blockers / open questions
- None blocking. Resolution P95 budget still unmeasured (final gate).

## Environment caveats
- Dev runtime runnable: yes — ephemeral env (port changes per start; read .ai/qa/ephemeral-env.json). Start: \`JWT_SECRET=\$(openssl rand -hex 32) yarn test:integration:ephemeral:start\` after build:packages → generate → build:packages. Stop: kill the next-server listener and remove the testcontainers postgres (never \`pkill -f next-server\` from a shell whose own command line contains that string).
- Packages must be rebuilt (`yarn build:packages` → `yarn generate` → `yarn build:packages`, turbo --force) before the ephemeral app sees new module code.
- Browser / UI checks: start in Phase 7.
- Database/migration state: local DB untouched; 3 new migrations committed (catalog indexes, customer_groups assortment_scope, ecommerce tables); applied only inside the ephemeral DB.
- `yarn db:generate` always emits unrelated wms snapshot drift — delete it.
- Commit-column convention: a Step's row carries `pending`; the next commit writes the real SHA.
- `.ai/qa/email-capture.jsonl` gets modified by ephemeral runs — never commit it.

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr-loop/release-3-storefront-read-side-20261005-124454
- Created this run: yes (kept for resume)
