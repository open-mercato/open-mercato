# Core Package — Standalone Developer Guide

`@open-mercato/core` contains all built-in business modules. This guide covers module development patterns for standalone apps that build on top of these modules.

## Auto-Discovery Paths

Place files in your module directory (`src/modules/<module>/`) — the framework discovers them automatically:

| Path Pattern | Becomes |
|---|---|
| `frontend/<path>.tsx` | `/<path>` (public page) |
| `backend/<path>.tsx` | `/backend/<path>` (admin page) |
| `backend/page.tsx` | `/backend/<module>` (module root page) |
| `api/<method>/<path>.ts` | `/api/<path>` dispatched by HTTP method |
| `subscribers/*.ts` | Event subscriber (export `metadata` + default handler) |
| `workers/*.ts` | Background worker (export `metadata` + default handler) |

Run `yarn generate` after adding any auto-discovered file.

## Module Files Reference

| File | Export | Purpose |
|------|--------|---------|
| `index.ts` | `metadata` | Module metadata |
| `di.ts` | `register(container)` | DI registrations (Awilix) |
| `acl.ts` | `features` | Permission features: `['mod.view', 'mod.create', ...]` |
| `setup.ts` | `setup: ModuleSetupConfig` | Tenant init, role features, seed data |
| `ce.ts` | `entities` | Custom entities / custom field sets |
| `events.ts` | `eventsConfig` | Typed event declarations |
| `search.ts` | `searchConfig` | Search indexing config |
| `translations.ts` | `translatableFields` | Translatable fields per entity |
| `notifications.ts` | `notificationTypes` | Notification type definitions |
| `notifications.client.ts` | — | Client-side notification renderers |
| `notifications.handlers.ts` | `notificationHandlers` | Reactive notification side-effects |
| `data/entities.ts` | — | MikroORM entity classes |
| `data/validators.ts` | — | Zod validation schemas |
| `data/extensions.ts` | `extensions` | Entity extensions (cross-module links) |
| `data/enrichers.ts` | `enrichers` | Response enrichers |
| `api/interceptors.ts` | `interceptors` | API route interception hooks |
| `widgets/injection/` | — | Injected UI widgets |
| `widgets/injection-table.ts` | — | Widget-to-slot mappings |
| `widgets/components.ts` | `componentOverrides` | Component replacement/wrapper definitions |

## API Routes

Every API route file MUST export an `openApi` object:

```typescript
import { createCrudOpenApiFactory } from '@open-mercato/shared/lib/openapi/crud'
const buildOpenApi = createCrudOpenApiFactory({ defaultTag: 'MyModule' })

export const openApi = buildOpenApi({
  resourceName: 'Item',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createSchema, description: 'Create item' },
  update: { schema: updateSchema, responseSchema: okSchema },
  del: { schema: deleteSchema, responseSchema: okSchema },
})
```

### CRUD Routes with makeCrudRoute

Always set `indexer: { entityType }` for query index coverage:

```typescript
makeCrudRoute({
  entity: MyEntity,
  indexer: { entityType: 'my_module:my_entity' },
  enrichers: { entityId: 'my_module.my_entity' }, // opt-in to enrichers
  // ...
})
```

### Custom Write Routes

For non-CRUD write routes (`POST`/`PUT`/`PATCH`/`DELETE`), MUST wire mutation guards:
- Call `validateCrudMutationGuard` before mutation
- Call `runCrudMutationGuardAfterSuccess` after successful mutation

## Module Setup (`setup.ts`)

Required for tenant initialization:

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['my_module.admin_only'],
    admin: ['my_module.*'],
    employee: ['my_module.view'],
  },
  async onTenantCreated({ em, tenantId, organizationId }) { /* settings, sequences */ },
  async seedDefaults({ em, tenantId, container }) { /* dictionaries, statuses */ },
  async seedExamples({ em, tenantId, container }) { /* demo data */ },
}
```

## Events

Declare events in the emitting module's `events.ts`:

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'
const events = [
  { id: 'my_mod.item.created', label: 'Item Created', entity: 'item', category: 'crud' },
  { id: 'my_mod.item.updated', label: 'Item Updated', entity: 'item', category: 'crud' },
  { id: 'my_mod.item.deleted', label: 'Item Deleted', entity: 'item', category: 'crud' },
] as const
export const eventsConfig = createModuleEvents({ moduleId: 'my_mod', events })
export const emitMyModEvent = eventsConfig.emit
```

