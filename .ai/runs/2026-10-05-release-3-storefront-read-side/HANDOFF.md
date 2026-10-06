# Handoff — 2026-10-05-release-3-storefront-read-side

**Last updated:** 2026-10-06T16:40:11Z
**Branch:** spec/storefront-release-phase0-reconciliation
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12 (draft)
**Current phase/step:** Phase 7 Step 7.6 (not started)
**Last commit:** bd03b75d25 — feat(ecommerce): store General tab with store-default availability policy

## What just happened
- Steps 7.1–7.5 landed: branding validation + SSR style helper, branding command route + preview, assortment-count endpoint, admin store list/create/edit shell, General tab with store-default availability policy. Checkpoint 13 green incl. UI smoke + screenshots.

## Next concrete action
- Step 7.6 — Branding tab + sandboxed live preview. Tab contract: append a `StoreEditTabDefinition` to `STORE_EDIT_TABS` in `ecommerce/components/storeEditTabs.tsx` (`?tab=branding`). PUT /stores/:id/branding has REPLACE semantics — send the full branding set (NOTIFY 7.2).

## Blockers / open questions
- None blocking. Resolution P95 budget unmeasured (final gate). Listing query budget: 13 uncached / 16 with a category filter (> spec §10's 13) — spec-sync or optimize. Follow-up candidate: other translatable entities with derived list-URL mismatches (NOTIFY 6.1-fix).

## Environment caveats
- Ephemeral env running (started 16:36Z, port in .ai/qa/ephemeral-env.json; includes code through bd03b75d25). Integration runs need BOTH `BASE_URL` and `DATABASE_URL` exported from that file, else storefront specs fail with `store_not_found`.
- New module code needs `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` and an env restart (kill the next-server listener + its parent `test:ephemeral` processes, `docker rm -f` the env's pgvector container; never `pkill -f next-server`). Start: `JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral:start`.
- `yarn db:generate` always emits unrelated wms snapshot drift — delete it.
- Commit-column convention: a Step's row carries `pending`; the next commit writes the real SHA.
- `.ai/qa/email-capture.jsonl` gets modified by ephemeral runs — never commit it.
- UI smoke: throwaway Playwright scripts in the session scratchpad, installed headless shell via executablePath (NOTIFY checkpoint 6/7). Restart helper used this session: kill only processes whose cmdline starts with node (never match the killing shell's own command line).

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr-loop/release-3-storefront-read-side-20261005-124454
- Created by the original run (kept for resume)
