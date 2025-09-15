# Unified Query Layer

The query layer provides a consistent API to fetch data across base entities, module extensions, and custom fields. It is available via DI as `queryEngine`.

## Why
- Build generic list/detail APIs and UI that work for any entity.
- Centralize filtering, pagination, sorting, and selected fields.
- Safely join module-defined extensions and EAV custom fields.

## Usage (DI)

```ts
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export async function listUsers(container: AppContainer) {
  const query = container.resolve('queryEngine') as import('@open-mercato/shared/lib/query/types').QueryEngine
  return await query.query('auth:user', {
    fields: ['id','email','name','cf:vip'],
    includeExtensions: true,
    includeCustomFields: ['vip','industry'], // explicit cf keys currently supported
    filters: [
      { field: 'cf:vip', op: 'eq', value: true },
      { field: 'email', op: 'ilike', value: '%@acme.com' },
    ],
    sort: [{ field: 'email', dir: 'asc' }],
    page: { page: 1, pageSize: 25 },
    organizationId: 1,
  })
}
```

## Model
- `entity`: an `EntityId` string of the form `<module>:<entity>`; used to resolve the base table and registered extensions.
- `fields`: base columns and/or custom fields prefixed as `cf:<key>`.
- `includeExtensions`: `true` to include all linked extension entities; or `string[]` of extension entity ids.
- `includeCustomFields`: `true` to include all CFs; or `string[]` of keys.
- `filters`: support base fields and `cf:<key>`.
- `sort`: base fields initially; extended to `cf:<key>` as we iterate.
- `page`: paging options.
- `organizationId`: scoping for multi-tenant.

## Implementation notes
- Default implementation `BasicQueryEngine` supports base-table filters/sort/paging and now projects cf:* fields and honors filters on them for explicitly requested keys.
- When we iterate:
  - Read `modules.generated.ts` to discover `entityExtensions` and plan joins.
  - Join `custom_field_values` to surface `cf:*` fields and filter by them efficiently (indexes included).
  - Provide per-entity adapters if conventions differ from table naming.