MUST use `as const` for type safety. Run `yarn generate` after adding.

### Subscribers

```typescript
// subscribers/item-created-notify.ts
export const metadata = { event: 'my_mod.item.created', persistent: true, id: 'item-created-notify' }
export default async function handler(payload, ctx) { /* one side effect per subscriber */ }
```

## Widget Injection

The preferred way to extend other modules' UI without direct coupling.

### Structure
- Widgets: `widgets/injection/<WidgetName>/widget.tsx` (or `widget.ts` for headless)
- Mapping: `widgets/injection-table.ts`

### Spot IDs
- `crud-form:<entityId>` — inject into forms
- `crud-form:<entityId>:fields` — inject form fields
- `data-table:<tableId>:columns|row-actions|bulk-actions|filters` — inject into tables
- `menu:sidebar:main|settings|profile` — sidebar menu items
- `menu:topbar:profile-dropdown|actions` — topbar items

### Menu Injection (Headless)
```typescript
// widgets/injection/MyMenuItem/widget.ts
export const menuItems = [
  { id: 'my-mod-dashboard', labelKey: 'my_mod.menu.dashboard', icon: 'lucide:layout-dashboard',
    href: '/backend/my-module', placement: { position: InjectionPosition.After, relativeTo: 'customers' } }
]
```

Map in `injection-table.ts`:
```typescript
export default [{ widgetId: 'MyMenuItem', spots: ['menu:sidebar:main'] }]
```

## Response Enrichers

Add computed fields to another module's CRUD responses:

```typescript
// data/enrichers.ts
export const enrichers: ResponseEnricher[] = [{
  id: 'my_mod.customer-stats',
  targetEntity: 'customers.person',
  features: ['my_mod.view'],
  priority: 10,
  timeout: 2000,
  fallback: { _my_mod: { count: 0 } },
  async enrichMany(records, ctx) {
    return records.map(r => ({ ...r, _my_mod: { count: 42 } }))
  },
}]
```

MUST implement `enrichMany()` for batch endpoints. MUST namespace with `_moduleName` prefix.

## API Interceptors

Hook into any route's before/after lifecycle:

```typescript
// api/interceptors.ts
export const interceptors: ApiInterceptor[] = [{
  id: 'my_mod.narrow-customers',
  targetRoute: '/api/customers/people',
  methods: ['GET'],
  async before(ctx) { /* rewrite query.ids to narrow results */ },
  async after(ctx, response) { /* transform response */ },
}]
```

## Access Control (RBAC)

Declare features in `acl.ts`, guard with metadata:

```typescript
// acl.ts
export const features = ['my_module.view', 'my_module.create', 'my_module.edit', 'my_module.delete']
```

Always add matching `defaultRoleFeatures` in `setup.ts`.

Use declarative guards in page metadata: `requireAuth`, `requireRoles`, `requireFeatures`.

## Custom Fields & Entities

Declare in `ce.ts` using DSL helpers:

```typescript
import { defineFields, cf } from '@open-mercato/shared/modules/dsl'
export const entities = [{
  entityId: 'my_module:my_entity',
  fields: defineFields({ fields: [cf.text('notes'), cf.number('priority')] }),
}]
```

## Entity Extensions (Cross-Module Links)

Extend another module's data without mutating their entities:

```typescript
// data/extensions.ts
import { defineLink, entityId, linkable } from '@open-mercato/shared/modules/dsl'
export const extensions = [
  defineLink({ source: entityId('my_module:my_entity'), target: linkable('customers:person') })
]
```

## Component Replacement

Override or wrap existing UI components:

```typescript
// widgets/components.ts
export const componentOverrides = [{
  handle: 'page:customers:detail',
  mode: 'wrapper', // or 'replace', 'props'
  component: MyCustomerDetailWrapper,
}]
```

Prefer `wrapper`/`props` modes over full `replace`.

## Command Pattern (Write Operations)

Implement writes via commands for undo/redo support:

```typescript
import { registerCommand } from '@open-mercato/shared/lib/commands'
// Reference: @open-mercato/core customers/commands/people.ts
```

Include `indexer: { entityType, cacheAliases }` in `emitCrudSideEffects` for query index refresh.
