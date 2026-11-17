# Checkpoint 1 — Phase 0 close (Steps 0.1–0.4)

**Date:** 2026-10-14
**Scope:** docs-only spec revision (no code, no migrations, no UI).

## Validation run

Targeted subset of `validation.commands`, limited to what applies to a docs-only phase:

- `find .ai/specs .ai/specs/enterprise -maxdepth 2 -name '*.md' -print` — ran clean, 616 files. (Per `.ai/specs/AGENTS.md`'s own Validation Commands.)
- Manual grep across all four revised files (`2026-08-14-cart-module.md`, `SPEC-055-2026-02-23-promotions-module.md`, `2026-08-21-buyer-scoped-catalog-visibility.md`, `2026-08-14-ecommerce-suite-roadmap.md`) for leftover git conflict markers (`<<<<<<<`/`=======`/`>>>>>>>`) — none found.
- Cross-reference grep for the stale claims PLAN.md Step 0.4 named (`X-Module-Key`, `/carts/:token`, `added_by: 'merge'`, hyphenated event ids, "no cart module on develop") across the three target sibling specs (`2026-08-14-ecommerce-suite-roadmap.md`, `2026-08-21-pricing-engine.md`, `2026-08-14-storefront-public-api.md`/SPEC-029) — none of those stale claims exist in those three files (they were already clean); the hits that did exist were all inside the three files already revised in Steps 0.1–0.3, and are now fixed or are intentional historical changelog entries.
- Heading-structure spot check on `cart-module.md` and `SPEC-055-2026-02-23-promotions-module.md` after the large rewrites (`grep -n "^## \|^### "`) — section numbering and ordering intact, no orphaned headings.

## Not run (and why)

- `yarn build:packages` / `yarn generate` / `yarn typecheck` / `yarn test` / `yarn build:app`: no code exists yet. These gate code changes; Phase 0 produced none. They will run for the first time at the Phase 1 checkpoint (Steps 1.1–1.5 or the first 5-step checkpoint), once the `promotions` module scaffold exists for `yarn generate` to discover.
- `yarn i18n:check-sync` / `yarn i18n:check-usage`: no i18n files exist yet (Phase 1 Step 1.6 creates them).
- UI/Playwright verification: no UI exists yet (Phase 1 Steps 1.7–1.8 create the promotions admin pages). Will run at that checkpoint.

## Outcome

Phase 0 is internally consistent: all three revised specs cross-reference each other correctly (cart's `§6a` ↔ visibility's `§6.0a` ownership table ↔ SPEC-055's `§A.4/§A.5` supersession notes), the D-R4-1…29 decisions are each traceable to at least one concrete spec edit, and no spec contradicts another on a shared contract (route paths, event ids, auth model, discount mapping). Full code-level validation is deferred to the first checkpoint that has code to validate (Phase 1).
