# Tenant-scoped reindex of a table with no `tenant_id` column

## TL;DR

`reindexEntity()` drops the tenant predicate when the source table has no
`tenant_id` column, but stamps every swept row with the caller's tenant anyway.
A tenant-scoped reindex of a tenant-less table therefore reads every tenant's
rows and files them under whichever tenant ran it, and both index readers then
serve them as that tenant's own. The reindexer now refuses that combination and
returns an empty result with a warning. A one-entry allowlist —
`feature_toggles:feature_toggle`, extendable by modules through
`registerTenantGlobalEntityTypes()` — covers the tables that are genuinely one
platform-wide catalogue.

## Overview

- **Added**: `packages/core/src/modules/query_index/lib/tenant-global.ts`
- **Changed**: `packages/core/src/modules/query_index/lib/reindexer.ts` — one guard,
  placed immediately after the column set is resolved and before any job, coverage
  or purge write happens
- **Not touched**: `applyBaseWhere()` itself, `scopeOverrides`, the incremental
  (event-driven) indexing path, the readers in `@open-mercato/search`, the
  `entity_indexes` unique constraint

## Problem Statement

`applyBaseWhere()` applies the tenant predicate only when the source table
actually has the column:

```ts
if (tenantId !== undefined && hasTenantCol) {
  chain = ... chain.where('b.tenant_id', '=', tenantId)
}
```

When `hasTenantCol` is false the predicate the caller asked for is dropped, with
no warning and no error. Further down, nothing else is conditional:

```ts
if (tenantId !== undefined && tenantId !== null) scopeOverrides.tenantId = String(tenantId)
```

so every row the now-unscoped sweep returns is stamped with the caller's tenant.
The two failures compound: the sweep READS every tenant's rows, and then FILES
them under whichever tenant happened to run the reindex.

Nothing downstream corrects it, because both readers ask for an exact tenant
match with no NULL branch:

- `TokenSearchStrategy.search()` — `packages/search/src/strategies/token.strategy.ts`,
  `.where('tenant_id', '=', options.tenantId)`
- `createPresenterEnricher()`'s `fetchDocsBatch()` —
  `packages/search/src/lib/presenter-enricher.ts`, `.where('tenant_id', '=', tenantId)`

The enricher does have `organization_id = X OR organization_id IS NULL`. There is
no tenant counterpart anywhere, which matters twice over: it is why the wrongly
filed rows are readable by the wrong tenant, and it is why the obvious fix does
not work (below).

**This is reachable today.** Fourteen entity types in this repository resolve to
a table with no `tenant_id` column. Thirteen of them are private rows —
`directory:tenant` (one row per tenant, with `name` tokenised into
`search_tokens`), `auth:user_role`, `auth:session`, `auth:password_reset`,
`customers:customer_deal_person_link`, `customer_accounts:customer_user_role`,
`messages:message_recipient`, `messages:message_object`,
`messages:message_access_token` and the rest of that shape. It was found by
auditing a production deployment's `entity_indexes`, where a tenant-scoped bulk
reindex had filed nearly every row of several of these types under a tenant they
do not belong to, spread across several other tenants' data.

Two of the affected types produce **zero** tokens (their documents are `id` /
`user_id` / `role_id` / timestamps, every one of which the token field policy
rejects by name), so they leak through `entity_indexes` only — which is exactly
why a field-level or token-level fix does not close this.

## The Fix

Refuse the sweep, immediately after the column set is resolved:

```ts
if (!hasTenantCol && tenantId != null && !isTenantGlobalEntityType(entityType)) → return empty
```

The condition is **derived, not enumerated**: it is exactly the set of inputs
where a predicate is dropped AND an override is stamped. Two consequences worth
stating explicitly:

- A `tenantId` of `undefined` or `null` sets no override, so those rows land
  under `tenant_id = NULL` — invisible to both readers, but filed under nobody.
  Nothing crosses a tenant boundary, so there is nothing to refuse, and the case
  is deliberately left alone.
- A tenant-less entity type introduced by a later release fails closed on
  arrival, with nobody having edited a list.

The refusal is placed **before** `prepareJob()`, `refreshCoverageSnapshot()` and
`purgeOrphans()`, so a refused reindex writes nothing at all: no job row, no
coverage row, and therefore no permanent `base N / indexed 0` gap on the indexer
status page.

It returns an empty `ReindexJobResult` rather than throwing, matching the two
refusals already in this function (unregistered entity type, `search_tokens`).

## The allowlist, and why it is a registration seam

Some tables have no `tenant_id` column *because* the rows are one platform-wide
catalogue every tenant is meant to read. For those, sweeping the whole table and
stamping the caller's tenant is the intended behaviour — and, given the readers
above, it is the only thing that makes them findable at all.

In this repository that is exactly one entity type,
`feature_toggles:feature_toggle` (the per-tenant value lives in
`feature_toggle_overrides`, which does have `tenant_id`). One hardcoded string is
plainly not an ecosystem-wide answer: modules that ship as their own package, and
apps with their own catalogue tables, have the same legitimate need and cannot be
listed inside `@open-mercato/core`. So the allowlist is a small registry seeded
with this package's own entry and extendable by anyone:

```ts
registerTenantGlobalEntityTypes('billing:plan')
```

Forgetting the call is safe in the only direction that matters — the entity type
keeps failing closed, and the warning names it, so the missing declaration is
diagnosable from the log rather than from a cross-tenant search result.

The bar for admitting an entity type is **"is every tenant MEANT to read every
row"**, not "a reindex started refusing it".

## Rejected alternatives

**Index tenant-less tables under `tenant_id = NULL`.** The obvious fix, and it
fails: neither reader has a NULL branch for tenant, so this silently removes
genuinely global reference data from search.

