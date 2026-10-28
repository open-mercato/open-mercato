# Checkpoint 11 — steps 6.1–6.5 + 6.1-fix

**Timestamp:** 2026-10-06T14:19:49Z
**Steps covered:** 6.1–6.5, 6.1-fix (44e3bc656a .. ed83aad87e)
**Runner:** local mode (`LANG=en_US.UTF-8`) for build/typecheck/unit/lint; ephemeral env (fresh forced build + own DB, started 14:17Z) for the UI smoke
**Touched areas:** catalog option/choice label translations (expander + shared translatable-field registries), translations manager (list-path override), ecommerce facets (cross-exclusion, split cache), categories routes, search suggest (search package `indexDocFilter` on tokens + pgvector, fulltext fails closed), storefront rate limits + OpenAPI contract test, `.env.example` (app + create-app template).

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` | ✅ | |
| typecheck core / shared / search | ✅ | re-run for core + shared after 6.1-fix ✅ |
| `yarn workspace @open-mercato/core test` (FULL, before 6.1-fix) | ✅ 19728 passed | after 6.1-fix: translations + catalog + ecommerce ✅ 1984 |
| `yarn workspace @open-mercato/shared test` (FULL) | ✅ 2643 passed | re-run after 6.1-fix ✅ |
| `yarn workspace @open-mercato/search test` (FULL) | ✅ 376 passed | |
| `yarn i18n:check-sync` | ✅ | |
| `yarn lint` | ✅ | |
| UI smoke — Translation Manager, option schema template (ephemeral) | ❌ → ✅ | first run: derived list URL `/api/catalog/option-schema-templates` 404 → record never loads, option/choice rows never render (6.1 unusable in UI). Fixed in **6.1-fix** (registered list-path override → `/api/catalog/option-schemas`). Re-run: record picker lists the template; rows `Color`, `Color › Red`, `Color › Blue` with base values; PL `Czerwony` saved, persisted across reload, stored as `options.color.choices.red.label`. |

**Artifacts:** `checkpoint-11-artifacts/screenshot-option-label-translations.png` (saved state, PL tab), `checkpoint-11-artifacts/screenshot-option-label-translations-saved.png` (after reload).

**Not yet exercised against a real DB (6.6 covers):** facet assignments query (raw Kysely), categories tree/landing, search suggest on tokens + pgvector incl. the starvation case, rate-limit 429 path.

**Review notes for the final pass:** facets count in memory over the assortment universe instead of per-dimension SQL `GROUP BY` (spec §5.4) — 13 queries uncached, 9 with cached count facets, 16 with a category filter (> §10's 13); plain listings now price the full filtered set (≤ 5 000 cap) for `priceRange` (spec §6.3 approach). Rate limits are effectively inactive until operators set `RATE_LIMIT_TRUST_PROXY_DEPTH` (no client IP → served uncounted, per the `organizations/lookup.ts` precedent; documented in `.env.example`).
