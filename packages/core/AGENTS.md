# Core Package — Agent Guidelines

`@open-mercato/core` contains all core business modules (auth, catalog, customers, sales, etc.). This guide covers the full extensibility contract and module development patterns.

## Core Modules

| Module | Path | Description |
|--------|------|-------------|
| `api_docs` | `src/modules/api_docs/` | API documentation generation |
| `api_keys` | `src/modules/api_keys/` | API key management |
| `attachments` | `src/modules/attachments/` | File attachments and uploads |
| `audit_logs` | `src/modules/audit_logs/` | Activity and change logging |
| `auth` | `src/modules/auth/` | Authentication and authorization |
| `business_rules` | `src/modules/business_rules/` | Business rule engine |
| `catalog` | `src/modules/catalog/` | Product catalog and pricing |
| `configs` | `src/modules/configs/` | System configuration |
| `currencies` | `src/modules/currencies/` | Multi-currency support |
| `customers` | `src/modules/customers/` | Customer management (people, companies, deals) |
| `dashboards` | `src/modules/dashboards/` | Dashboard widgets |
| `dictionaries` | `src/modules/dictionaries/` | Lookup tables and enumerations |
| `directory` | `src/modules/directory/` | Organizational directory |
| `entities` | `src/modules/entities/` | Custom entities and fields (EAV) |
| `feature_toggles` | `src/modules/feature_toggles/` | Feature flag management |
| `perspectives` | `src/modules/perspectives/` | Data perspectives and views |
| `query_index` | `src/modules/query_index/` | Query indexing for fast lookups |
| `sales` | `src/modules/sales/` | Sales orders, quotes, invoices |
| `widgets` | `src/modules/widgets/` | Widget infrastructure |
| `workflows` | `src/modules/workflows/` | Workflow automation |

## Extensibility Contract

All module paths use `src/modules/<module>/` as shorthand.

### Auto-Discovery

- Frontend pages: `frontend/<path>.tsx` → `/<path>`
- Backend pages: `backend/<path>.tsx` → `/backend/<path>` (special: `backend/page.tsx` → `/backend/<module>`)
- API routes: `api/<method>/<path>.ts` → `/api/<path>` dispatched by method
- Subscribers: `subscribers/*.ts` — export default handler + `metadata` with `{ event: string, persistent?: boolean, id?: string }`
- Workers: `workers/*.ts` — export default handler + `metadata` with `{ queue: string, id?: string, concurrency?: number }`

### Page Metadata

- Prefer colocated `page.meta.ts`, `<name>.meta.ts`, or folder `meta.ts`
- Alternatively, server components may `export const metadata` from the page file itself

## API Routes

All API route files MUST export an `openApi` object for automatic API documentation generation.

For custom write routes that do not use `makeCrudRoute` (`POST`/`PUT`/`PATCH`/`DELETE`), MUST wire the mutation guard contract:
- call `validateCrudMutationGuard` before mutation logic
- call `runCrudMutationGuardAfterSuccess` after successful mutation when requested

### CRUD Routes

Create an `openapi.ts` helper in your module's `api/` directory:

```typescript
// src/modules/<module>/api/openapi.ts
import { createCrudOpenApiFactory } from '@open-mercato/shared/lib/openapi/crud'

export const buildModuleCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'ModuleName',
})

// src/modules/<module>/api/<resource>/route.ts
export const openApi = buildModuleCrudOpenApi({
  resourceName: 'Resource',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createSchema, description: '...' },
  update: { schema: updateSchema, responseSchema: okSchema, description: '...' },
  del: { schema: deleteSchema, responseSchema: okSchema, description: '...' },
})
```

### CRUD Factory

Use `makeCrudRoute` with `indexer: { entityType }` so custom entities stay indexed:

```typescript
// Always set indexer for query index coverage
makeCrudRoute({
  // ... other config
  indexer: { entityType: 'my_module:my_entity' },
})
```

