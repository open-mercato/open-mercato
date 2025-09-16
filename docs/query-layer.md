# Unified Query Layer

The query layer provides a consistent API to fetch data across base entities, module extensions, and custom fields. It is available via DI as `queryEngine`.

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
    filters: [
      { field: 'cf:vip', op: 'eq', value: true },
      { field: email, op: 'ilike', value: '%@acme.com' },
    ],
    sort: [{ field: email, dir: SortDir.Asc }],
    page: { page: 1, pageSize: 25 },
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
- `sort`: base fields and `cf:<key>`. Use generated field constants and `SortDir` (e.g., `{ field: email, dir: SortDir.Asc }`).
- `page`: paging options.
- `organizationId`: scoping for multi-tenant.

## Implementation notes
- Default implementation `BasicQueryEngine` supports base-table filters/sort/paging and now projects cf:* fields and honors filters on them for explicitly requested keys.
- When we iterate:
  - Read `modules.generated.ts` to discover `entityExtensions` and join them.
  - Join `custom_field_values` to surface `cf:*` fields and filter/sort them efficiently; aggregate when multiple values exist.
  - Provide per-entity adapters if conventions differ from table naming.
