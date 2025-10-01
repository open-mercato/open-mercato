# Unified Query Layer

The query layer provides a consistent API to fetch data across base entities, module extensions, and custom fields. It is available via DI as `queryEngine`.

When the optional hybrid JSONB index is enabled and populated for a given entity, queries are routed through the index automatically; otherwise the engine falls back to a join-based plan. See `docs/query-index.md` for the index design, backfill CLI, and performance tips.

## Why
- Build generic list/detail APIs and UI that work for any entity.
- Centralize filtering, pagination, sorting, and selected fields.
- Safely join module-defined extensions and EAV custom fields.

## Usage (DI)

```ts
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { E } from '@open-mercato/core/datamodel/entities'
import { id, email, name } from '@open-mercato/core/datamodel/entities/user'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'

export async function listUsers(container: AppContainer) {
  const query = container.resolve<QueryEngine>('queryEngine')
  return await query.query(E.auth.user, {
    fields: [id, email, name, 'cf:vip'],
    includeExtensions: true, // joins registered extensions
    includeCustomFields: true, // auto-discovers keys via custom_field_defs
    // Filters: array syntax (legacy)
    filters: [
      { field: 'cf:vip', op: 'eq', value: true },
      { field: email, op: 'ilike', value: '%@acme.com' },
    ],
    sort: [{ field: email, dir: SortDir.Asc }],
    page: { page: 1, pageSize: 25 },
    tenantId: 'uuid-string-here',
    // organizationId optional; when provided, both are applied
    organizationId: 'uuid-string-here',
  })
}
```

## Model
- `entity`: an `EntityId` string of the form `<module>:<entity>`; used to resolve the base table and registered extensions.
- `fields`: base columns and/or custom fields prefixed as `cf:<key>`. Prefer importing base columns from `@open-mercato/<pkg>/datamodel/entities/<entity>` (e.g., `import { id, email } from '@open-mercato/core/datamodel/entities/user'`).
- `includeExtensions`: `true` to include all linked extension entities; or `string[]` of extension entity ids.
- `includeCustomFields`: `true` to include all CFs; or `string[]` of keys.
- `filters`: support base fields and `cf:<key>`.
  - Array syntax: `{ field, op, value }`.
  - Object syntax (Mongo/Medusa style):
    ```ts
    filters: {
      title: { $ne: null },
      email: { $ilike: '%@acme.com' },
      'cf:vip': true, // shorthand for $eq
    }
    ```
  - Aliases: for filters, you may also use `cf_<key>` (e.g., `cf_priority`), which is treated the same as `cf:<key>`.
  - Both syntaxes can be mixed, the engine normalizes them internally.
- `sort`: base fields and `cf:<key>`. Use generated field constants and `SortDir` (e.g., `{ field: email, dir: SortDir.Asc }`).
- `page`: paging options.
- `tenantId`: primary scoping for multi-tenant.
- `organizationId`: optional; if provided, combined with `tenantId`.
- `withDeleted`: include soft-deleted rows when `true`. By default, when a base table has a `deleted_at` column, queries exclude rows where `deleted_at` is not null.

## Typing filters

You can get compile-time help for `filters` by using the generic `Where` type from `@open-mercato/shared/lib/query/types`:

```ts
import type { Where } from '@open-mercato/shared/lib/query/types'

// Define a field→type map for your query
type UserFields = {
  id: string
  email: string
  name: string | null
  created_at: Date
  'cf:vip': boolean
}

const filters: Where<UserFields> = {
  email: { $ilike: '%@acme.com' },
  name: { $ne: null },
  'cf:vip': true,
}

await query.query(E.auth.user, { filters })
```

If you don’t provide the generic, `filters` falls back to a permissive shape.

## Implementation notes
- Default implementation `BasicQueryEngine` supports base-table filters/sort/paging and now projects cf:* fields and honors filters on them (array or object syntax). It applies `tenant_id` conditions when present, and `organization_id` conditions optionally; both are combined when provided. When the base table exposes `deleted_at`, rows with a non-null value are excluded unless `withDeleted: true` is passed.
- When we iterate:
  - Read `modules.generated.ts` to discover `entityExtensions` and join them.
  - Join `custom_field_values` to surface `cf:*` fields and filter/sort them efficiently; aggregate when multiple values exist.
  - Provide per-entity adapters if conventions differ from table naming.
