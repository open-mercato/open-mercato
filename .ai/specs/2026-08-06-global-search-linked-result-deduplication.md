# Global Search Linked-Result Deduplication

## TLDR

Global search can return both a canonical customer entity and its person or company profile, even though the profile presenter navigates to the canonical entity page and both entries have the same title. This is addressed on two levels.

By default the token strategy no longer returns base `customers:customer_entity` rows, so only the navigable profile reaches the result list and the duplicate cannot arise. `OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY=true` restores them for deployments that want them; the presentation-level merge then folds the linked profile hit into the matching navigation-less entity hit, keeping the canonical entity identity, copying the profile presenter and navigation, and leaving distinct content results intact.

## Overview

Issue #5046 reports people and companies appearing multiple times in the global search dropdown. The token strategy can return `customers:customer_entity` because the query index contains its searchable fields. The customers search configuration also registers `customers:customer_person_profile` and `customers:customer_company_profile`, whose presenters resolve to the same person or company detail page.

The index rows are valid and remain in place. What changes is which entity types the token strategy is willing to return, plus the presentation-level merge for the case where the base rows are still returned.

## Problem Statement

The cross-strategy merger deduplicates by organization, entity type, and record ID. That correctly merges the same indexed record across fulltext, vector, and token strategies, but it cannot identify an entity/profile pair because those records have different entity types and IDs.

The request-time presenter enricher has the information needed to identify the pair:

- the base entity result has no navigation target;
- the profile result has the same presenter title;
- the profile's direct URL ends with the base entity's record ID;
- both results have the same organization scope.

Without a second presentation-level merge, the UI shows both entries and the base result can be non-interactive.

A second problem surfaced only once the change ran against a real environment: base-entity results were reaching global search for superadmins but not for anyone else, because `resolveReadableEntityTypes` narrows non-superadmin callers to entity types a module registered for search and `customers:customer_entity` is not one of them. The merge therefore produced a canonical entity result for one class of user and a bare profile result for another. Excluding the base rows from token search results removes that split — every caller now sees the profile.

## Proposed Solution

### Do not return base customer entities from token search (default)

`packages/core/src/modules/query_index/lib/search-entity-policy.ts` owns the decision. `OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY` defaults to `false`, and while it is off `TokenSearchStrategy.search` excludes the type in SQL: it drops it from an explicit `entityTypes` filter (short-circuiting to no results when nothing else was requested) and otherwise adds a `NOT IN` predicate. Filtering in the query rather than after it keeps the caller's `limit` from being silently consumed by rows that are about to be discarded.

Fulltext and vector are unaffected: `SearchIndexer` already refuses to index an entity no module registered for search, so `customers:customer_entity` never reached those stores. The tokens strategy is the only one that could produce it.

#### Why the rows are not simply dropped from `search_tokens`

The obvious alternative — gating `buildSearchTokenRows` so the base rows are never written — was implemented, tested, and then rejected, because `search_tokens` is not only the token-search index:

- `packages/core/src/modules/customers/api/people/route.ts` and `.../companies/route.ts` resolve their list-search box through `findMatchingEntityIdsBySearchTokensAcrossSources` with `E.customers.customer_entity` as a source, over `display_name`, `primary_email`, `primary_phone`, `description`, `status`, `lifecycle_stage`, `source` and `next_interaction_name`. Several of those fields exist only on the base row.
- Both query engines rewrite `like`/`ilike` on encrypted customer columns into the same table (`packages/shared/src/lib/query/engine.ts`, `packages/core/src/modules/query_index/lib/engine.ts`), because an `ILIKE` against ciphertext matches nothing.

Dropping the rows would therefore have turned People/Companies list search into a silent empty result — a strictly worse bug than the one being fixed. The flag governs search **visibility**; token storage is left alone, which also means flipping it needs no reindex and no purge in either direction.

### Merge linked duplicates (when base entities are searchable)

With `OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY=true` the pair can still appear, so the presentation-level merge remains. After presenter and navigation enrichment:

1. Index results by organization scope and record ID.
2. Inspect only direct navigation URLs without query strings or page anchors.
3. When a linked result's URL ends with exactly one other navigation-less result's record ID, require the presenter titles to match.
4. Keep the base result's `entityId` and `recordId`, copy the linked result's presenter, URL, and links, and retain the higher score.
5. Remove only the linked duplicate.
6. Sort the reduced result list by score descending so the merged score and rendered position remain consistent.

This is deliberately stricter than title-based deduplication. Two different customers with the same display name remain separate because their record IDs and URLs differ.

## Architecture

Two boundaries, one per level.

The exclusion policy lives in `packages/core/src/modules/query_index/lib/search-entity-policy.ts` because `query_index` owns `search_tokens` — it is the sole writer, and it writes for every entity a CRUD route indexes, independently of any module's `search.ts`. Its consumer is `packages/search/src/strategies/token.strategy.ts`; the search package already imports `search-tokens` from core, so no new dependency edge is introduced. Reading the env var at the point of use keeps the flag free of registration-ordering or global-state hazards.

The merge runs in `packages/search/src/lib/presenter-enricher.ts` after all configured presenters and navigation links have been recomputed for the request locale. It does not alter the RRF entity/record merge or the public search contracts. The presenter enricher is the correct boundary for it because it is the first stage where token-only base results and configured profile navigation are available together.

## Data Models

No database, migration, index, or stored-document changes. `entity_indexes` and `search_tokens` keep exactly the rows they held before, so the query engine, the People/Companies list search and the encrypted-column lookups all behave identically. Flipping the flag in either direction takes effect on the next query and never requires a reindex.

