# Deprecate `SearchResultPresenter.badge`

- **Status:** Implemented (deprecation staged; removal pending)
- **Issue:** [#5716](https://github.com/open-mercato/open-mercato/issues/5716)
- **PR:** [#5731](https://github.com/open-mercato/open-mercato/pull/5731)
- **Contract surface:** category 2 (public types) — `SearchResultPresenter` in `@open-mercato/shared/modules/search`
- **Related:** [#4886](https://github.com/open-mercato/open-mercato/issues/4886) (`8a3f27921`), [`2026-05-20-search-presenter-i18n.md`](2026-05-20-search-presenter-i18n.md)

## Problem

`SearchResultPresenter.badge` is written, translated, stored, round-tripped — and rendered by nobody.

- **Producers (13):** `catalog`, `customer_accounts`, `customers`, `documents`, `eudr`, `messages`, `planner`, `resources`, `sales`, `staff`, `warranty_claims`, `wms`, and the `example` app module.
- **Translations:** ~70 distinct `<module>.search.badge.*` keys across `en`/`pl`/`es`/`de`.
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

The same duplication holds for `staff`, `planner`, `documents`, and the `label`-derived badges in `sales`, `catalog`, `wms` and `eudr` — 11 of the 13 producers. Rendering `badge` would print the same word twice on nearly every result.

The one producer whose badge was genuinely per-record is `warranty_claims` (`badge: status ?? undefined`), and `subtitle` — which *is* rendered — is the right home for a per-record status.

Note that #4886's presenter work is not wasted by this decision: it is what makes the *rendered* strings (`title`, `subtitle`, `link.label`) locale-correct per request. Only the badge portion of it was inert.

## Scope

**In scope**

1. `@deprecated` JSDoc on `SearchResultPresenter.badge` naming both replacements and the target removal version (0.9.0).
2. Rehome the one genuinely per-record badge: `warranty_claims` appends its **localized** status to `subtitle`.
3. An `UPGRADE_NOTES.md` entry under `0.7.0 → 0.7.1` with the migration paths.
4. Stop the authoring surfaces teaching `badge` as a rendered field: the `packages/search/AGENTS.md` presenter reference and its two examples, the `hybrid-search.mdx` worked example, and the `example` app module mirrored into the create-app template — otherwise a deprecation that only lives in a JSDoc keeps producing new producers.
5. A supersede note on `.ai/specs/2026-05-20-search-presenter-i18n.md`, the still-active spec whose flow diagram is the origin of the misunderstanding.

**Explicitly out of scope**

- Removing the field. That is the 0.9.0 step and needs its own change.
- Stripping `badge` from the remaining 11 producers (10 core modules plus `documents`). They keep compiling and working; module owners migrate during the deprecation window.
- Retiring the `result_badge` column, the Meilisearch document field, and the pgvector round-trip. These retire separately once the window closes; dropping the presenter field itself needs **no migration**.

## Implementation

| File | Change |
|---|---|
| `packages/shared/src/modules/search.ts` | `@deprecated` JSDoc on `badge`; field otherwise untouched |
| `packages/core/src/modules/warranty_claims/search.ts` | `resolvePresenter` becomes async and resolves translations; localized status appended to `subtitle`; `badge` dropped from this producer |
| `packages/core/src/modules/warranty_claims/__tests__/search.test.ts` | Regression coverage for the status-in-subtitle behavior |
| `UPGRADE_NOTES.md` | `0.7.0 → 0.7.1` deprecation entry |
| `packages/search/AGENTS.md` | Presenter-reference comment rewritten to state the field is deprecated, unrendered and slated for 0.9.0 removal; `badge:` dropped from the `buildSource` and `formatResult` authoring examples |
| `apps/docs/docs/framework/database/hybrid-search.mdx` | `badge:` dropped from both halves of the worked example |
| `apps/mercato/src/modules/example/search.ts` + its create-app template mirror | `badge` dropped from the canonical example presenter, so a newly scaffolded app no longer starts life populating a deprecated field; the now-unused `example.search.todo.badge` key removed from all five locales in both copies |
| `.ai/specs/2026-05-20-search-presenter-i18n.md` | Supersede note marking its `presenter.badge` rendering claims historical |

`resolvePresenter` going async is safe and conventional: `SearchModuleConfig.formatResult` is typed `=> Promise<SearchResultPresenter | null> | SearchResultPresenter | null` (`packages/shared/src/modules/search.ts:278`), every other module already declares `formatResult: async` (warranty_claims was the outlier), `resolveLinks` in this same file already awaits `resolveTranslations()`, and all three consumers await the result inside a `try`/`catch` — `packages/search/src/lib/presenter-enricher.ts:232`, `packages/search/src/vector/services/vector-index.service.ts:757`, `packages/search/src/indexer/search-indexer.ts:235`.

The status is localized through the pre-existing `warranty_claims.status.*` keys, which are already translated in all five locales (`en`, `pl`, `es`, `de`, `ko`), and falls back to the raw token for an unrecognized status.

## Migration & Backward Compatibility

**This release (0.7.1) is not a breaking change.** `badge` remains declared, accepted, populated by 11 of the 13 in-repo producers (`warranty_claims` and `example` are the two this change stops), localized per request and stored. Only its JSDoc changed, so no downstream module breaks and no migration is forced yet.

Deprecation protocol compliance (`BACKWARD_COMPATIBILITY.md` § Deprecation Protocol):

| Step | Status |
|---|---|
| 1. Never remove or rename in a single release | ✅ Nothing removed; the field stays |
| 2. Deprecate first, with migration guidance and target removal version | ✅ `@deprecated` JSDoc names both replacements and 0.9.0 |
| 3. Provide a bridge for ≥ 1 minor version | ✅ The old behavior is kept intact — producers, storage and round-trip all unchanged. The bridge window is 0.7.1 → 0.9.0 |
| 4. Document in `UPGRADE_NOTES.md` | ✅ Entry under `0.7.0 → 0.7.1` |
| 5. Reference a spec with a Migration & Backward Compatibility section | ✅ This document |

**Migration for module authors** — stop populating `presenter.badge` before 0.9.0 and move the value to the replacement matching what it holds:

- **An entity-type label** (the common case): delete the `badge` and add a `search.entityType.<module>.<entity>` key. Every search surface already renders that label, so this is usually a pure deletion plus one key per entity. Without the key the label falls back to a humanized `entityId` such as `Warranty Claims · Warranty Claim`.
- **Per-record detail** (a status, a counterparty, a date): append it to `subtitle`, which is rendered on all three surfaces.

**Behavioral change in this release** — one module only: warranty-claim search results gain a localized status as a third subtitle segment (`Ada Lovelace — repair — In review`). Because the presenter is re-rendered per request by `createPresenterEnricher`, the status follows the requester's locale rather than the indexing worker's. No other module's search output changes.

**No data migration.** No schema change, no reindex required. Existing `result_badge` values remain readable and simply stay unrendered, exactly as before.

## Removal plan (0.9.0, separate change)

1. Confirm no in-repo producer still sets `badge` (11 remain at the time of writing).
2. Delete the field from `SearchResultPresenter`, and the `<module>.search.badge.*` keys left unused.
3. Retire the `result_badge` column, the Meilisearch document field and the pgvector round-trip — this step *does* need a migration and should be assessed on its own.
4. Correct the stale rendering claims inline in [`2026-05-20-search-presenter-i18n.md`](2026-05-20-search-presenter-i18n.md) (`:150`, `:182`), or retire that spec to `.ai/specs/implemented/`. This change adds a supersede banner at its head so the claims cannot mislead in the meantime, but leaves the flow diagram itself as the historical record.

## Testing

- `packages/core/src/modules/warranty_claims/__tests__/search.test.ts` — the localized status reaches `subtitle`, is translated rather than the raw `in_review` token, and `badge` is no longer set; plus a guard that a statusless claim produces no trailing separator. The first test was verified to fail against the unfixed presenter.
- Full gate green: `build:packages` (×2), `generate`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `build:app`; `@open-mercato/core` 1453 suites / 11,682 tests and `@open-mercato/shared` 185 suites / 2,040 tests.

## Changelog

- **2026-08-28** — Deprecation implemented and shipped in #5731. Removal deferred to 0.9.0.