**Teach the readers that NULL means global.** It overloads a value that today
also means "written by an unscoped reindex", so every mis-scoped NULL row would
become globally visible — fail-open, in a fix whose entire value is failing
closed.

**Denylist the leaking entity types.** It works, and it is silently wrong about
the next tenant-less entity type somebody adds. The discriminating fact is a
column's absence, which the reindexer already computes; a rule beats a list here.

**Give the tables a nullable `tenant_id`.** A schema change per table, and it
does not remove the hazard for the next table that arrives without one — the
guard is what makes that case safe. (Note that `module_configs` and
`attachment_partitions` did take this route independently and so are no longer in
scope for the guard at all.)

## Migration & Backward Compatibility

| Surface | Change | Classification |
|---------|--------|----------------|
| Function signatures | New exports `registerTenantGlobalEntityTypes`, `isTenantGlobalEntityType`, `listTenantGlobalEntityTypes`, `resetTenantGlobalEntityTypes` on `@open-mercato/core/modules/query_index/lib/tenant-global` | ✓ ADDITIVE (new module, new functions) |
| Function signatures | `reindexEntity(em, options)` — signature and return type unchanged | ✓ No change |
| `reindexEntity` behaviour | A tenant-scoped reindex of a table with no `tenant_id` column now returns an empty result instead of indexing every tenant's rows under the caller's tenant | ⚠ Deliberate behaviour change; see below |
| Import paths, event IDs, API routes, DB schema, DI names, ACL features, notification IDs, CLI commands, generated files | No change | ✓ n/a |

**Nothing is removed or renamed**, so the deprecation protocol's steps 1–3 have
nothing to stage and the Emergency Security Exception is not invoked. The changed
behaviour is not a contract surface being withdrawn: it is the same function
declining an input whose only possible outcome was a cross-tenant write. Keeping
the old behaviour behind a flag was considered and rejected for the reason the
exception itself gives — a retained vulnerable branch is the bridge that must not
be built.

**For module and app authors.** If a reindex of one of your entity types starts
returning 0 and logging *"Refusing tenant-scoped reindex of a table with no
tenant_id column"*, exactly one of two things is true:

1. The table holds per-tenant rows and is missing its `tenant_id` column. The
   index was cross-tenant before this release; add the column, or index the
   entity through the event path only.
2. The table is a platform-wide catalogue. Call
   `registerTenantGlobalEntityTypes('<module>:<entity>')` during module
   registration (a module's `di.ts` is the usual place), before any reindex job
   runs.

**Existing index rows are not touched.** Rows written by an earlier reindex keep
their wrong tenant stamp until something rewrites or deletes them; this change
only stops new ones being created. An operator upgrading a deployment that has
run a tenant-scoped reindex of a tenant-less entity type should delete the
`entity_indexes` and `search_tokens` rows for those entity types, and let the
event path refile the ones that still matter.

## Deliberately out of scope

- **`purgeOrphans()` no longer runs for refused entity types**, so a deleted
  source row leaves its projection behind until the delete subscriber removes it.
  A known, small cost of refusing a sweep that cannot be scoped.
- **The incremental path is untouched, and never had this defect.**
  `resolveQueryIndexRecordScope()` reads the scope from the source row and throws
  when an event payload disagrees with it; a table with neither scope column is
  `kind: 'global'` and is required to carry an explicitly null tenant. So the
  event path cannot file a tenant-less row under a caller's tenant, and refusing
  the sweep does not make these entity types unindexable — it leaves the event
  path as their only writer, which is the one that was already correct.

  That does surface an existing inconsistency this change deliberately does not
  resolve: the event path calls a table with neither column `global` and files it
  under `tenant_id = NULL`, where the readers cannot see it, while a tenant-scoped
  reindex of the same table files it under a real tenant, where they can. For
  `feature_toggles:feature_toggle` the two writers therefore disagree about where
  the row belongs. Worth a follow-up; it is a question about what NULL means to
  the readers, not about the guard.
- **`entity_indexes_entity_unique (entity_type, entity_id)`** allows a
  tenant-less row exactly ONE tenant stamp, so a genuinely global catalogue row
  resolves its presenter for one arbitrary tenant while other tenants get a
  search hit whose presenter lookup misses. `search_tokens` carries no such
  constraint, which is why the two disagree. Real, separate, and a schema change
  rather than a guard.

## Testing

`packages/core/src/modules/query_index/__tests__/reindexer-tenant-scope-guard.test.ts`
drives the real `reindexEntity()` against a Kysely stub that answers the
`information_schema.columns` probe and throws for every other table, so a refusal
can assert that the source table was never read and no job row was written.

- Refusal: `auth:user_role`, `directory:tenant`,
  `customers:customer_deal_person_link`, `messages:message_recipient`,
  `customer_accounts:customer_user_role`, and an unclassified future entity type.
- Positive controls: `feature_toggles:feature_toggle`, a module-registered entity
  type, an ordinary tenant-scoped entity, and the `null` / `undefined` tenant
  cases.
- The ordinary-entity control is what stops the suite passing vacuously:
  `getColumnSet()` swallows exceptions and returns an empty set, which would make
  every case look tenant-less.

Measured: 20 pass with the fix; with the guard disabled, the 6 refusal cases fail
and the 14 baselines pass, which is what they are for.

One pre-existing suite needed a stub correction rather than a behaviour change:
`reindexer-partial-write.test.ts` reindexes `example:todo` with a tenant while its
fake `information_schema.columns` returns no rows at all. `todos` does carry
`tenant_id` and `organization_id`, so the probe now answers with the real shape.