### Custom Entities CRUD

Follow the customers module API patterns (CRUD factory + query engine):
- Wire custom field helpers for create/update/response normalization
- Set `indexer: { entityType }` in `makeCrudRoute`
- Reference: `src/modules/customers/api/people/route.ts`

## Module Setup Convention

Every module participating in tenant initialization must declare `setup.ts`. The generator auto-discovers these files.

See [SPEC-013](../../.ai/specs/SPEC-013-2026-01-27-decouple-module-setup.md) for the full ADR.

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['my_module.admin_only_feature'],
    admin: ['my_module.*'],
    employee: ['my_module.view'],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    // Settings rows, numbering sequences — must be idempotent
  },

  async seedDefaults({ em, tenantId, organizationId, container }) {
    // Reference data: dictionaries, tax rates, statuses — always runs
  },

  async seedExamples({ em, tenantId, organizationId, container }) {
    // Demo data — only runs when examples are requested
  },
}

export default setup
```

### Lifecycle Hooks

| Hook | When it runs | Gate | Use case |
|------|-------------|------|----------|
| `onTenantCreated` | Inside `setupInitialTenant()` | Always | Settings rows, sequences, config |
| `seedDefaults` | During init/onboarding | Always | Dictionaries, tax rates, statuses |
| `seedExamples` | During init/onboarding | Skipped with `--no-examples` | Demo data |
| `defaultRoleFeatures` | Declarative, merged during `ensureDefaultRoleAcls()` | Always | Role ACL features |

### Decoupling Rules

1. Never hardcode module-specific logic in `setup-app.ts`
2. Never directly import another module's seed functions
3. Access entity IDs with optional chaining: `(E as any).catalog?.catalog_product`
4. Use `getEntityIds()` at runtime (not import-time) for cross-module lookups

### Testing with Disabled Modules

The module-decoupling test (`packages/core/src/__tests__/module-decoupling.test.ts`) verifies the app works when optional modules are disabled:

```typescript
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

const testModules: Module[] = [
  { id: 'auth', setup: { defaultRoleFeatures: { admin: ['auth.*'] } } },
  // ... only modules your test needs
]
registerModules(testModules)
```

## Events

Declare events in the emitting module's `events.ts` for type safety and workflow trigger discovery.

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'module.entity.created', label: 'Entity Created', entity: 'entity', category: 'crud' },
  { id: 'module.entity.updated', label: 'Entity Updated', entity: 'entity', category: 'crud' },
  { id: 'module.entity.deleted', label: 'Entity Deleted', entity: 'entity', category: 'crud' },
  { id: 'module.lifecycle.before', label: 'Before Lifecycle', category: 'lifecycle', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'module', events })
export const emitModuleEvent = eventsConfig.emit
export type ModuleEventId = typeof events[number]['id']
export default eventsConfig
```

Event fields: `id` (required), `label` (required), `description`, `category` (`crud`|`lifecycle`|`system`|`custom`), `entity`, `excludeFromTriggers`.

MUST use `as const` — provides compile-time safety; undeclared events trigger TypeScript errors and runtime warnings.

Run `npm run modules:prepare` after creating/modifying `events.ts` files.

## Translatable Fields

Declare translatable fields in the module's `translations.ts` at the module root (like `events.ts`). The generator auto-discovers these files and aggregates them into `translations-fields.generated.ts`.

```typescript
// src/modules/<module>/translations.ts
export const translatableFields: Record<string, string[]> = {
  '<module>:<entity>': ['title', 'description'],
}
```

When a module defines `translations.ts`, all its entity types automatically get the Translation Manager widget injected into their CrudForm edit pages.

Run `npm run modules:prepare` after creating/modifying `translations.ts` files.

### Event Subscribers

React to events by creating subscriber files in `subscribers/`:

```typescript
// src/modules/<module>/subscribers/entity-created-notify.ts
export const metadata = { event: 'module.entity.created', persistent: true, id: 'entity-created-notify' }
export default async function handler(payload, ctx) { /* one side effect per subscriber */ }
```

| Subscription type | When to use |
|-------------------|-------------|
| Ephemeral (`persistent: false`) | Real-time UI updates, cache invalidation |
| Persistent (`persistent: true`) | Notifications, indexing, audit logging — retried on failure |

See `packages/events/AGENTS.md` for event bus architecture, queue integration, and worker details.

## Notifications

Modules can define notification types and custom UI renderers for in-app notifications.

### File Structure

```
src/modules/<module>/
├── notifications.ts                    # Server-side type definitions (for generator)
├── notifications.client.ts             # Client-side types with Renderer components
├── subscribers/
│   └── entity-created-notification.ts  # Subscribes to module.entity.created
└── widgets/
    └── notifications/
        ├── index.ts
        └── EntityCreatedRenderer.tsx
```

- **Notification types**: Declare in `notifications.ts` exporting `notificationTypes: NotificationTypeDefinition[]`
- **Subscribers**: Create event subscribers in `subscribers/` to emit notifications on domain events
- **Client renderers**: Declare in `notifications.client.ts`; store components in `widgets/notifications/`
- **i18n**: Add translations to `i18n/<locale>.json` under `<module>.notifications.*` keys

## Widget Injection

Widget injection is the preferred way to build inter-module UI extensions. Avoid coupling modules directly — inject UI instead.

### Structure

- Declare widgets under `widgets/injection/`
- Map them to slots via `widgets/injection-table.ts`
- Keep metadata in colocated `*.meta.ts` files
- For headless widgets (menu items, field/column/action declarations), export declarative payloads from `widget.ts` without a React `Widget` component
- Use `InjectionPosition` from `@open-mercato/shared/modules/widgets/injection-position` for deterministic before/after/first/last placement

### Spot IDs

Hosts expose consistent spot ids:
- `crud-form:<entityId>` — forms
- `data-table:<tableId>[:header|:footer]` — data tables
- `admin.page:<path>:before|after` — admin pages
- `menu:sidebar:main` — main sidebar items/groups
- `menu:sidebar:settings` — settings sidebar
- `menu:sidebar:profile` — profile sidebar
- `menu:topbar:profile-dropdown` — user/profile dropdown
- `menu:topbar:actions` — header action area

Widgets can opt into grouped cards or tabs via `placement.kind`.

### Menu Injection

- Define menu widgets with `menuItems: InjectionMenuItem[]` and map them to one or more `menu:*` spots in `widgets/injection-table.ts`.
- Prefer stable `menuItems[].id` values (`<module>-<feature>-<action>`) because sidebar customization and tests rely on these IDs.
- Always use i18n keys for labels (`labelKey`), never hard-code user-facing text in widget payloads.
- When placing relative to an existing item, provide `placement: { position: InjectionPosition.Before|After, relativeTo: '<target-id>' }`.

## Custom Fields

### Declaration

Declare custom entities in `ce.ts` under `entities[].fields`. (`data/fields.ts` is no longer supported.)

Always reference generated ids (`E.<module>.<entity>`) so system entities stay aligned with `generated/entities.ids.generated.ts`.

### Helpers

- **Shared helpers**: `splitCustomFieldPayload`, `normalizeCustomFieldValues`, `normalizeCustomFieldResponse` from `@open-mercato/shared`
- **Form collection**: `collectCustomFieldValues()` from `@open-mercato/ui/backend/utils/customFieldValues`
- **Command undo**: capture custom field snapshots in `before`/`after` payloads (`snapshot.custom`), restore via `buildCustomFieldResetMap(before.custom, after.custom)`

### DSL Helpers

```typescript
import { defineLink, entityId, linkable, defineFields, cf } from '@open-mercato/shared/modules/dsl'

// Module-to-module extensions
defineLink({ source: entityId('module:entity'), target: linkable('other:entity') })

// Field sets
defineFields({ fields: [cf.text('name'), cf.number('quantity')] })
```

