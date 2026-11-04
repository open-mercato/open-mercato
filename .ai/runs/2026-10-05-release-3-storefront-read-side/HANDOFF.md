# Handoff — 2026-10-05-release-3-storefront-read-side

**Last updated:** 2026-10-07
**Branch:** spec/storefront-release-phase0-reconciliation
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12 (ready for review)
**Status:** complete. Every Tasks row is done (1.1 .. 7.18-review-fix).
**Last code commit:** f25d337288 — fix(ecommerce,catalog): run storefront requests and the Omnibus backfill in the store tenant cache namespace

## What just happened
- Steps 7.11 and 7.12 landed, then the final gate (`final-gate-checks.md`). It produced three fixes: 7.12-gate-fix (docs registry), 7.12-ds-fix and 7.12-ui-fix.
- The `om-auto-review-pr` autofix pass (comment review on the PR) found 1 blocker and 6 majors, fixed in 7.13–7.17-review-fix:
  - Omnibus history: individualized and tier prices, no-op updates, tombstones, channel-less prices, org-scoped backfill coverage;
  - a gap in the storefront cache-key inputs;
  - the unbounded load past the cap.
- The one-shot re-run of the touched integration suites exposed a pre-existing cache-namespace bug: storefront and CLI reads were stale after admin writes. It was fixed in 7.18-review-fix and re-gated.

## Next concrete action
- An independent maintainer review. GitHub blocks self-approval; the PR carries `review`.
- Manual QA (`needs-qa`) of the admin store editor and the group-terms pickers.

## Open items / follow-ups (none blocking)
- Listing query budget is 13 uncached and 16 with a category filter, above spec §10's 13. The detail budget is ≤11 against spec §10's 7.
- Facets are counted in memory. Past the 5,000-product cap, `priceRange` is null unless a price sort or filter is requested.
- Rate limits are inactive until `RATE_LIMIT_TRUST_PROXY_DEPTH` is set.
- The pgvector search path, the 429 path and the draft-store seed upgrade action are unit-tested only.
- US-E1 empty-intersection warning not built. Logo and favicon are URL fields only.
- Spec-sync items are listed in NOTIFY (Omnibus spec: untracked individualized/tier prices, tombstone exclusion, channel-less match, org-scoped coverage, trigger rename; public API §6.3 `priceRange` past the cap).
- Follow-up issue candidates:
  - translatable-entity list-URL mismatches (NOTIFY 6.1-fix);
  - shared filter normalizer bugs (NOTIFY 4.4);
  - product-level `PUT /api/catalog/prices` returning 403 (NOTIFY 3.9);
  - module-config cache reads in the global namespace from other unauthenticated or CLI callers (configs service).

## Environment caveats
- **Integration triage:** attached-mode `yarn test:integration` (BASE_URL against a separately started env) does not pass the app's runtime env to the test process. Confirm failures with `yarn test:integration:ephemeral "<regex>"` before calling them regressions.
- **CI-only env:** TC-START-001, TC-ONBOARDING-EMAIL-001 and TC-DOCUMENTS-009/013 need env that only CI sets, so they fail on this host in any mode.
- `create-mercato-app#test` fails about 80 tests on this host's bwrap sandbox (pre-existing).
- New module code needs `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force`, then an env restart.
- Never commit `.ai/qa/email-capture.jsonl`.

## Worktree
- Path: /home/bernard/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr-loop/release-3-storefront-read-side-20261005-124454
- Created by the original run (kept)
