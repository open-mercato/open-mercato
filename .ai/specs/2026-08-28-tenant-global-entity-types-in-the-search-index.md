# Tenant-global entity types in the search index

## TL;DR

A platform-wide catalogue whose source table has neither a `tenant_id` nor an
`organization_id` column gets exactly **one** row in `entity_indexes`, because the
unique key is `(entity_type, entity_id, organization_id_coalesced)`. The incremental
writer already files that row under `tenant_id = NULL` — `resolveQueryIndexRecordScope()`
calls the shape `global` and requires an explicitly null scope for it — but neither
reader has a NULL branch on the tenant axis, so the row is invisible to everyone. The
sweep writer disagreed with the incremental one and stamped the caller's scope. Without an
organization (the CLI) that moved the one row into the caller's tenant, so the last tenant
to reindex took the catalogue from every other, whose leftover tokens then produced hits
with no presenter; with one (`/api/query_index/reindex`) it wrote a separate copy keyed by
that organization, which only that organization could read and nothing kept current.

This aligns the two writers on `tenant_id = NULL, organization_id = NULL` for entity types
declared through `registerTenantGlobalEntityTypes()`, gives the readers the matching NULL
branch on both axes — gated on that declaration, never on the NULL alone — and retires the
rows earlier sweeps stamped. Vector work keeps the caller's scope.

## Overview

- **Changed**: `packages/core/src/modules/query_index/lib/reindexer.ts` — the projection
  scope of a declared catalogue is `null` rather than the caller's tenant and organization;
  vector work keeps the caller's scope; a sweep retires the rows earlier sweeps stamped
- **Changed**: `packages/core/src/modules/query_index/lib/stale.ts` — adds
  `retireScopedCatalogueRows()`; `lib/coverage.ts` adds `deleteScopedCoverageForEntity()`
- **Changed**: `packages/search/src/lib/presenter-enricher.ts` — `fetchDocsBatch()` gains
  the tenant NULL branch
- **Changed**: `packages/search/src/strategies/token.strategy.ts` — `search()` gains the
  same branch on the tenant axis and a declaration-gated one on the organization axis
- **Changed**: `packages/search/src/service.ts` — the organization filter keeps an
  organization-less result for a declared type only
- **Not touched**: the `entity_indexes` unique constraint (no migration — see
  *Rejected alternatives*), the incremental write path, `resolveQueryIndexRecordScope()`,
  `jobScope`, and every entity type that is not declared a catalogue

Builds on `.ai/specs/2026-08-28-tenant-scoped-reindex-of-tenant-less-tables.md`, which
introduced the declaration and stopped the sweep from mis-filing rows of tenant-less
tables that are **not** catalogues. That change made the catalogue case safe; this one
makes it work.

## Problem Statement

### The two writers disagree

`resolveQueryIndexRecordScope()` resolves a source table with neither scope column to
`kind: 'global'`, and requires the event payload to carry an explicitly null tenant and
organization:

```ts
if (sourceScope.kind === 'global') {
  if (!hasPayloadTenantId || !hasPayloadOrganizationId || payloadTenantId !== null || payloadOrganizationId !== null) {
    throw new QueryIndexScopeError(
      'Query index event for a global entity must explicitly provide tenantId and organizationId as null'
    )
  }
  return { tenantId: null, organizationId: null }
}
```

So every row the event path writes for such a table lands under `tenant_id = NULL`.
`reindexEntity()` did the opposite — `scopeOverrides.tenantId = String(tenantId)` — so
the same record's projection moved between the null tenant and a real one depending on
which writer touched it last. There is only one row to move: `entity_indexes` is unique
on `(entity_type, entity_id, organization_id_coalesced)`, and a table with no
`organization_id` coalesces every row to the same value, so the upsert's
`doUpdateSet({ tenant_id })` overwrites in place.

### Neither reader can see the null tenant

Both readers match the tenant exactly:

- `packages/search/src/strategies/token.strategy.ts` — `.where('tenant_id', '=', options.tenantId)`
- `packages/search/src/lib/presenter-enricher.ts` — `.where('tenant_id', '=', tenantId)`

The enricher already has `organization_id = X OR organization_id IS NULL`, and
`buildIndexDoc()` resolves custom fields with `tenant_id = X OR tenant_id IS NULL`. The
tenant axis of the index readers is the one place in this subsystem where a null scope
is not read as "shared".

### What a user sees

