# Execution Plan: fulltext-driver-list-document-ids

Source doc: `.ai/specs/2026-09-15-fulltext-driver-list-document-ids.md` (spec PR #6127)
Issue: #5931

## Goal

Add an optional `listDocumentIds` method to the fulltext search driver interface (Meilisearch implementation) and its `FullTextSearchStrategy` pass-through, so a future consumer can page through all indexed document IDs for an entity+tenant without Meilisearch's `maxTotalHits` search-hit cap.

## Scope

- `packages/search/src/fulltext/types.ts` — add the optional `listDocumentIds` member to `FullTextSearchDriver`.
- `packages/search/src/fulltext/drivers/meilisearch/index.ts` — implement it via `index.getDocuments({ filter, fields: ['_id'], limit, offset })`.
- `packages/search/src/strategies/fulltext.strategy.ts` — add the pass-through `listDocumentIds` returning `string[] | null`.
- Unit tests for both the driver implementation and the strategy pass-through.

**Non-goals:** no REST endpoint, no retention/prune job consumer, no `SearchService` facade change — all explicitly deferred to a future Phase 2 per the spec.

## Implementation Plan

### Phase 1: Add the `listDocumentIds` primitive

- [ ] 1.1 Add `listDocumentIds?(entityId, tenantId, options?: { offset?, limit?, organizationId? }): Promise<string[]>` to `FullTextSearchDriver` in `packages/search/src/fulltext/types.ts`, grouped with the other optional document-retrieval members.
- [ ] 1.2 Implement `listDocumentIds` in the Meilisearch driver (`packages/search/src/fulltext/drivers/meilisearch/index.ts`): build the index name via `buildIndexName(tenantId)`, build the filter via `escapeFilterValue` (`_entityId = "..."`, plus `AND _organizationId = "..."` when `organizationId` is provided, mirroring `purge`'s filter construction), call `index.getDocuments({ filter, fields: ['_id'], limit: options?.limit ?? defaultLimit, offset: options?.offset ?? 0 })`, map results to `string[]`, and catch `index_not_found` to return `[]` (matching `getDocuments`/`purge`/`getEntityCounts`).
- [ ] 1.3 Add the `FullTextSearchStrategy.listDocumentIds` pass-through in `packages/search/src/strategies/fulltext.strategy.ts`, returning `null` when `!this.driver.listDocumentIds`, otherwise delegating to the driver — mirroring `getEntityCounts` exactly.
- [ ] 1.4 Add unit tests in `packages/search/src/__tests__/fulltext-list-document-ids.test.ts`: (a) Meilisearch driver — a fake client whose `index().getDocuments` records the `filter`/`limit`/`offset` args and returns a fixture, asserting `organizationId` is only added to the filter when passed and that `index_not_found` yields `[]`; (b) `FullTextSearchStrategy.listDocumentIds` — asserts `null` when the driver lacks the method, and pass-through of args/return value when it has it.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Add the `listDocumentIds` primitive

- [ ] 1.1 Add `listDocumentIds` to `FullTextSearchDriver` interface
- [ ] 1.2 Implement `listDocumentIds` in the Meilisearch driver
- [ ] 1.3 Add `FullTextSearchStrategy.listDocumentIds` pass-through
- [ ] 1.4 Add unit tests for driver + strategy
