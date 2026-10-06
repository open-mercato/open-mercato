# Handoff — 2026-10-05-release-3-storefront-read-side

**Last updated:** 2026-10-06T12:26:53Z
**Branch:** spec/storefront-release-phase0-reconciliation
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12 (draft)
**Current phase/step:** Phase 6 Step 6.1 (not started)
**Last commit:** 283603f0d8 — test(ecommerce): require_authentication channel gate integration suite

## What just happened
- Phase 5 done (Buyer-Scoped Visibility Phase 2): channel binding `require_authentication` + anonymous short-circuit to `[]` before customer_groups, migration, TC-ECOM-005. Checkpoint 10 green.

## Next concrete action
- Step 6.1 — catalog option/choice label translations (D20). MUST use the key format `options.<optionCode>.label` / `options.<optionCode>.choices.<choiceCode>.label` already read by `ecommerce/lib/storefrontDetail.ts` (or move those helpers into catalog and re-export).

## Blockers / open questions
- None blocking. Resolution P95 budget still unmeasured (final gate). 6.2 must keep the listing query budget — switch listing translations to `batchLoadTranslationsMany` (NOTIFY 4.6/4.7 notes).

## Environment caveats
- Ephemeral env running (started 11:40Z, port in .ai/qa/ephemeral-env.json). Integration runs need BOTH `BASE_URL` and `DATABASE_URL` exported from that file, else storefront specs fail with `store_not_found`.
- New module code needs `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` and an env restart (kill the next-server listener + its parent `test:ephemeral` processes, `docker rm -f` the env's pgvector container; never `pkill -f next-server`). Start: `JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral:start`.
- `yarn db:generate` always emits unrelated wms snapshot drift — delete it.
- Commit-column convention: a Step's row carries `pending`; the next commit writes the real SHA.
- `.ai/qa/email-capture.jsonl` gets modified by ephemeral runs — never commit it.
- Browser / UI checks start in Phase 7 (Playwright uses the installed headless shell via executablePath — NOTIFY checkpoint 6/7).

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr-loop/release-3-storefront-read-side-20261005-124454
- Created by the original run (kept for resume)
