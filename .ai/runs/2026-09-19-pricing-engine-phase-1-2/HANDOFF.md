# Handoff — 2026-09-19-pricing-engine-phase-1-2

**Last updated:** 2026-09-19T16:25:00Z
**Branch:** cez/d58af91f (pushed to `fork` remote; PR opened fork→origin/develop)
**PR:** https://github.com/open-mercato/open-mercato/pull/6268 (draft, `in-progress` label held by this run)
**Current phase/step:** Phase 2, Step 2.1 (about to start)
**Last commit:** see `PLAN.md` Tasks table — every Phase 1 row is `done`

## What just happened
- Phase 1 complete: cross-field validators, i18n, shared scope selectors (ComboboxInput-based, with an `ids=`-exact-match fix for pasted ids), list/create/edit admin pages, and `TC-CAT-PRICES-001.spec.ts` (browser-driven integration test).
- Found and fixed a real bug mid-implementation: `/api/catalog/prices` responses are snake_case (verified against `__integration__/TC-CAT-CRUDFORM-002.spec.ts`), not camelCase as first assumed — added `normalizePriceRecord()` and fixed the list/edit pages (Step 1.6-fix).
- Checkpoint 1 done: replaced the dev symlinks with a real `yarn install`, ran `build:packages`/`generate`/`typecheck`/`i18n:check-sync`/`i18n:check-usage` and the full `catalog` jest suite (702/702 passing, 0 regressions). See `checkpoint-1-checks.md`.
- Integration/browser verification of `TC-CAT-PRICES-001` deliberately deferred to the final gate (reason recorded in `checkpoint-1-checks.md`) rather than standing up a disposable DB twice.

## Next concrete action
- Start Phase 2, Step 2.1: `globalThis`-scope the `pricingResolvers` registry in `catalog/lib/pricing.ts` (mirror `packages/shared/src/modules/integrations/types.ts`'s pattern — approach B, a `{ integrations, bundles }`-shaped `getState()`), add `id`/dedupe to `registerCatalogPricingResolver`, and a regression test modeled on `packages/shared/src/modules/integrations/__tests__/types.test.ts` (`jest.isolateModules` + `globalThis`) proving visibility across two simulated module instances. Also document + test the same-priority resolver tie-break (stable registration order).

## Blockers / open questions
- None. Deferred (not blocked): full browser/integration suite run, to the final gate.

## Environment caveats
- Dev runtime runnable: **yes, but not yet stood up** — `yarn install` is real now (no symlinks); a disposable Postgres DB + `mercato init` + dev server still needs to be provisioned at the final gate to run `yarn test:integration` / `TC-CAT-PRICES-001` for real. Local Postgres is available (`psql -l` shows several `om_qa_*` databases from other runs); `.ai/qa/AGENTS.md`'s Docker-based `test:integration:ephemeral` path is NOT usable here (no container runtime on this machine) — use the manual disposable-DB path it documents as the alternative.
- Browser / UI checks: deferred to final gate, see above.
- Database/migration state: clean; this run makes **no schema changes** (Phase 2b/index migration explicitly out of scope, confirmed again in Phase 2 planning).

## Worktree
- Path: /Users/bernard/workspace/open-mercato/.ai/cezar/worktrees/d58af91f-381a-4f31-9ed5-416013c71710
- Created this run: no (reusing the cezar-provided worktree)
- `node_modules`/`packages/core/generated`: real (installed/generated), not symlinked, as of this checkpoint.
