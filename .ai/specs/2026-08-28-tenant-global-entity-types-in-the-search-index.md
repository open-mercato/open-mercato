# Tenant-global entity types in the search index

## TL;DR

A platform-wide catalogue whose source table has neither a `tenant_id` nor an
`organization_id` column gets exactly **one** row in `entity_indexes`, because the
unique key is `(entity_type, entity_id, organization_id_coalesced)`. The incremental
writer already files that row under `tenant_id = NULL` — `resolveQueryIndexRecordScope()`
calls the shape `global` and requires an explicitly null scope for it — but neither
reader has a NULL branch on the tenant axis, so the row is invisible to everyone. The
sweep writer disagreed with the incremental one and stamped the caller's tenant, which
made the catalogue visible to exactly one tenant: whichever reindexed last. Every other
tenant got a search hit with no presenter, which the dialog renders as a raw record id.

This aligns the two writers on `tenant_id = NULL` for entity types declared through
`registerTenantGlobalEntityTypes()`, and gives both readers the matching NULL branch —
gated on that declaration, never on the NULL alone.

## Overview

- **Changed**: `packages/core/src/modules/query_index/lib/reindexer.ts` — the projection
  scope of a declared catalogue is `null` rather than the caller's tenant
- **Changed**: `packages/search/src/lib/presenter-enricher.ts` — `fetchDocsBatch()` gains
  the tenant NULL branch
- **Changed**: `packages/search/src/strategies/token.strategy.ts` — `search()` gains the
  same branch
- **Not touched**: the `entity_indexes` unique constraint (no migration — see
  *Rejected alternatives*), `tenant-global.ts` itself, the incremental write path,
  `resolveQueryIndexRecordScope()`, the organization axis of either reader,
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
const writesGlobalProjection = !hasTenantCol && isTenantGlobalEntityType(entityType)
const projectionTenantId = writesGlobalProjection ? null : tenantId
```

It reaches `scopeOverrides`, the pre-sweep force purge, `purgeOrphans`,
`vectorService.removeOrphans`, the coverage buckets and deltas, and the
`query_index.vectorize_one` / `vectorize_purge` payloads — everything that names the
scope the rows are written to. It deliberately does **not** reach `jobScope`, which
records who asked for the sweep: two tenants reindexing the catalogue must stay two job
rows rather than one blocking the other behind the active-job guard.

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

**Give `TokenSearchStrategy` an organization NULL branch as well.** Out of scope, and
flagged rather than done. Catalogue token rows carry `organization_id = NULL` and the
strategy filters `organization_id IN (...)` with no NULL branch, so an organization-scoped
caller never reaches them — before or after this change. Only callers whose scope resolves
to "all organizations" (a super-admin, or an unrestricted role with the all-organizations
selection) see catalogue results at all, and they are exactly the callers who see the raw
UUID today. Widening the organization axis would change *who* can see a catalogue record,
which is a visibility decision on its own evidence, not part of a scope-correctness fix.

## Testing

- `packages/search/src/__tests__/tenant-global-read-scope.test.ts` — 10 cases. Both
  readers are asserted in one file because they are only correct together: a hit the
  strategy returns and the enricher cannot resolve is the defect. The predicate tree is
  recorded structurally, so the assertions pin the *shape* — an OR whose NULL branch is
  conjoined with an entity-type list — rather than a compiled string.
- `packages/core/src/modules/query_index/__tests__/reindexer-tenant-global-projection.test.ts`
  — 10 cases: the stamp, the purge, the coverage accounting, the reset baseline, the
  force purge, plus the job scope staying with the caller and ordinary tenant-scoped
  entities being untouched.
- **Not vacuous.** Against the unmodified sources, 4 of 10 reader cases and 6 of 10
  writer cases fail. The remainder are deliberate negative controls (no widening for a
  private tenant-less type, the organization predicate unchanged, ordinary entities
  unchanged) and say so in their own comments.
