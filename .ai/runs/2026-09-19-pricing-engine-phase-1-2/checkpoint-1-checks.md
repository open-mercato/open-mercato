# Checkpoint 1 — Phase 1 complete (Steps 1.1–1.7, plus 1.6-fix, 1.6-fix2)

**Date:** 2026-09-19T16:20:00Z
**Runner:** local (no `app` container running; per root `AGENTS.md` § Validation Commands this is the "otherwise local mode" branch)
**Environment note:** this checkpoint replaced the dev-testing `node_modules`/`packages/core/generated` symlinks (used for fast unit-test iteration while resuming) with a **real `yarn install`** — every check below ran against the actual installed toolchain, not the symlink.

## Targeted validation

| Command | Result |
|---|---|
| `yarn build:packages` | ✅ 38/38 tasks successful |
| `yarn generate` | ✅ completed (pre-existing, unrelated OpenAPI-bundle-fallback warning — falls back to static extraction, not caused by this change) |
| `yarn typecheck` | ✅ 38/38 packages, **zero errors** — including `@open-mercato/core` and `@open-mercato/ui` (both cache-miss / freshly executed). The `titleHeadingLevel`/`@tanstack/react-table/legacy`/`totalIsCapped` errors seen earlier in this session under the dev symlink do not reproduce under a real install; they were a stale-`node_modules` artifact, not a real defect. |
| `yarn i18n:check-sync` | ✅ "All translation files are in sync" across en/pl/es/de/ko |
| `yarn i18n:check-usage` | ✅ exit 0 (advisory-only per root `AGENTS.md`) — 7891 unused keys repo-wide, pre-existing, not concentrated in the new `catalog.prices.*` namespace |
| `jest` — `catalog/data/__tests__/validators.prices.test.ts`, `validators.compliance.test.ts`, `lib/__tests__/pricing.test.ts`, `commands/__tests__/variants.priceScope.test.ts` | ✅ 4 suites, 30 tests |
| `jest` — full `src/modules/catalog` | ✅ **71 suites, 702 tests, 0 failures** — no regression anywhere in the module |

## Integration / UI verification

**Deferred to the final gate (step 9), not skipped.** Reasoning: standing up a disposable Postgres DB + `mercato init` + dev server for a one-off checkpoint pass, then repeating that same bootstrap at the final gate once Phase 2 also lands, would duplicate a non-trivial setup for no additional coverage — Phase 1's UI code is already typecheck-clean and unit-tested, and `TC-CAT-PRICES-001.spec.ts` (committed in Step 1.7) is ready to run against that environment. The final gate is the step explicitly scoped for the full `om-integration-tests` pass; it will provision the environment once, run the full suite (including `TC-CAT-PRICES-001`) and the design-system pass, and report real browser evidence there rather than a partial pass now.

This is a scope-appropriate skip per the checkpoint contract ("UI verification MUST NEVER block development... skip and log the reason"), not an omission — the reason is recorded here and in `HANDOFF.md`.

## Scope of this checkpoint

Phase 1 (catalog admin UI): validators cross-field checks, i18n, shared scope selectors (+ 2 follow-up fixes: snake_case API response parsing, `ids=` exact-id lookup), list page, create page, edit page, integration test spec. Phase 2 (resolver hardening) starts next.
