# Query Index — per-entity projection switch

**Date:** 2026-09-22
**Status:** Implemented
**Scope:** `packages/core/src/modules/query_index`, `packages/shared/src/modules`, `packages/cli` generators

## TLDR

`queryIndex.entities` lets a module — or an app, from `modules.ts`, without a fork — declare that an
entity type is **not** projected into `entity_indexes`. Every write path honours it, so the entity
type holds zero rows, and the query engine answers it from its base tables as *not indexed* rather
than *partially covered*. The default is unchanged: declare nothing and every entity type is
projected exactly as it is today.

## Problem statement

Indexing is opt-in **per write path**, never per entity. A CRUD command's `indexer: { entityType }`,
the DataEngine and the CRUD bridge each write a row; nothing consults the read side. An entity
therefore earns a row because someone wrote a create command for it, not because any screen reads it
through the index — and there is no declaration, env var or override domain that can say otherwise.

The cost is not theoretical. On one production deployment `entity_indexes` held 25.2M rows / 31.5 GB
of stored bytes, of which **22.1M rows (87%) and 21.6 GB (69%) belonged to nine entity types no query
ever reached through the index**: four served plain CRUD list routes that declare no searchable field
and carry no custom-field definition, five were named by no list route at all. Those rows are not
merely idle. They dilute the entity types that *are* read: the rows a cold search rechecks sit
one-in-eight through the heap, so almost every random page read pulls 8 KB for one live row.

Apps that hit this today work around it by filtering `query_index.upsert_one` through
`overrides.events.subscribers` and patching whichever bulk-flush path bypasses the subscriber. That
is a workaround for a missing declaration: it is invisible to the read side, so the engine still
believes the entity type is indexed, and it has to be re-derived for every new write path.

## Proposed solution

### Config surface

One declaration, two places to set it — mirroring how `vector.ts`, `setup.ts` and `encryption.ts`
already work, with `overrides.*` as the app-side escape hatch.

A **module** declares it for its own entities in `query-index.ts` at the module root, discovered by
the module-registry generator into `Module.queryIndex`:

```ts
// src/modules/sales/query-index.ts
import type { QueryIndexModuleConfig } from '@open-mercato/shared/modules/query-index'

const config: QueryIndexModuleConfig = {
  entities: [{ entityId: 'sales:sales_order_line', project: false }],
}
export default config
```

An **app** overrides any module's declaration — including a core module's — through the new
`queryIndex` unified-override domain. `null` is the shorthand for `{ project: false }`, consistent
with "`null` disables" across the other domains:

```ts
// apps/<app>/src/modules.ts
{ id: 'sales', overrides: { queryIndex: { entities: { 'sales:sales_order_line': null } } } }
```

Resolution order is module declarations first, app overrides last, everything else projected. An
unknown entity type is projected, so an app that declares nothing is unaffected.

**Alternatives considered.** An `indexable: false` flag on the ORM entity declaration would put the
switch where the entity is defined, but entity ids come from decorated MikroORM classes with no
metadata registry to carry it, and an app could not stop a core entity without forking the module
that owns it. A plain env allowlist (`OM_QUERY_INDEX_EXCLUDED_ENTITY_TYPES`) would match the module's
existing config style but is invisible to module authors and untyped.

### Write paths

The switch is enforced at each choke point rather than at one, so a caller that reaches a lower layer
directly cannot bypass it:

| Path | Guard |
| --- | --- |
| `query_index.upsert_one` subscriber | Returns before the scope lookup, the row write **and** the coverage adjustment |
| CRUD bridge (`query_index/di.ts`) | Returns before resolving the record scope; never emits the event |
| `upsertIndexRow` | Reports `{ existed: false, created: false, … }` — a no-op, not a delete |
| `upsertIndexBatch` | Returns `attempted: 0`, which `assertIndexBatchWritesLanded` reads as "nothing asked for" rather than "rows lost" |
| `reindexEntity` (the `query_index.reindex` event and the CLI) | Logs and returns an empty result |
| `mercato query_index reindex` / `rebuild-all` with no `--entity` | The candidate list is filtered, so a whole-account run cannot refill a stopped type |
| `mercato query_index reindex` / `rebuild --entity <stopped>` | Refuses with an operator-readable message |
| `query_index.coverage.warmup` / `.refresh` | No snapshot is written |
| `query_index.delete_one` | **Deliberately unfiltered** — a row written before the switch was set cleans itself up |

### Coverage semantics

Zero rows is safe; half is not. With `FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES=true` a partially-filled
entity type is read *through* the index as though it were complete, so unindexed rows vanish from
filtered results and from the total count with no error. A stopped entity type must therefore read as
*not indexed*, which is a different answer from *partially indexed*:

- `HybridQueryEngine.indexAnyRows()` returns `false` for a stopped entity type **before** probing
  `entity_index_coverage` or `entity_indexes`. The query takes the existing `no_index_rows` fallback
  and answers from the base tables. Short-circuiting ahead of the probes is what makes a stray row
  surviving from before the switch harmless rather than a trigger for the forced-index path.
- `resolveCoverageGap()` returns `null` for a stopped entity type, which also covers the two places
  that reach a coverage decision for an entity *other* than the one being queried: the
  `customFieldSources` loop and the global-scope check.

## Risks & impact review

- **Backward compatibility:** additive. `Module.queryIndex`, the `queryIndex` override domain and
  `query-index.ts` are all optional; with none of them present `isEntityTypeProjected()` returns
  `true` for every entity type and no code path changes behaviour.
- **Switching a type off does not delete its existing rows.** That is a data migration, and whose it
  is depends on the deployment — `mercato query_index purge --entity <module:entity>` followed by a
  `VACUUM (FULL, ANALYZE)` if the space matters. Until then the rows sit unread; the engine already
  answers the type from the base tables.
- **A relation custom field pointing at a stopped entity type** reads it through an empty index —
  correctly, via the `indexAnyRows` fallback, but from the base table. Worth checking before
  stopping a type that `GET /api/entities/relations/options` can reach.
- **Not in scope:** which *fields* of a projected entity earn an index. That is the declarative index
  contract proposed separately in the list-views-at-scale RFC.

## Changelog

- 2026-09-22 — Initial specification and implementation.
