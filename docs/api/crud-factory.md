# CRUD API Factory

Reusable factory for building consistent, multi-tenant safe CRUD APIs with Zod validation, DI, QueryEngine listing, optional Custom Fields integration, hooks, and event emission.

## Goals

- DRY: stop re-writing GET/POST/PUT/DELETE handlers.
- Multi-tenant safety: enforce `organizationId`/`tenantId` filtering and assignment.
- Validation with Zod: schemas co-located with entities per module.
- Extensible: lifecycle hooks before/after each operation.
- Events: emit coherent CRUD events consumable by subscribers.
- Custom Fields: seamlessly persist prefixed `cf_` inputs via custom_fields module.

## Usage

Define a `route.ts` under `src/modules/<module>/api/<path>/route.ts` and use the factory.

Example (`packages/example/.../api/todos/route.ts`):

```
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Todo } from '@open-mercato/example/modules/example/data/entities'
import { E } from '@open-mercato/example/datamodel/entities'
import { id, title, tenant_id, organization_id, is_done } from '@open-mercato/example/datamodel/entities/todo'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.string().optional().default('id'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  format: z.enum(['json','csv']).optional().default('json'),
})

const createSchema = z.object({ title: z.string().min(1), is_done: z.boolean().optional().default(false), cf_priority: z.number().int().min(1).max(5).optional() })
const updateSchema = z.object({ id: z.string().uuid(), title: z.string().min(1).optional(), is_done: z.boolean().optional() })

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireRoles: ['admin'] },
    POST: { requireAuth: true, requireRoles: ['admin','superuser'] },
    PUT: { requireAuth: true, requireRoles: ['admin'] },
    DELETE: { requireAuth: true, requireRoles: ['admin','superuser'] },
  },
  orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  events: { module: 'example', entity: 'todo', persistent: true },
  list: {
    schema: querySchema,
    entityId: E.example.todo,
    fields: [id, title, tenant_id, organization_id, is_done, 'cf:priority'],
    sortFieldMap: { id, title, is_done, cf_priority: 'cf:priority' },
    buildFilters: () => ({}),
  },
  create: {
    schema: createSchema,
    mapToEntity: (input) => ({ title: input.title, isDone: !!(input as any).is_done }),
    customFields: { enabled: true, entityId: E.example.todo, pickPrefixed: true },
  },
  update: {
    schema: updateSchema,
    applyToEntity: (entity, input) => {
      if ((input as any).title !== undefined) (entity as any).title = (input as any).title
      if ((input as any).is_done !== undefined) (entity as any).isDone = !!(input as any).is_done
    },
    customFields: { enabled: true, entityId: E.example.todo, pickPrefixed: true },
  },
  del: { idFrom: 'query', softDelete: true },
})
```

This exports `metadata` and HTTP handlers, which the modules registry auto-discovers and serves under `/api/<module>/<path>`.

## Options Overview

- orm: MikroORM entity config
  - entity: entity class
  - idField/orgField/tenantField/softDeleteField: customize property names
- list: ListConfig
  - schema: zod schema for querystring
  - entityId + fields: enable QueryEngine listing (with custom fields)
  - sortFieldMap: map UI sort keys to datamodel fields (e.g. `cf_priority -> 'cf:priority'`)
  - buildFilters(query, ctx): produce typed QueryEngine filters
  - transformItem: post-process each item
  - allowCsv + csv: enable CSV export with headers/row() + optional filename
- create: CreateConfig
  - schema: zod
  - mapToEntity: input -> entity data (org/tenant injected automatically)
  - customFields: set `{ enabled: true, entityId, pickPrefixed: true }` to map `cf_*` inputs to CF values
  - response: customize response payload (default returns `{ id }`)
- update: UpdateConfig
  - schema: zod (must include `id`)
  - applyToEntity: mutate entity instance
  - customFields: same as create
  - response: customize response
- del: DeleteConfig
  - idFrom: `query` (default) or `body`
  - softDelete: true (default) or false to hard-delete
- events: CrudEventsConfig
  - module/entity: used for event naming
  - persistent: mark emitted events as persistent (for offline replay)
  - buildPayload(action, data): optional override for emitted payloads
- hooks: lifecycle hooks (`beforeList`, `afterList`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`)

## Event Naming

The factory emits Medusa-style module events on CRUD:

- `<module>.<entity>.created`
- `<module>.<entity>.updated`
- `<module>.<entity>.deleted`

Example: `example.todo.created`

Enable persistence via `events.persistent: true` so events are persisted (local/Redis) and available for offline processing.

See also: `docs/events-and-subscribers.md` for strategy, persistence, and CLI.

## Multi-tenant Safety

- Automatically injects `organizationId` and `tenantId` on create.
- Filters update/delete by `id + organizationId + tenantId`.
- GET list via QueryEngine enforces `organizationId`/`tenantId` through its API; pass `withDeleted` in query to include soft-deleted rows.

## Custom Fields

When `customFields.enabled` is set and `entityId` is provided, the factory picks `cf_*` inputs by default (e.g., `cf_priority` -> `priority`) and persists them via the Custom Fields module.

If you need full control, supply `customFields.map(body) => Record<string, any>`.

### Reusable helpers

Use helpers from `@open-mercato/shared/lib/crud/custom-fields` to keep routes DRY and dynamic:

- `buildCustomFieldSelectorsForEntity(entityId, fieldSets)` → `{ keys, selectors, outputKeys }`
  - `selectors`: `['cf:priority', 'cf:severity', ...]` for QueryEngine `fields`
  - `outputKeys`: `['cf_priority', 'cf_severity', ...]` for CSV headers or typed output
- `extractCustomFieldsFromItem(item, keys)` → maps projections `cf:<k>`/`cf_<k>` into `{ cf_<k>: value }`
- `buildCustomFieldFiltersFromQuery({ entityId, query, em, orgId, tenantId })` → builds a `Record<string, WhereValue>` for `cf:<k>` and `cf:<k> $in` based on query keys `cf_<k>` and `cf_<k>In`. Values are coerced to the correct type from `CustomFieldDef.kind`.

Example wiring:

```
import fieldSets from '.../data/fields'
import { buildCustomFieldSelectorsForEntity, extractCustomFieldsFromItem, buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'

const cf = buildCustomFieldSelectorsForEntity(E.example.todo, fieldSets)

makeCrudRoute({
  list: {
    fields: [id, title, ...cf.selectors],
    sortFieldMap: { id, title, ...Object.fromEntries(cf.keys.map(k => [`cf_${k}`, `cf:${k}`])) },
    buildFilters: async (q, ctx) => ({
      ...(await buildCustomFieldFiltersFromQuery({ entityId: E.example.todo, query: q, em: ctx.container.resolve('em'), orgId: ctx.auth.orgId, tenantId: ctx.auth.tenantId }))
    }),
    transformItem: (item) => ({ id: item.id, title: item.title, ...extractCustomFieldsFromItem(item as any, cf.keys) }),
    csv: {
      headers: ['id','title', ...cf.outputKeys],
      row: (t) => [t.id, t.title, ...cf.outputKeys.map(k => String((t as any)[k] ?? ''))],
    }
  }
})
```

## Hooks

Hooks receive the DI container and auth context so you can resolve services and inject custom logic.

Examples:

```
hooks: {
  beforeCreate: async (input, { container, auth }) => {
    const svc = container.resolve('someService')
    await svc.enforceBusinessRule(input, auth)
  },
  afterUpdate: async (entity) => { /* ... */ },
}
```
