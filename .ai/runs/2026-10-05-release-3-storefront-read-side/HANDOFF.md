# Handoff — 2026-10-05-release-3-storefront-read-side

**Last updated:** 2026-10-06T14:19:49Z
**Branch:** spec/storefront-release-phase0-reconciliation
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12 (draft)
**Current phase/step:** Phase 6 Step 6.6 (not started)
**Last commit:** ed83aad87e — fix(translations): resolve option schema template records so option label fields render

## What just happened
- Steps 6.1–6.5 + 6.1-fix landed: option/choice label translations, facets (cross-exclusion, split cache), categories routes, search suggest (tokens + pgvector, scope in-query), rate limits + OpenAPI contract. Checkpoint 11 green after 6.1-fix (Translation Manager list-URL mismatch found by the UI smoke).

## Next concrete action
- Step 6.6 — integration tests for facets, categories, search (incl. starvation case on a real DB), rate limits (Public API Phases 2–3 gates). Env must be restarted? No — env started 14:17Z already includes everything through ed83aad87e.

## Blockers / open questions
- None blocking. Resolution P95 budget unmeasured (final gate). Listing query budget: 13 uncached / 16 with a category filter (> spec §10's 13) — spec-sync or optimize. Follow-up candidate: other translatable entities with derived list-URL mismatches (NOTIFY 6.1-fix).

## Environment caveats
- Ephemeral env running (started 14:17Z, port in .ai/qa/ephemeral-env.json). Integration runs need BOTH `BASE_URL` and `DATABASE_URL` exported from that file, else storefront specs fail with `store_not_found`.
- New module code needs `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` and an env restart (kill the next-server listener + its parent `test:ephemeral` processes, `docker rm -f` the env's pgvector container; never `pkill -f next-server`). Start: `JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral:start`.
- `yarn db:generate` always emits unrelated wms snapshot drift — delete it.
- Commit-column convention: a Step's row carries `pending`; the next commit writes the real SHA.
- `.ai/qa/email-capture.jsonl` gets modified by ephemeral runs — never commit it.
- Browser / UI checks start in Phase 7 (Playwright uses the installed headless shell via executablePath — NOTIFY checkpoint 6/7).

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr-loop/release-3-storefront-read-side-20261005-124454
- Created by the original run (kept for resume)