## Extensions

Per-module entity extensions: declare in `data/extensions.ts` as `export const extensions: EntityExtension[]`.

When extending another module's data, add a separate extension entity — never mutate core entities. Pattern mirrors Medusa's module links.

## Access Control (RBAC)

- Prefer declarative guards in metadata: `requireAuth`, `requireRoles`, `requireFeatures`
- RBAC is two-layered: Role ACLs and User ACLs per tenant
- Features declared per module in `acl.ts`, naming: `<module>.<action>`
- Server-side check: `rbacService.userHasAllFeatures(userId, features, { tenantId, organizationId })`
- Special flags: `isSuperAdmin` (all features), organization visibility list

```typescript
// acl.ts
export const features = [
  'my_module.view',
  'my_module.create',
  'my_module.edit',
  'my_module.delete',
]
```

When adding features to `acl.ts`, also add them to `setup.ts` `defaultRoleFeatures`.

## Encryption

- Respect the feature flag: only encrypt/decrypt when tenant data encryption is enabled
- Use `findWithDecryption`/`findOneWithDecryption` instead of `em.find`/`em.findOne`
- Always supply `tenantId` and `organizationId` to decryption helpers
- Do not hand-roll AES/KMS calls; rely on `TenantDataEncryptionService`
- Query index: keep `entity_indexes.doc` encrypted at rest; use `decryptIndexDocCustomFields`, `decryptIndexDocForSearch`
- Vector search: `result_title`/`result_subtitle`/`result_icon` encrypted at rest
- When adding GDPR-relevant fields, update encryption defaults in `src/modules/entities/lib/encryptionDefaults.ts`

## Command Side Effects

- Implement write operations via the Command pattern (don’t mutate domain state directly inside route handlers). Reference: `src/modules/customers/commands/*`.
- Include `indexer: { entityType, cacheAliases }` in both `emitCrudSideEffects` and `emitCrudUndoSideEffects`
- This ensures undo refreshes the query index and caches
- Reference: customers commands at `src/modules/customers/commands/people.ts`

## Entity Update Safety — `withAtomicFlush`

MikroORM's identity-map and subscriber infrastructure can silently discard pending scalar changes when a query (`em.find`, `em.findOne`, etc.) runs on the same `EntityManager` before an explicit `em.flush()`. Additionally, multiple `em.flush()` calls without transaction wrapping risk partial commits. See [SPEC-018](../../.ai/specs/SPEC-018-2026-02-05-safe-entity-flush.md) for the full analysis.

### Rules

- Use `withAtomicFlush(em, phases, options)` from
  `@open-mercato/shared/lib/commands/flush` when a command mutates
  entities across multiple phases that include queries on the same `EntityManager`.
- **NEVER** run `em.find` / `em.findOne` / sync helpers between scalar
  mutations and `em.flush()` on the same `EntityManager` without using `withAtomicFlush`.
- Enable `{ transaction: true }` when atomicity matters (all-or-nothing semantics).
- Keep `emitCrudSideEffects` / `emitCrudUndoSideEffects` calls **OUTSIDE** `withAtomicFlush`
  — side effects should only fire after the DB changes are committed.
- This applies to **both** `execute` methods (update commands) and `undo` handlers.

### Wrong

```typescript
// BUG: changes to `record` are silently lost
record.name = 'New Name'
record.status = 'active'
await syncEntityTags(em, record, tags)   // internal em.find() resets UoW tracking
await em.flush()                          // no UPDATE issued
```

### Correct

```typescript
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'

await withAtomicFlush(em, [
  () => {
    record.name = 'New Name'
    record.status = 'active'
  },
  () => syncEntityTags(em, record, tags),
], { transaction: true })

// Side effects AFTER the atomic flush
await emitCrudSideEffects({ ... })
```

