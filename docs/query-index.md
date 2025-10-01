# JSONB Indexing Layer (Hybrid)

Goal: make querying base entities together with custom fields fast and simple by maintaining a flat, query-friendly JSONB index per entity record, without breaking module isomorphism or schema agility.

What you get
- Hybrid engine: uses a JSONB-backed index when available; falls back to the join-based engine otherwise.
- Event-driven updates: created/updated/deleted events keep the index synced. Custom-field updates also trigger reindex via the DataEngine write layer.
- Zero-churn evolution: new fields (base or custom) are available immediately in the JSON document; promote hot fields later if needed.

Storage
- Table: `entity_indexes`
  - `id uuid` (PK)
  - `entity_type text` e.g., `example:todo`
  - `entity_id text` base record id as text
  - `organization_id uuid null`, `tenant_id uuid null`
  - `doc jsonb` flattened document of base fields + `cf:<key>` values
  - `index_version int` (default 1), `created_at`, `updated_at`, `deleted_at`
  - `organization_id_coalesced uuid generated always as (coalesce(organization_id, '00000000-0000-0000-0000-000000000000')) stored`
- Indexes
  - `gin(doc jsonb_path_ops)` for JSONB containment/path queries
  - Unique: `unique(entity_type, entity_id, organization_id_coalesced)`

Document shape
- Base fields are stored under their snake_case DB names.
- Custom fields are stored as `cf:<key>` values.
- Arrays are preserved as arrays; singletons are scalars.

Indexer
- Build: merges base row with custom field values into a single plain object.
- Upsert: inserts or updates the JSONB row keyed by `(entity_type, entity_id, organization_id_coalesced)`.
- Delete: sets `deleted_at` on logical delete.

Events and consistency
- Subscribers are registered for all entities that have custom field definitions:
  - `<module>.<entity>.created|updated` → upsert index row.
  - `<module>.<entity>.deleted` → mark index row deleted.
- Custom-field writes done via the DataEngine emit `<module>.<entity>.updated` as well, reusing the same subscriber path.

Query routing
- The `HybridQueryEngine` prefers the JSONB index when rows exist for the target entity; otherwise it falls back to the basic engine.
- Supported in index path:
  - Filters: base fields and `cf:*` via JSON path extraction and casting for common types.
  - Sorting: base fields and `cf:*` using casted expressions when possible.
  - Paging and multi-tenant scoping (`organization_id`, `tenant_id`) and soft-delete exclusion by default.

Backfill
- CLI: `mercato query_index rebuild` reindexes existing rows.
  - All orgs/tenants: `mercato query_index rebuild --entity example:todo --global`
  - Scoped: `mercato query_index rebuild --entity example:todo --org <orgId> --tenant <tenantId>`
  - Options: `--withDeleted` `--limit <n>` `--offset <n>`

Performance tips
- Start with `gin(doc jsonb_path_ops)`.
- Add expression indexes for hot JSON paths (filters/sorts) before promoting to typed columns:
  - Example: `create index on entity_indexes (((doc->>'cf:priority')::int));`
- Consider typed columns only for extreme hotspots.

Limitations and notes
- The index row appears after create/update events or backfill. Queries still work via fallback when the index is missing.
- Cross-module relations remain by foreign key id only; no cross-module joins.

Related files
- `packages/core/src/modules/query_index/data/entities.ts`
- `packages/core/src/modules/query_index/lib/indexer.ts`
- `packages/core/src/modules/query_index/lib/engine.ts`
- `packages/core/src/modules/query_index/di.ts`
- `packages/core/src/modules/query_index/migrations/Migration20251001120000.ts`
- `packages/core/src/modules/query_index/migrations/Migration20251001123000.ts`