## API Contracts

The `/api/search/search/global` response shape remains unchanged. What changes is the row set.

Default (`OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY=false`): a customer produces exactly one result, the person or company profile, carrying that profile's `entityId`, `recordId`, presenter and detail-page URL. Requesting `entityTypes=customers:customer_entity` explicitly returns an empty result set rather than an error.

Enabled (`=true`): the previous behavior. A customer entity/profile pair produces one merged result — canonical identity from the base entity's `entityId` and `recordId`, display and navigation from the linked profile presenter, score the higher of the two.

Either way the response stays ordered by score descending, and other `SearchService` consumers get the same behavior.

## Testing

- Policy unit coverage for the flag: default off, explicit on, and no effect on any other entity type.
- `buildSearchTokenRows` coverage proving the writer ignores the flag entirely — base-entity tokens are still emitted, byte-identical in both flag states — so a future change cannot quietly break list search.
- Token-strategy coverage pinning the read-path SQL: `NOT IN` when no types were requested, the excluded type dropped from an explicit `entityTypes` list, no query issued at all when only excluded types were requested, and an untouched query when the flag is on.
- Presenter-enricher regression coverage for both person and company entity/profile pairs.
- Reverse-order regression coverage proving a higher-scoring profile moves the merged entity to the correct position.
- Route-level coverage proving the global search API returns one navigable result per customer.
- Integration coverage (`TC-SEARCH-006`) using created person and company records: the profiles are indexed and returned, the base rows are absent from token search results, and global search returns exactly one navigable result per customer.
- Negative coverage proving anchored content results such as customer notes are not merged into the base entity.

Manual QA should search for a known person and company through Cmd+K and confirm each appears once and opens the expected v2 detail page.

## Risks & Impact Review

### Incorrectly merging different records with the same title

- Severity: medium.
- Mitigation: a title match alone is insufficient; organization scope and the terminal URL record ID must also identify exactly one navigation-less result.
- Residual risk: low.

### Hiding customer content hits

- Severity: medium.
- Mitigation: URLs with query strings or anchors are excluded, so notes and activity results targeting sections on the customer page remain distinct.
- Residual risk: low.

### Cross-organization merging

- Severity: high.
- Mitigation: candidate lookup includes `organizationId`; results from different organizations cannot be paired.
- Residual risk: low.

### Ranking changes

- Severity: low.
- Mitigation: the merged result keeps the higher existing score instead of summing both scores, avoiding an artificial relevance boost, and the reduced list is re-sorted so each result's position continues to reflect its score.
- Residual risk: low.

### A caller depending on base customer entities in search results

- Severity: medium. Failure scenario: an integration calls `GET /api/search/search?entityTypes=customers:customer_entity` (or a `SearchService.search` consumer filters results by that entity type) and, after the upgrade, receives an empty list instead of hits.
- Affected area: token-strategy consumers only — the query engine, list filters, and encrypted-column lookups query `search_tokens` directly and are untouched.
- Mitigation: the behavior is a single env flip away (`OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY=true`), needs no reindex, and the affected results were already invisible to every non-superadmin because `resolveReadableEntityTypes` excludes entity types no module registers for search. The exposure is therefore limited to superadmin-context callers.
- Residual risk: low.

### Breaking People/Companies list search by removing the token rows

- Severity: high. Failure scenario: the exclusion is pushed down into `buildSearchTokenRows`, `search_tokens` loses its `customers:customer_entity` rows, and the People and Companies list search boxes — which resolve ids through those exact rows over `display_name`, `primary_email`, `description` and friends — start returning an empty page for every query, indistinguishable from a genuine no-match.
- Affected area: `customers/api/people/route.ts`, `customers/api/companies/route.ts`, and both query engines' encrypted `like`/`ilike` rewrite.
- Mitigation: the flag is deliberately read-side only and the writer ignores it; a unit test asserts the writer emits byte-identical rows in both flag states, so a later attempt to "finish the job" fails the suite instead of shipping.
- Residual risk: low.

## Final Compliance Report

- No public type, function signature, API route, or response shape change. `OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY` is a new, additive env flag; setting it to `true` reproduces the prior behavior exactly.
- Tenant and organization scoping is preserved; the new predicate only narrows entity types and never widens a scope.
- No persistence, migration, index, or generated-file changes. `entity_indexes` and `search_tokens` are unchanged, so no reindex or purge is needed in either flag direction.
- Focused unit, strategy, route-level, and integration tests cover both flag states and the positive and negative branches.
- Manual UI QA remains required because the visible global-search result list changes.

## Changelog

### 2026-08-22

- Added `OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY` (default `false`): the token strategy no longer returns base `customers:customer_entity` rows, so a customer surfaces once, through their profile. The exclusion is read-side only — `search_tokens` still holds the rows, because the People/Companies list search and the encrypted `like`/`ilike` rewrite resolve ids through them.
- Documented the flag in `apps/mercato/.env.example`, the create-app template, and `packages/search/AGENTS.md`, and added policy, writer-invariant, and read-path unit coverage.
- Reworked `TC-SEARCH-006` to assert the default behavior: one navigable profile result per customer and no base-entity row in token search results. This also resolves the `ephemeral-integration` failure, which was the superadmin-only base-entity result the exclusion now removes for everyone.

### 2026-08-07

- Preserved score-descending order after merging linked results.
- Added reverse-order and real customer integration coverage for the ranking and title-equality invariants.

### 2026-08-06

- Added strict post-enrichment merging for linked customer entity/profile search results.
- Added person, company, anchored-content, and global-route regression coverage.
