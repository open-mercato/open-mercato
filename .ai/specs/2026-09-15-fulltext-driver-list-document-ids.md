# Fulltext driver: list document IDs per entity (uncapped pagination)

## 📝 TLDR

The fulltext search driver interface has no way to enumerate the document IDs stored for one entity in one tenant without already knowing those IDs. The only workaround — an empty-query `search()` call filtered by `_entityId` — is capped by Meilisearch's `maxTotalHits` (default 1000), so it silently misses documents beyond the first page on any entity with more than 1000 indexed records. This spec adds an optional `listDocumentIds` method to the `FullTextSearchDriver` interface, implements it for the Meilisearch driver via `index.getDocuments({ filter, fields: ['_id'], limit, offset })` (a call Meilisearch does not subject to `maxTotalHits`), and threads it through `FullTextSearchStrategy` so any current or future caller (for example a retention/prune job that reconciles the index against live database rows) can page through all indexed IDs for an entity+tenant without a hit cap.

## Overview

`packages/search/src/fulltext/types.ts` defines `FullTextSearchDriver`, an interface already dense with optional members (`bulkIndex`, `purge`, `clearIndex`, `recreateIndex`, `getDocuments`, `getIndexStats`, `getEntityCounts`) that let a driver implementation opt into capabilities beyond the mandatory `index`/`search`/`delete` core, with `FullTextSearchStrategy` (`packages/search/src/strategies/fulltext.strategy.ts`) passing each through as `null`-when-unsupported. None of these existing members let a caller enumerate every document ID for an entity+tenant beyond Meilisearch's `maxTotalHits` search cap — `getDocuments` requires already knowing the IDs, `getEntityCounts` returns counts only, and `purge` deletes without reading. This spec closes that gap with one new optional driver member, `listDocumentIds`, following the exact optionality and access-pattern precedent `getEntityCounts` already established, plus a Meilisearch implementation grounded in `index.getDocuments`'s pagination shape (verified against the Meilisearch SDK's actual types in this repo, not from memory) confirming it is not subject to the search-hit cap. Scope is the primitive only — building the retention/prune job that would consume it to reconcile the index against live database rows is called out as an explicit, separate Phase 2, not built here. The companion implementation is already merged as PR #6128.

## Resolved assumptions (autonomous defaults)

| # | Question | Resolved answer | Rationale |
|---|----------|------------------|-----------|
| 1 | Should the method return a plain `string[]` or a paginated envelope (`{ ids, total, offset, limit }`)? | Plain `string[]` (matching the issue's own suggested signature) | Smallest new surface; every existing pagination consumer in this codebase already pages by "keep going while the last page was full," which does not need `total`. Fully reversible — an envelope can be added additively later if a caller needs it. |
| 2 | Should `listDocumentIds` support `organizationId` scoping in v1, or defer it? | Include it now, optional, mirroring `purge(entityId, tenantId, organizationId?)` | `purge`'s own organization-scoping gap was a prior security-relevant bug (issue #2935). Deferring the same scoping on a new list primitive would risk repeating that gap; adding it now costs one extra optional filter clause reusing existing `purge` code shape. |
| 3 | Should this spec also add a REST endpoint / prune job consumer? | No — driver + strategy primitive only, consumer deferred to Phase 2 | The issue asks for the enumeration primitive, not a full retention pipeline (no consumer, retention policy, or schedule is specified anywhere in the issue). Smallest reversible scope; building an unspecified consumer now risks guessing wrong at its actual requirements. |

None of the above weakens security, tenant/organization data scoping, or a documented compatibility contract, so none require `⚠ NEEDS HUMAN CONFIRMATION`.

## 📝 Problem Statement

`packages/search/src/fulltext/drivers/meilisearch/index.ts` exposes `getDocuments(ids)` (requires already knowing the IDs), `purge(entityId, tenantId, organizationId?)` (deletes everything for an entity in one shot, no partial/id-scoped read), and `getEntityCounts(tenantId)` (counts only, no IDs). Deindex-on-delete elsewhere in the codebase is best-effort: if Meilisearch is briefly unreachable when a record is deleted from the database, the stale document (including any plaintext title/snippet) stays in the index indefinitely, with no supported way to discover and remove it later short of purging the entire entity. The closest available technique — `search('', { filter: '_entityId = "..."' })` — inherits Meilisearch's `maxTotalHits` search-hit cap, so any reconciliation logic built on it silently stops seeing documents once an entity's index passes 1000 records, which is a realistic size for many entities in production. This spec closes that primitive gap; building the reconciliation/prune job itself is out of scope (see Phasing).

## 📝 Proposed Solution

Add `listDocumentIds` as an **optional** driver method, following the same optionality precedent as `bulkIndex`, `purge`, `clearIndex`, `recreateIndex`, `getDocuments`, `getIndexStats`, and `getEntityCounts` — additive, no existing driver is forced to implement it, and a driver that omits it degrades to "not supported" rather than a hard failure.

```ts
listDocumentIds?(
  entityId: EntityId,
  tenantId: string,
  options?: { offset?: number; limit?: number; organizationId?: string | null }
): Promise<string[]>
```

The Meilisearch implementation calls `index.getDocuments({ filter, fields: ['_id'], limit, offset })` — the same client primitive `getDocuments(ids)` already uses for ID-scoped lookups, but filtered by `_entityId` (and optionally `_organizationId`) instead of `_id IN [...]`. Meilisearch's own documentation and SDK types confirm `getDocuments` returns `{ results, total, offset, limit }` (a `Pagination` shape) with no `maxTotalHits` cap — that limit is specific to the `search()` endpoint's ranking pipeline, not to plain document retrieval.

**Alternatives considered:**
- *Keep using paginated `search()` and raise `maxTotalHits`.* Rejected — `maxTotalHits` is a per-index Meilisearch setting bounding memory use during ranked search; raising it for every index to support an admin/retention path is a global cost paid by the hot query path, and it does not remove the cap, only moves it.
- *Add a REST endpoint (`GET /api/search/.../document-ids`).* Rejected — no consumer needs this over HTTP today; the issue only asks for a driver/strategy primitive. An endpoint can be added later, additively, when a concrete consumer needs it (see Phasing).
- *Return the full pagination envelope (`{ ids, total, offset, limit }`) instead of `string[]`.* Rejected for v1 — the issue's own suggested signature and every sibling pagination consumer in this codebase (see `search-indexer.ts` reindex loops) already page by "keep requesting while the last page came back full," which only needs the ID array; `total` is not required to detect completion and would be immediately stale for a live index. Kept as a documented non-goal so it can be added additively if a future caller needs it.

## 📝 Architecture

No new components. Three existing layers gain one optional method each, plus one barrel re-export, mirroring the existing `getEntityCounts` precedent for optionality and access pattern (but not for error handling — see API Contracts):

- **`packages/search/src/fulltext/types.ts`** — add `listDocumentIds?(...)` and a new exported `ListDocumentIdsOptions` type to the `FullTextSearchDriver` interface (optional, additive — no BC impact per `BACKWARD_COMPATIBILITY.md`'s interface rules, since existing implementers are structurally unaffected by a new optional member).
- **`packages/search/src/fulltext/drivers/meilisearch/index.ts`** — implement `listDocumentIds` using `index.getDocuments({ filter, fields: ['_id'], limit, offset })`, reusing the existing `buildIndexName` and `escapeFilterValue` helpers, but with its own narrower `index_not_found`-only catch (see API Contracts) rather than reusing `getDocuments`'s bare `catch {}` or `getEntityCounts`'s `null`-on-not-found shape.
- **`packages/search/src/strategies/fulltext.strategy.ts`** — add a pass-through `listDocumentIds` on `FullTextSearchStrategy`, following the exact `if (!this.driver.listDocumentIds) return null` / `return this.driver.listDocumentIds(...)` shape already used for `getEntityCounts`.
- **`packages/search/src/fulltext/index.ts`** — re-export the new `ListDocumentIdsOptions` type from the package barrel, alongside the driver's other public types.

`SearchService` (the top-level facade in `service.ts`) is **not** touched — `getEntityCounts` and `getDocuments` are likewise absent from that facade; today's one real caller (`packages/core/src/modules/query_index/api/status.ts`) resolves the fulltext strategy directly (`searchStrategies.find(...)` cast to `FullTextSearchStrategy`) and calls the strategy method directly. `listDocumentIds` follows that same established access pattern, so a future retention job resolves the strategy the same way `status.ts` already does.

## 📝 Data Model

None. No schema, migration, or new persisted field. The method reads existing Meilisearch-managed document storage.

## 📝 API Contracts

No new HTTP endpoint (see Alternatives). The driver/strategy method contract, plus a new exported options type re-exported from the package barrel (`packages/search/src/fulltext/index.ts`) so external callers do not need to import from `fulltext/types.ts` directly:

```ts
// FullTextSearchDriver (packages/search/src/fulltext/types.ts)
export type ListDocumentIdsOptions = {
  offset?: number
  limit?: number
  organizationId?: string | null
}

listDocumentIds?(
  entityId: EntityId,
  tenantId: string,
  options?: ListDocumentIdsOptions
): Promise<string[]>

// FullTextSearchStrategy (packages/search/src/strategies/fulltext.strategy.ts)
async listDocumentIds(
  entityId: EntityId,
  tenantId: string,
  options?: ListDocumentIdsOptions
): Promise<string[] | null>
```

- `entityId` / `tenantId`: same scoping semantics as every other driver method (tenant selects the Meilisearch index; entity filters within it).
- `organizationId` (optional): when provided, scopes the listed IDs to that organization, mirroring `purge(entityId, tenantId, organizationId?)`'s existing scoping — added now rather than as a follow-up fix, since `purge`'s own organization-scoping gap was a prior security-relevant bug (issue #2935, covered by `packages/search/src/__tests__/purge-org-scoping.test.ts`); a list primitive that could not be scoped the same way would risk a caller reconciling across organization boundaries.
- `offset` / `limit`: standard pagination — `limit` defaults to the driver's existing `defaultLimit` (20) when omitted, matching `search()`'s own default. That default suits `search()`'s ranked-result-page use case but means one round-trip per 20 IDs for a bulk-enumeration caller; `index.getDocuments` has no `maxTotalHits`-style ceiling, so a bulk consumer (e.g. the Phase 2 prune job) should pass an explicit, larger `limit` rather than relying on the default.
- Returns `string[]` (record IDs, unprefixed by entity — matching `_id` as stored, i.e. `recordId`) at the driver level; the driver method always exists-or-doesn't (optional member), so no "unsupported" signal is needed at that layer.
- The **strategy** layer returns `string[] | null`: `null` means the underlying driver does not implement `listDocumentIds` (mirrors `getEntityCounts`'s `null` = "not supported" signal); a `string[]` — including an empty array — means the call succeeded and that page has zero or more IDs. A caller pages by requesting `offset += limit` while the last page returned exactly `limit` IDs, and stops once a page returns fewer than `limit` (including zero).
- Error handling is new, stricter behavior, not a match for an existing sibling method: an `index_not_found` Meilisearch error returns `[]` (nothing indexed yet for that tenant); any other driver error propagates to the caller unchanged. This differs from both existing siblings — `getDocuments` swallows every error (including `index_not_found`) behind a bare `catch {}` and returns an empty result regardless of cause, and `getEntityCounts` returns `null` (not `[]`) on `index_not_found`. `listDocumentIds` deliberately does not reuse either shape: a caller (in particular the planned Phase 2 prune consumer) must be able to tell "nothing indexed" apart from "Meilisearch is unreachable," which `getDocuments`'s blanket swallow cannot express.

## 📝 UI/UX

None — this is a backend driver primitive with no UI surface.

## 📝 Edge Cases & Failure Scenarios

- **Tenant has no index yet** (`index_not_found`): returns `[]`. This is new, stricter behavior for this method specifically — it does not match `getDocuments` (which swallows every error, `index_not_found` included, via a bare `catch {}`) or `getEntityCounts` (which returns `null`, not `[]`, on `index_not_found`); `purge` returns `void` regardless.
- **Entity has zero documents for the given filter**: `index.getDocuments` returns `{ results: [] }`; the driver returns `[]`.
- **`organizationId` provided but no documents match it**: same as above — empty array, not an error.
- **Meilisearch unreachable / other driver error**: propagates (not swallowed) — matches `search()`'s and `index()`'s existing fail-loud behavior for available strategies, per this package's `AGENTS.md` rule that a write/read path for an available strategy must not throw per record but also must not lie about failure; only the specific `index_not_found` case is treated as "nothing to list." Unlike `getDocuments`'s bare `catch {}`, this method does not swallow non-`index_not_found` errors.
- **Driver does not implement `listDocumentIds`** (any current or future non-Meilisearch driver): `FullTextSearchStrategy.listDocumentIds` returns `null`, which a caller must check before treating an empty result as "fully paged, nothing left."
- **Caller requests `limit` larger than Meilisearch's own request-level ceiling**: unaffected by this feature — `index.getDocuments` is a plain document fetch, not the ranked `search()` path, so `maxTotalHits` does not apply; existing per-request size limits (if any) are Meilisearch's own concern, not something this method needs to enforce.
- **Paging while the index is being mutated (not a snapshot)**: `offset`/`limit` pagination over `index.getDocuments` reflects Meilisearch's live internal document order at the moment of each call, not a fixed snapshot taken at the first page. If a document before the current offset is removed (or the index otherwise changes) between two page requests, every remaining document shifts down by one position, and the next `offset += limit` page silently skips one ID — with no error, exactly the kind of silent miss this method exists to eliminate for consumers built on top of it. A caller that mutates the index while paging (e.g. the Phase 2 prune consumer deleting orphans as it finds them) must either (a) collect every page into a full ID list first and only mutate afterward, or (b) re-page from `offset: 0` repeatedly until a full pass finds zero orphans. No ordering guarantee beyond "Meilisearch's own internal document order, which this method does not control or stabilize" is given.

## 📝 Risks & Impact Review

- **Blast radius**: four files touched, all in `packages/search` — `fulltext/types.ts`, `fulltext/drivers/meilisearch/index.ts`, `fulltext/index.ts` (barrel re-export of `ListDocumentIdsOptions`), and `strategies/fulltext.strategy.ts` — all additive optional members / re-exports. No existing call site changes behavior.
- **Backward compatibility**: additive interface member on an already-optional-member-heavy interface (`FullTextSearchDriver`) — per `BACKWARD_COMPATIBILITY.md`, adding an optional member to an interface is additive, not breaking; no deprecation protocol needed.
- **Rollback**: revert the four-file diff; nothing else depends on the new method yet (no consumer ships in this spec).
- **Performance**: `index.getDocuments` with a `filter` and `fields: ['_id']` is a lighter-weight read than a ranked `search()` call (no relevance scoring, no typo tolerance pass) — expected to be cheaper per page, not more expensive.

| Risk | Severity | Area | Mitigation | Residual Risk |
| --- | --- | --- | --- | --- |
| A future consumer pages with `offset`/`limit` while concurrently mutating the index (e.g. deleting orphans as it finds them), silently skipping IDs as the live document order shifts. | Medium | Data integrity (future Phase 2 consumer) | Documented explicitly as its own Edge Case entry: collect the full ID list before mutating, or re-page from `offset: 0` until a pass finds nothing left to remove. | Present until a real Phase 2 consumer is built and reviewed against this contract; no consumer ships in this spec, so nothing exercises the risk yet. |
| A caller assumes `listDocumentIds`'s error handling matches `getDocuments` (swallows everything) or `getEntityCounts` (`null` on not-found) and mishandles a thrown error. | Low | API contract clarity | This spec's API Contracts and Edge Cases sections now state explicitly that the error handling is new and does not match either sibling; the implementation (#6128) narrows its `catch` to `index_not_found` only. | Low — the divergence is now documented in three places (API Contracts, Edge Cases, Architecture) rather than asserted once. |
| A bulk-enumeration caller uses the unchanged default `limit` (20, tuned for `search()`) and pays one round-trip per 20 IDs. | Low | Performance | API Contracts now tells bulk callers (the planned Phase 2 prune job included) to pass an explicit, larger `limit`. | Low — advisory only; the method still functions correctly at the default, just less efficiently. |
| No implementation code changes with this spec, so the risk review above is validated only against the already-merged companion PR (#6128), not against a fresh implementation. | Low | Process | The grounding checks in this review (both the author's self-review and the independent re-review) cross-checked every spec claim line-for-line against #6128's actual diff, not from memory. | None — #6128 is merged into `develop`, not a hypothetical. |

## 📋 Phasing

- **Phase 1 (this spec)**: add `listDocumentIds` to the driver interface, the Meilisearch implementation, and the strategy pass-through, with unit test coverage. Ships the primitive only.
- **Phase 2 (future, separate issue/spec — not built here)**: a retention/prune job or admin tool that calls `FullTextSearchStrategy.listDocumentIds`, diffs the returned IDs against the live table, and calls `driver.delete`/`strategy.delete` for orphans. Explicitly out of scope for this spec — the original issue asks only for the enumeration primitive ("happy to open a PR if you confirm the direction" refers to this primitive, not a full prune pipeline).

## 📋 Implementation Plan

**Phase 1 — Add the `listDocumentIds` primitive**

1. **Add the interface member.** In `packages/search/src/fulltext/types.ts`, add `listDocumentIds?(entityId: EntityId, tenantId: string, options?: { offset?: number; limit?: number; organizationId?: string | null }): Promise<string[]>` to `FullTextSearchDriver`, grouped with the other optional "Document retrieval for enrichment" members. Testable via `yarn workspace @open-mercato/search typecheck` (or the package's `tsc --noEmit`) — the interface compiles and existing implementers remain valid without change.
2. **Implement it in the Meilisearch driver.** In `packages/search/src/fulltext/drivers/meilisearch/index.ts`, add `listDocumentIds` to the returned `driver` object: build the index name via `buildIndexName(tenantId)`, build a filter string via `escapeFilterValue` (`_entityId = "..."`, `AND _organizationId = "..."` when `organizationId` is provided — reuse the same conditional shape as `purge`), call `index.getDocuments({ filter, fields: ['_id'], limit: options?.limit ?? defaultLimit, offset: options?.offset ?? 0 })`, and map `documents.results` to `string[]` via `(doc as Record<string, unknown>)._id as string`. Catch only `index_not_found` and return `[]`; rethrow every other error — this is deliberately a narrower catch than `getDocuments`'s bare `catch {}`, per the error-handling contract in API Contracts and Edge Cases above. Leaves the app working — no existing method changes.
3. **Add the strategy pass-through.** In `packages/search/src/strategies/fulltext.strategy.ts`, add `async listDocumentIds(entityId, tenantId, options?): Promise<string[] | null>` that returns `null` when `!this.driver.listDocumentIds`, otherwise delegates to `this.driver.listDocumentIds(entityId, tenantId, options)`. Mirrors `getEntityCounts` exactly.
4. **Export the options type from the package barrel.** In `packages/search/src/fulltext/index.ts`, re-export `ListDocumentIdsOptions` alongside the driver's other public types, so external callers (and the planned Phase 2 consumer) can import it from `@open-mercato/search` rather than reaching into `fulltext/types.ts` directly.
5. **Unit tests.** In `packages/search/src/__tests__/` (new file, e.g. `fulltext-list-document-ids.test.ts`, following the `fakeStrategy`/fake-driver style already used in `purge-org-scoping.test.ts`):
   - Meilisearch driver: a fake Meilisearch client whose `index().getDocuments` records the `filter`/`limit`/`offset` it was called with and returns a fixture `{ results: [{ _id: '...' }, ...] }`; assert the driver maps to `string[]`, includes `_organizationId` in the filter only when passed, and returns `[]` on a thrown `{ code: 'index_not_found' }`.
   - `FullTextSearchStrategy.listDocumentIds`: one test asserting `null` when the driver has no `listDocumentIds`, one asserting pass-through of args and return value when it does.
   Each test is independently runnable via `yarn workspace @open-mercato/search test -- fulltext-list-document-ids`, and the app (and the package's build) remains fully working after this step — nothing else calls the new method yet.

No further phases ship in this PR; Phase 2 is tracked as future follow-up work per the Phasing section above.

## Final Compliance Report

- No API route URLs or methods added or changed — no new HTTP endpoint ships in this spec.
- No database schema, migration, or persisted-field changes.
- No DI service names changed.
- `FullTextSearchDriver` (`packages/search/src/fulltext/types.ts`) gains one new optional member, `listDocumentIds`, plus one new exported type, `ListDocumentIdsOptions` — both additive per `BACKWARD_COMPATIBILITY.md`'s interface rules; no existing implementer is required to change.
- `FullTextSearchStrategy` gains one new pass-through method, `listDocumentIds`, mirroring the existing `getEntityCounts` `null`-when-unsupported shape.
- `packages/search/src/fulltext/index.ts` re-exports `ListDocumentIdsOptions` from the package barrel — additive.
- No event IDs, widget spot IDs, CLI commands, or notification IDs are added, removed, or renamed.
- Companion implementation PR #6128 is merged; this spec's technical claims (interface signature, driver filter/catch behavior, strategy pass-through, barrel export, and the 6-test unit coverage) were cross-checked line-for-line against that merged diff, not from memory.

## Changelog

- 2026-09-15 - Initial spec drafted for issue #5931; companion implementation PR #6128 opened.
- 2026-09-22 - Self-review (comment-only, author cannot formally approve own PR): no blockers or majors, one non-blocking nit noted (Architecture/Blast radius omitted the fourth touched file).
- 2026-09-23 - Independent re-review requested changes on three Medium findings: (1) the error-handling description incorrectly claimed `listDocumentIds` "matches" `getDocuments`/`getEntityCounts`, when it is deliberately new, stricter behavior — corrected in API Contracts, Edge Cases, and Architecture; (2) offset-based paging while the index is concurrently mutated was undocumented — added as an explicit Edge Case and a Risks table entry; (3) required spec sections (Overview, Final Compliance Report, Changelog) were missing — added, and the Risks section was reshaped into a severity/area/mitigation/residual-risk table per `.ai/specs/AGENTS.md`'s Spec Content Checklist. Also addressed both inherited nits: named `ListDocumentIdsOptions` and listed the fourth touched file (`fulltext/index.ts`) in Architecture/API Contracts/Blast radius; noted the default `limit` (20) as a consideration for bulk callers in API Contracts. Companion PR #6128 merged into `develop` during this pass; every corrected claim was re-verified against its actual merged diff.
