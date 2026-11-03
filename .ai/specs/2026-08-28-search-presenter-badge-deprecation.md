# Deprecate `SearchResultPresenter.badge`

- **Status:** Implemented (deprecation staged; removal pending)
- **Issue:** [#5716](https://github.com/open-mercato/open-mercato/issues/5716)
- **PR:** [#5731](https://github.com/open-mercato/open-mercato/pull/5731)
- **Contract surface:** category 2 (public types) — `SearchResultPresenter` in `@open-mercato/shared/modules/search`
- **Related:** [#4886](https://github.com/open-mercato/open-mercato/issues/4886) (`8a3f27921`), [`2026-05-20-search-presenter-i18n.md`](2026-05-20-search-presenter-i18n.md)

## Problem

`SearchResultPresenter.badge` is written, translated, stored, round-tripped — and rendered by nobody.

- **Producers (14):** `catalog`, `customer_accounts`, `customers`, `documents`, `ecommerce`, `eudr`, `messages`, `planner`, `resources`, `sales`, `staff`, `warranty_claims`, `wms`, and the `example` app module. (`ecommerce` joined in #7142, after this deprecation was first drafted.)
- **Translations:** ~70 distinct `<module>.search.badge.*` keys across all five locales (`en`/`pl`/`es`/`de`/`ko`).
- **Storage:** the Meilisearch document, plus the `result_badge` column — written in `packages/search/src/vector/services/vector-index.service.ts:482`, read back at `:1178,1250`, carried through `packages/search/src/vector/drivers/pgvector/index.ts:354,486,600`.
- **Consumers:** none. `GlobalSearchDialog.tsx`, `TopbarSearchInline.tsx` and `HybridSearchTable.tsx` each render only `title`, `subtitle` and `icon`.

`git log -S"presenter.badge" -- packages/search/src/modules/search/frontend` is empty for the whole history of the repository: the field has never been rendered in any released version.

The field reads like a display seam because [`2026-05-20-search-presenter-i18n.md`](2026-05-20-search-presenter-i18n.md) says it is one — its flow diagram (`:150`) has "render presenter.title / subtitle / badge / link.label verbatim" and its UI/UX section (`:182`) repeats the claim. That description was aspirational and never matched the renderers. #5716 was filed by a downstream team that documented `badge` in their own module's `search.ts` as the place for a localized type label on the strength of that reading, and never saw the label appear.

## Decision

**Deprecate the field. Do not start rendering it.**

Rendering was the other candidate and is the wrong call, for a reason that only became true with #4886. That change added `resolveEntityTypeLabel()` (`packages/search/src/modules/search/frontend/lib/entityTypeLabel.ts:17`) and the `search.entityType.<module>.<entity>` keys, and **all three search surfaces already render that label** beside every result. Sampling every producer, the badge holds the same per-entity-**type** string that label now carries:

| Producer badge | `search.entityType.*` label already rendered |
|---|---|
| `customers.search.badge.person` → "Person" | `customers.customer_person_profile` → "Person" |
| `messages.search.badge.message` → "Message" | `messages.message` → "Message" |
| `resources.search.badge.resource` → "Resource" | `resources.resources_resource` → "Resource" |
| `customer_accounts.search.badge.customerUser` → "Customer User" | `customer_accounts.customer_user` → "Customer User" |

The same duplication holds for `staff`, `planner`, and the `label`-derived badges in `sales` and `catalog`. Rendering `badge` would print the same word twice on those results.

**Three producers were the exception when this was drafted, and #6006 has since closed the gap.** `wms`, `eudr` and `documents` had no `search.entityType.*` key at the time, so `resolveEntityTypeLabel` fell through to `formatEntityId` (`packages/search/src/modules/search/frontend/lib/entityTypeLabel.ts:11`) and their chips rendered `Wms · Warehouse Location`, `Eudr · Eudr Due Diligence Statement` and `Documents · Document` against badges holding properly localized copy. [#6006](https://github.com/open-mercato/open-mercato/issues/6006) (closed 2026-09-24) added those keys from each module's own dictionary (`packages/core/src/modules/wms/i18n/*.json`, `packages/core/src/modules/eudr/i18n/*.json`, `packages/documents/src/modules/documents/i18n/*.json`), so for those eight entities the chip now carries the same localized type label as the badge and the duplication argument holds for them too.

One producer arrived after #6006 and repeats the gap: `ecommerce` (#7142) sets `badge: 'Store'` (`ecommerce.search.badge.store`) on `ecommerce:ecommerce_store` but declares no `search.entityType.ecommerce.ecommerce_store` key, so its chip reads `Ecommerce · Ecommerce Store`. That does not change the decision — the field is still rendered by nobody, and the entity-type key is still the right home for a type label — but it keeps a precondition on the removal, recorded in the removal plan below.

The one producer whose badge was genuinely per-record is `warranty_claims` (`badge: status ?? undefined`), and `subtitle` — which *is* rendered — is the right home for a per-record status.

Note that #4886's presenter work is not wasted by this decision: it is what makes the *rendered* strings (`title`, `subtitle`, `link.label`) locale-correct per request. Only the badge portion of it was inert.

## Scope

**In scope**

1. `@deprecated` JSDoc on `SearchResultPresenter.badge` naming both replacements and the target removal version (0.11.0), plus the matching tag on its sibling `VectorResultPresenter.badge` (`packages/shared/src/modules/vector.ts:18`) — the vector index writes that field to the same `result_badge` column and it is equally unrendered, so deprecating only one leaves the identical seam open one file over.
2. Rehome the one genuinely per-record badge: `warranty_claims` appends its **localized** status to `subtitle`.
3. An `UPGRADE_NOTES.md` entry under `0.9.0 → 0.9.1 (unreleased)` with the migration paths, naming both presenter types and stating where a downstream author declares the replacement key.
4. Stop the authoring surfaces teaching `badge` as a rendered field: the `packages/search/AGENTS.md` presenter reference and its two examples, the `hybrid-search.mdx` worked example, and the `example` app module mirrored into the create-app template — otherwise a deprecation that only lives in a JSDoc keeps producing new producers.
5. A supersede note on `.ai/specs/2026-05-20-search-presenter-i18n.md`, the still-active spec whose flow diagram is the origin of the misunderstanding.
6. The replacement key for the two modules this change migrates — `search.entityType.warranty_claims.warranty_claim` and `search.entityType.example.todo`, in all five locales — so both perform the whole prescribed migration and not only its deletion half. They are the first `search.entityType.*` keys declared from a module's own dictionary rather than the search package's, which is the pattern a third-party module must use and which `loadDictionary`'s flat merge (`packages/shared/src/lib/i18n/server.ts:64-71`) already supports.

**Explicitly out of scope**

- Removing the field. That is the 0.11.0 step and needs its own change.
- Stripping `badge` from the remaining 12 producers (11 core modules plus `documents`). They keep compiling and working; module owners migrate during the deprecation window.
- Retiring the `result_badge` column, the Meilisearch document field, and the pgvector round-trip. These retire separately once the window closes; dropping the presenter field itself needs **no migration**.

## Implementation

| File | Change |
|---|---|
| `packages/shared/src/modules/search.ts` | `@deprecated` JSDoc on `badge`, naming where the replacement key is declared; field otherwise untouched |
| `packages/shared/src/modules/vector.ts` | `@deprecated` JSDoc on `VectorResultPresenter.badge`, cross-referencing the search-side field; field otherwise untouched |
| `packages/core/src/modules/warranty_claims/search.ts` | `resolvePresenter` becomes async and resolves translations; localized status appended to `subtitle`; `badge` dropped from this producer |
| `packages/core/src/modules/warranty_claims/__tests__/search.test.ts` | Regression coverage for the status-in-subtitle behavior |
| `UPGRADE_NOTES.md` | `0.9.0 → 0.9.1 (unreleased)` deprecation entry |
| `packages/search/AGENTS.md` | Presenter-reference comment rewritten to state the field is deprecated, unrendered and slated for 0.11.0 removal; `badge:` dropped from the `buildSource` and `formatResult` authoring examples |
| `apps/docs/docs/framework/database/hybrid-search.mdx` | `badge:` dropped from both halves of the worked example |
| `apps/mercato/src/modules/example/search.ts` + `vector.ts` + their create-app template mirrors | `badge` dropped from the canonical example presenters, so a newly scaffolded app no longer starts life populating a deprecated field; the now-unused `example.search.todo.badge` key removed from all five locales in both copies and replaced by `search.entityType.example.todo` |
| `packages/core/src/modules/warranty_claims/i18n/*.json` | `search.entityType.warranty_claims.warranty_claim` added in all five locales, so the migrated module keeps a localized type label instead of falling back to `Warranty Claims · Warranty Claim` |
| `.ai/specs/2026-05-20-search-presenter-i18n.md` | Supersede note marking its `presenter.badge` rendering claims historical |

`resolvePresenter` going async is safe and conventional: `SearchModuleConfig.formatResult` is typed `=> Promise<SearchResultPresenter | null> | SearchResultPresenter | null` (`packages/shared/src/modules/search.ts:278`), every other module already declares `formatResult: async` (warranty_claims was the outlier), `resolveLinks` in this same file already awaits `resolveTranslations()`, and all three consumers await the result inside a `try`/`catch` — `packages/search/src/lib/presenter-enricher.ts:232`, `packages/search/src/vector/services/vector-index.service.ts:757`, `packages/search/src/indexer/search-indexer.ts:235`.

The status is localized through the pre-existing `warranty_claims.status.*` keys, which are already translated in all five locales (`en`, `pl`, `es`, `de`, `ko`), and falls back to the raw token for an unrecognized status.

## Migration & Backward Compatibility

**The release this ships in is not a breaking change.** `badge` remains declared on both presenter types, accepted, populated by 12 of the 14 in-repo producers (`warranty_claims` and `example` are the two this change stops), localized per request and stored. Only the JSDoc changed, so no downstream module breaks and no migration is forced yet.

Deprecation protocol compliance (`BACKWARD_COMPATIBILITY.md` § Deprecation Protocol):

| Step | Status |
|---|---|
| 1. Never remove or rename in a single release | ✅ Nothing removed; the field stays |
| 2. Deprecate first, with migration guidance and target removal version | ✅ `@deprecated` JSDoc on `SearchResultPresenter.badge` names both replacements and 0.11.0; `VectorResultPresenter.badge` carries the matching tag, so the deprecation covers the whole contract surface rather than one of its two types |
| 3. Provide a bridge for ≥ 1 minor version | ✅ The old behavior is kept intact — producers, storage and round-trip all unchanged. The deprecation first ships in the release after 0.9.0 (0.9.1 or 0.10.0), and removal is targeted at 0.11.0, so at least one full minor (0.10.x) carries the bridge. The original 0.9.0 target was dropped because 0.9.0 shipped (2026-10-09) before this change merged |
| 4. Document in `UPGRADE_NOTES.md` | ✅ Entry under `0.9.0 → 0.9.1 (unreleased)` |
| 5. Reference a spec with a Migration & Backward Compatibility section | ✅ This document |

This change does **not** add a `SearchResultPresenter` / `VectorResultPresenter` row to `BACKWARD_COMPATIBILITY.md` § Contract Surface Categories → *2. Types*. An earlier revision did, but the create-app harness copies that file into its compatibility cases, and the `OMH-030` total-context cap (`packages/create-app/agentic/shared/ai/harness/cases.json`) leaves under 100 bytes of headroom on `develop` — the row overflowed it by ~1.1 KB and failed `compatibility-context-budget.test.ts`. The five protocol steps do not require the row, so the deprecation, its 0.11.0 target and the removal precondition are recorded in the JSDoc, `UPGRADE_NOTES.md` and this spec instead. If maintainers raise that cap, the row can be added then.

**Migration for module authors** — stop populating `presenter.badge` before 0.11.0 and move the value to the replacement matching what it holds:

- **An entity-type label** (the common case): delete the `badge` and add a `search.entityType.<module>.<entity>` key. Every search surface already renders that label, so this is usually a pure deletion plus one key per entity. Without the key the label falls back to a humanized `entityId` such as `Warranty Claims · Warranty Claim`. Declare the key in **your own module's** `i18n/*.json`: most pre-existing keys happen to live in the search package, which a third-party module cannot edit, but `loadDictionary` merges every module's dictionary into one flat namespace (`packages/shared/src/lib/i18n/server.ts:64-71`) and both i18n checkers collect keys globally, so a module-local `search.*` key resolves normally. The two modules migrated here, and the `wms` / `eudr` / `documents` keys added by #6006, are the in-repo precedent.
- **Per-record detail** (a status, a counterparty, a date): append it to `subtitle`, which is rendered on all three surfaces.

**Behavioral change in this release** — one module only: warranty-claim search results gain a localized status as a third subtitle segment (`Ada Lovelace — repair — In review`). Because the presenter is re-rendered per request by `createPresenterEnricher`, the status follows the requester's locale rather than the indexing worker's. No other module's search output changes.

**No data migration.** No schema change, no reindex required. Existing `result_badge` values remain readable and simply stay unrendered, exactly as before.

## Removal plan (0.11.0, separate change)

1. **Every producer must have a `search.entityType.*` key before `badge` is deleted.** For `wms`, `eudr` and `documents` this precondition is satisfied — #6006 added their keys. `ecommerce` (#7142) is the one producer still without a key at the time of writing ([#7408](https://github.com/open-mercato/open-mercato/issues/7408)); add `search.entityType.ecommerce.ecommerce_store` first, or the removal silently downgrades its label to a humanized id. Re-check for any producer added after this note.
2. Confirm no in-repo producer still sets `badge` (12 remain at the time of writing).
3. Delete the field from **both** `SearchResultPresenter` and `VectorResultPresenter`, and the `<module>.search.badge.*` keys left unused. If a `BACKWARD_COMPATIBILITY.md` *Types* row for these presenters exists by then, drop its `badge?` clause at the same time.
4. Retire the `result_badge` column, the Meilisearch document field and the pgvector round-trip — this step *does* need a migration and should be assessed on its own.
5. Correct the stale rendering claims inline in [`2026-05-20-search-presenter-i18n.md`](2026-05-20-search-presenter-i18n.md) (`:150`, `:182`), or retire that spec to `.ai/specs/implemented/`. This change adds a supersede banner at its head so the claims cannot mislead in the meantime, but leaves the flow diagram itself as the historical record.

## Testing

- `packages/core/src/modules/warranty_claims/__tests__/search.test.ts` — the localized status reaches `subtitle`, is translated rather than the raw `in_review` token, and `badge` is no longer set; plus a guard that a statusless claim produces no trailing separator. The first test was verified to fail against the unfixed presenter.
- Full gate green: `build:packages` (×2), `generate`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `build:app`; `@open-mercato/core` 1453 suites / 11,682 tests and `@open-mercato/shared` 185 suites / 2,040 tests.

## Changelog

- **2026-08-28** — Deprecation implemented in #5731. Removal originally targeted at 0.9.0.
- **2026-09-10** — `BACKWARD_COMPATIBILITY.md` § Types gains the `SearchResultPresenter` / `VectorResultPresenter` row, so the deprecation is recorded in the contract registry the removal PR will read rather than only in this spec, the JSDoc and `UPGRADE_NOTES.md`.
- **2026-09-03** — Review follow-up on #5731: the deprecation extended to `VectorResultPresenter.badge`, the entity-type-label evidence narrowed to the producers that actually have a key (`wms`, `eudr` and `documents` do not, and now gate the removal), the replacement keys added for the two migrated modules from their own dictionaries, and the migration guidance told authors where to declare that key.
- **2026-10-14** — Re-pinned after 0.8.0 and 0.9.0 shipped while #5731 was open: removal target moved from 0.9.0 to 0.11.0, the `UPGRADE_NOTES.md` entry moved to `0.9.0 → 0.9.1 (unreleased)`, the `wms` / `eudr` / `documents` precondition recorded as satisfied by #6006, and `ecommerce` (#7142) recorded as the one producer still lacking a `search.entityType.*` key. The `BACKWARD_COMPATIBILITY.md` row added on 2026-09-10 was withdrawn: it overflowed the create-app harness `OMH-030` context budget after the `develop` merge (see Migration & Backward Compatibility).
