# Handoff — 2026-10-05-release-3-storefront-read-side

**Last updated:** 2026-10-06T15:41:11Z
**Branch:** spec/storefront-release-phase0-reconciliation
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12 (draft)
**Current phase/step:** Phase 7 Step 7.1 (not started)
**Last commit:** 8250cfd419 — test(ecommerce): storefront facets, categories, search and rate-limit integration suites

## What just happened
- Phase 6 done (Storefront Public API Phases 2–3): option label translations (+6.1-fix), facets, categories, search suggest, rate limits + OpenAPI, TC-ECOM-014..017. 6.6 found and fixed a store-resolution 500 (instanceof across bundle layers). Checkpoint 12: TC-ECOM 32/32, full core 19734.

## Next concrete action
- Step 7.1 — lib/brandingStyles.ts (OKLCH/hex validation, font allowlist, fixed declaration set, SSR `<style>` helper, injection fuzz suite). Phase 7 = SPEC-029 Phases 2–3 (branding + admin UI); UI Steps need screenshots at checkpoints.

## Blockers / open questions
- None blocking. Resolution P95 budget unmeasured (final gate). Listing query budget: 13 uncached / 16 with a category filter (> spec §10's 13) — spec-sync or optimize. Follow-up candidate: other translatable entities with derived list-URL mismatches (NOTIFY 6.1-fix).

## Environment caveats
- Ephemeral env running (started 15:27Z, port in .ai/qa/ephemeral-env.json; includes code through 8250cfd419). Integration runs need BOTH `BASE_URL` and `DATABASE_URL` exported from that file, else storefront specs fail with `store_not_found`.
- New module code needs `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` and an env restart (kill the next-server listener + its parent `test:ephemeral` processes, `docker rm -f` the env's pgvector container; never `pkill -f next-server`). Start: `JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral:start`.
- `yarn db:generate` always emits unrelated wms snapshot drift — delete it.
- Commit-column convention: a Step's row carries `pending`; the next commit writes the real SHA.
- `.ai/qa/email-capture.jsonl` gets modified by ephemeral runs — never commit it.
- Browser / UI checks start in Phase 7 (Playwright uses the installed headless shell via executablePath — NOTIFY checkpoint 6/7).

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr-loop/release-3-storefront-read-side-20261005-124454
- Created by the original run (kept for resume)