## Profiling

- Enable with `OM_PROFILE` env (comma-separated filters: `*`, `all`, `customers.*`, etc.)
- CRUD factories emit `[crud:profile]` payloads; query engine attaches nested `query_engine` node
- Legacy flags (`OM_CRUD_PROFILE`, `OM_QE_PROFILE`) still work but avoid in new code

## Migrations

- Module-scoped with MikroORM: files live in `src/modules/<module>/migrations/`
- Generate: `yarn db:generate` (iterates all modules)
- Apply: `yarn db:migrate` (ordered, directory first)
- **Never hand-write migration files.** Update ORM entities, let `yarn db:generate` emit SQL.

## Database Entities

- Live in `src/modules/<module>/data/entities.ts` (fallbacks: `db/entities.ts`, `schema.ts`)
- Tables: plural snake_case; prefer `<module>_` prefixes for module-owned tables (e.g., `catalog_products`, `sales_orders`)
- UUID PKs, explicit FKs, junction tables for M2M
- Include `deleted_at timestamptz null` for soft delete

## Generated Files

Output to `apps/mercato/.mercato/generated/`. Never edit manually. Never import from packages — only the app bootstrap should import and register them.

| File | Content |
|------|---------|
| `modules.generated.ts` | Routes, APIs, CLIs, subscribers, workers |
| `entities.generated.ts` | MikroORM entities |
| `di.generated.ts` | DI registrars |
| `entities.ids.generated.ts` | Entity ID registry |
| `search.generated.ts` | Search configurations |
| `dashboard-widgets.generated.ts` | Dashboard widgets |
| `injection-widgets.generated.ts` | Injection widgets |
| `injection-tables.generated.ts` | Injection tables |
| `ai-tools.generated.ts` | AI tool definitions |
| `modules.cli.generated.ts` | CLI module registrations |

Run `npm run modules:prepare` or rely on `predev`/`prebuild`.

## Response Enrichers

Response enrichers let a module add computed fields to another module's CRUD API responses (similar to GraphQL Federation).

### Creating an Enricher

Create `data/enrichers.ts` in your module:

```typescript
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

const myEnricher: ResponseEnricher = {
  id: 'mymodule.customer-metrics',
  targetEntity: 'customers.person',     // entity to enrich
  features: ['mymodule.view'],           // required ACL features
  priority: 10,                          // higher runs first
  timeout: 2000,                         // ms, default 2000
  fallback: { _mymodule: { count: 0 } },// returned on failure
  critical: false,                       // true = error propagates to client
  async enrichOne(record, context) {
    // Add fields to a single record
    return { ...record, _mymodule: { count: 42 } }
  },
  async enrichMany(records, context) {
    // Batch enrichment (prevents N+1)
    return records.map(r => ({ ...r, _mymodule: { count: 42 } }))
  },
}

export const enrichers: ResponseEnricher[] = [myEnricher]
```

### Opt-in on CRUD routes

Target entity routes must opt in via `enrichers` option:
```typescript
const crud = makeCrudRoute({
  // ...
  enrichers: { entityId: 'customers.person' },
})
```

### Key Rules

- MUST implement `enrichMany()` for batch endpoints (prevents N+1 queries)
- MUST namespace enriched fields with `_moduleName` prefix (e.g. `_example.todoCount`)
- MUST use `features` array for ACL gating — enricher runs only if user has all listed features
- Export fields are stripped: `_meta` and `_`-prefixed fields are removed from CSV/Excel exports
- Enrichers run after `CrudHooks.afterList`, before HTTP response serialization
- `critical: true` propagates errors to the HTTP response; `false` (default) uses fallback silently
- Run `yarn generate` after adding `data/enrichers.ts` to auto-discover

## Upgrade Actions

Declare once per version in `src/modules/configs/lib/upgrade-actions.ts`. Keep them idempotent, reuse module helpers. Access guarded by `configs.manage`.