`search_tokens` has no unique constraint, so it accumulates one copy per tenant while
`entity_indexes` holds one row in total. Every tenant therefore **finds** a catalogue
record and at most one **resolves** it. The rest reach
`presenter?.title ?? result.recordId` in `GlobalSearchDialog` and get a UUID, with no
subtitle, no badge and no link. The enricher logs *"Doc not found in entity_indexes"* at
debug level, so nothing surfaces above `OM_LOG_LEVEL=debug`.

Reproduced end to end on a multi-tenant deployment: reindexing
`feature_toggles:feature_toggle` as tenant A moved all ten index rows from the previous
owner to A, tenant A's search returned three hits with a full presenter, and the same
query for the previous owner returned the same three hits with `presenter: null` and
`url: null`.

## Design

Three pieces, in the order they depend on each other.

### 1. Reader — the branch the organization axis already has

Both readers widen to `tenant_id = X OR (tenant_id IS NULL AND entity_type IN <declared>)`.

The second conjunct is the whole design. **An unqualified `tenant_id IS NULL` branch
would be fail-open**, and demonstrably so rather than theoretically: `kind: 'global'` is
a structural verdict — no organization column and no tenant column — and in this
repository it also covers `directory:tenant` (one row per tenant, `name` tokenised),
`auth:user_role`, `auth:session`, `auth:password_reset`,
`customers:customer_deal_person_link` and eight more. Their projections are stored under
the null tenant too. A bare NULL branch would serve every one of them to every tenant.
NULL is additionally the stamp left by an unscoped (`tenantId: undefined`) reindex, so it
means at least three different things; only the declaration distinguishes them.

The branch is narrowed further to the entity types the surrounding query can return
anyway — the batch's own types in the enricher, the requested or non-excluded types in
the strategy — so it never reaches a row the caller was not being offered.

### 2. Writer — make the sweep agree with the event path

`reindexEntity()` derives one value and routes the projection through it:

```ts
const writesGlobalProjection = !hasTenantCol && !hasOrgCol && isTenantGlobalEntityType(entityType)
const projectionTenantId = writesGlobalProjection ? null : tenantId
const projectionOrganizationId = writesGlobalProjection ? null : organizationId
```

It reaches `scopeOverrides`, the pre-sweep force purge, `purgeOrphans` and the coverage
buckets and deltas — everything that names the scope the rows are written to. It
deliberately does **not** reach `jobScope`, which records who asked for the sweep: two
tenants reindexing the catalogue must stay two job rows rather than one blocking the other
behind the active-job guard. Nor does it reach vector work (§6).

Coverage moving with the rows is not incidental. `refreshCoverageSnapshot` counts index
rows within a scope; leaving coverage under the caller's tenant while the rows went to
NULL would leave a permanent `base N / indexed 0` gap in the indexer panel.

### 3. Key — deliberately not changed

No migration. Adding `tenant_id_coalesced` to the unique key would let a global row and
a tenant-scoped row for the same record coexist, and for a declared catalogue there is no
such pair: the source table has no tenant column, so every writer resolves the same
record to the same null scope, and the existing key already holds exactly the one row
that is wanted. See *Rejected alternatives* for why widening the key does not fix the
defect on its own either.

### 4. Organization axis — selected-organization searches

`SearchService` passes the selected organization even for a superadmin, and
`TokenSearchStrategy` filtered `organization_id IN (<selected>)` while `SearchService`'s own
filter dropped every result with no organization. A canonical catalogue row has none, so a
selected-organization search returned no catalogue hit. Both filters now keep the
organization-less row for a declared type only: the strategy adds
`OR (organization_id IS NULL AND tenant_id IS NULL AND entity_type IN <declared>)`, narrowed
to the fully unscoped row, and the service keeps an organization-less result whose entity
type is declared. Every other organization-less result is still dropped.

### 5. Retiring the rows earlier sweeps stamped

A row an earlier sweep stamped with a caller's organization is a different key under
`(entity_type, entity_id, organization_id_coalesced)`, so the upsert never rewrites it and
`purgeOrphans`, scoped to the canonical row, never selects it: it survives every later
sweep, even the deletion of its source record, and is served beside the canonical row.
Nothing writes a scoped row for a declared type any more, so every one is residue. After
the canonical rows are written and orphans purged, a sweep of a declared type calls
`retireScopedCatalogueRows()` — scoped projections, then scoped tokens with no surviving
projection in their own scope — and, once per run, `deleteScopedCoverageForEntity()`.
Records the run failed to rebuild keep their old rows, as in `purgeOrphans`, and a
partitioned run retires only its own slice.

