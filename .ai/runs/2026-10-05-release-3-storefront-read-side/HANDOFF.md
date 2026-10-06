# Handoff — 2026-10-05-release-3-storefront-read-side

**Last updated:** 2026-10-06T18:03:17Z
**Branch:** spec/storefront-release-phase0-reconciliation
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12 (draft)
**Current phase/step:** Phase 7 Step 7.11 (not started — safety stop for owner review)
**Last commit:** ff2cfeffce — fix(ecommerce): wire the domain-mapping enricher into the store domain bindings route

## What just happened
- This resume landed Phases 5–6 and Phase 7 Steps 7.1–7.10 (+ fixes 6.1-fix, 7.7-fix; 7.9 rescued once). Checkpoints 10–14 green; 14 found and fixed the unwired domain-mapping enricher.
- Paused at the executor-dispatch safety stop (21 Steps since resume).

## Next concrete action
- Owner review, then `om-auto-continue-pr-loop 12` → Step 7.11 (setup.ts draft-store seed + Upgrade Action for existing tenants, D17 — see memory/configs `upgrade-actions.ts`), then 7.12 (Playwright integration tests for the admin UI paths incl. an optimistic-lock conflict), then the final gate (full validation.commands, full integration suite, om-ds-guardian over the branch) and the om-auto-review-pr pass.

## Blockers / open questions
- None blocking. Carry to the review pass: listing query budget 13 uncached / 16 with a category filter (> spec §10's 13); rate limits inactive until RATE_LIMIT_TRUST_PROXY_DEPTH is set; pgvector search + 429 path unit-level only; low-severity UI items in checkpoint-13/14-checks.md; spec-sync items accumulated in NOTIFY (facets in memory, categories cache key, /context rate limit, preview without postMessage, logo/favicon URLs, US-E1 warning gap). Resolution P95 budget still unmeasured (final gate). Follow-up issue candidates: translatable-entity list-URL mismatches (NOTIFY 6.1-fix), shared filter normalizer bugs (NOTIFY 4.4), product-level PUT /api/catalog/prices 403 (NOTIFY 3.9).

## Environment caveats
- Ephemeral env running (restarted this session on every rebuild; currently includes code through ff2cfeffce — port in .ai/qa/ephemeral-env.json). Integration runs need BOTH `BASE_URL` and `DATABASE_URL` exported from that file, else storefront specs fail with `store_not_found`.
- New module code needs `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` and an env restart (kill the next-server listener + its parent `test:ephemeral` processes, `docker rm -f` the env's pgvector container; never `pkill -f next-server`). Start: `JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral:start`.
- `yarn db:generate` always emits unrelated wms snapshot drift — delete it.
- Commit-column convention: a Step's row carries `pending`; the next commit writes the real SHA.
- `.ai/qa/email-capture.jsonl` gets modified by ephemeral runs — never commit it.
- UI smoke: throwaway Playwright scripts in the session scratchpad, installed headless shell via executablePath (NOTIFY checkpoint 6/7). Restart helper used this session: kill only processes whose cmdline starts with node (never match the killing shell's own command line).

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr-loop/release-3-storefront-read-side-20261005-124454
- Created by the original run (kept for resume)