### 6. Vector work keeps the caller's scope

`query_index.vectorize_one`, the force reindex's `query_index.vectorize_purge` and
`removeOrphans` are filed under the caller's tenant and organization, as before this
change. Their consumers need a real tenant — `vector_upsert` looks a missing one up in the
source table, which has no `tenant_id` column, and returns before enqueueing;
`vector_purge` returns at once for a null tenant — and nothing defines a shared vector
across dispatch, storage and reads.

## Rejected alternatives

**Add `tenant_id_coalesced` to the unique key and let each tenant keep a copy.** It does
not deliver coverage. Only tenants that actually run a reindex would gain a row, and no
incremental write can create the others: for a table with no tenant column,
`resolveQueryIndexRecordScope()` resolves the null scope, so an edit files one row under
NULL no matter how many tenants exist. Covering N tenants would need the writer to fan
out N ways on every catalogue edit — a lot of machinery to store one document N times,
in a subsystem whose organization axis already solved the same problem by storing it
once.

**Give the readers a bare `tenant_id IS NULL` branch.** Fail-open, as above. It is worth
stating plainly because it is the shape this change most resembles: the difference
between the two is entirely the `AND entity_type IN <declared>` conjunct, and removing
it in a later refactor would silently publish thirteen private entity types.

**Ship the reader without the writer.** The reader alone is a no-op on a fresh
deployment — nothing writes a catalogue row under NULL that a sweep does not immediately
overwrite — and on an existing one it would expose whatever a previous unscoped reindex
happened to leave under NULL. The two are one change.

**Leave the organization axis alone.** An earlier revision of this spec rejected the
organization branch, on the claim that an organization-scoped caller could not reach a
catalogue record before this change either. That was wrong: the reindex API always
supplies the caller's organization, the old sweep stamped it, and token searches in that
organization found the record. Moving the projection to the null scope without the
organization branch would have removed catalogue hits from every selected-organization
search. §4 adds it.

## Testing

- `packages/search/src/__tests__/tenant-global-read-scope.test.ts` — both readers are
  asserted in one file because they are only correct together: a hit the strategy returns
  and the enricher cannot resolve is the defect. The predicate tree is recorded
  structurally, so the assertions pin the *shape* — an OR whose NULL branch is conjoined
  with an entity-type list — rather than a compiled string. Includes the organization
  branch and its negative control.
- `packages/search/src/__tests__/service.test.ts` — `SearchService` keeps an
  organization-less hit for a declared type and drops one for a private tenant-less type.
- `packages/search/src/__tests__/tenant-global-vector-dispatch.test.ts` — a declared
  reindex wired to the real `vector_upsert` / `vector_purge` subscribers; asserts the work
  they queue, not the payload.
- `packages/core/src/modules/query_index/__tests__/reindexer-tenant-global-projection.test.ts`
  — the stamp, the purge, the coverage accounting, the reset baseline, the force purge,
  the retirement (order, exclusions, partitions), the vector scope, the job scope staying
  with the caller and ordinary tenant-scoped entities being untouched.
- `packages/core/src/modules/query_index/__integration__/TC-QIDX-5723-tenant-global-catalogue.spec.ts`
  — against the real stack: starts from an organization-stamped projection with its token
  and coverage row, reindexes, then updates and deletes the source; and finds a reindexed
  catalogue record through `GET /api/search/search` with an organization selected.
- **Not vacuous.** Against the unmodified sources, 4 of 10 reader cases and 6 of 10
  writer cases fail. The remainder are deliberate negative controls (no widening for a
  private tenant-less type, the organization predicate unchanged, ordinary entities
  unchanged) and say so in their own comments.

## Changelog

### 2026-10-20

- Addressed the 2026-10-16 review on #5723: the organization axis (§4), retiring the rows
  earlier sweeps stamped (§5), vector work keeping the caller's scope (§6), telemetry for the
  column-probe failure, and an inferred expression-builder type in the presenter enricher.
  Corrected the TL;DR and the rejected alternative that claimed organization-scoped callers
  never reached catalogue records before this change.
- Merged current `develop` through #5722; the upgrade notes moved to `0.9.0 → 0.9.1`.

### 2026-08-28

- Initial version.
