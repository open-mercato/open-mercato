# Core Package — Agent Guidelines

`@open-mercato/core` contains all core business modules (auth, catalog, customers, sales, etc.). This guide covers the full extensibility contract and module development patterns.

## Always

- Preserve auto-discovery contracts for module files, API routes, pages, subscribers, workers, widgets, and generated registries.
- Export `openApi` from every API route file.
- Use `makeCrudRoute` with `indexer: { entityType }` for CRUD routes that should participate in query indexing.
- Wire custom write routes through the mutation guard contract.
- Use declarative feature guards and add new `acl.ts` features to `setup.ts` `defaultRoleFeatures`.
- Use `findWithDecryption` / `findOneWithDecryption` for encrypted entities.
- Implement domain writes through commands so audit, undo, cache, events, and indexing stay consistent.
- Run `yarn generate` after changing module files discovered by the generator.

## Ask First

- Ask before changing any contract surface from `BACKWARD_COMPATIBILITY.md`: auto-discovery, public types, import paths, event IDs, widget spot IDs, API URLs, DB schema, DI names, ACL features, notification IDs, CLI commands, or generated file contracts.
- Ask before moving versioned generated files or changing where generated registries live.
- Ask before applying migrations with `yarn db:migrate`; normal PRs should include migration files and snapshots.

## Never

- Never create direct ORM relationships between modules; use foreign key IDs and fetch separately.
- Never expose cross-tenant data or omit tenant/organization scoping.
- Never hand-edit generated files.
- Never import generated app bootstrap files from packages.
- Never run raw `em.find` / `em.findOne` between scalar mutations and `em.flush()` on the same `EntityManager` without `withAtomicFlush`.
- Never hand-roll AES/KMS encryption or bypass `TenantDataEncryptionService`.
- Never compare raw feature arrays with exact string checks when wildcard grants apply.

## Validation Commands

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core build
yarn workspace @open-mercato/core test
```

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
- Frontend page middleware: `frontend/middleware.ts` — export `middleware` (or default) as `PageRouteMiddleware[]`
- Backend page middleware: `backend/middleware.ts` — export `middleware` (or default) as `PageRouteMiddleware[]`
- API routes: `api/<method>/<path>.ts` → `/api/<path>` dispatched by method
- Subscribers: `subscribers/*.ts` — export default handler + `metadata` with `{ event: string, persistent?: boolean, id?: string }`
- Workers: `workers/*.ts` — export default handler + `metadata` with `{ queue: string, id?: string, concurrency?: number }`

### Portal Pages (Frontend sub-convention)

Customer portal pages live under the standard frontend tree with a required `[orgSlug]` segment:

- `frontend/[orgSlug]/portal/<path>/page.tsx` → `/{orgSlug}/portal/<path>`
- `[orgSlug]` MUST be the first segment — portal auth, tenant resolution, and the portal shell all assume this shape
- Any third-party module can contribute portal pages this way; the `(frontend)` catch-all handles the route

Portal pages MUST ship a sibling `page.meta.ts` (see [packages/ui/AGENTS.md → Portal Extension](../ui/AGENTS.md)). That file:
- Declares `requireCustomerAuth` / `requireCustomerFeatures` — enforced server-side by the `(frontend)` catch-all via `CustomerRbacService`
- Optionally declares a `nav` block — when present, the page is auto-listed in the portal sidebar by `/api/customer_accounts/portal/nav` (RBAC-filtered)

Example:
```typescript
// frontend/[orgSlug]/portal/orders/page.meta.ts
import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.orders.view'],
  nav: { label: 'Orders', labelKey: 'orders.nav.title', group: 'main', order: 20 },
}
```

Granting the feature to a customer role is sufficient for the entry to appear — no separate menu-injection widget is required. For pages without a sidebar entry (detail/create/edit), omit the `nav` block. For external links without a backing page, use `usePortalInjectedMenuItems` widgets instead.

### Page Metadata

- Prefer colocated `page.meta.ts`, `<name>.meta.ts`, or folder `meta.ts`
- Alternatively, server components may `export const metadata` from the page file itself

## API Routes

All API route files MUST export an `openApi` object for automatic API documentation generation.

For custom write routes that do not use `makeCrudRoute` (`POST`/`PUT`/`PATCH`/`DELETE`), MUST wire the mutation guard registry:
- map the route to the closest registry operation (`create`, `update`, or `delete`; state-changing action endpoints usually use `update`)
- collect registered guards with `getAllMutationGuardInstances()` and append `bridgeLegacyGuard(container)` when present
- call `runMutationGuards(...)` from `@open-mercato/shared/lib/crud/mutation-guard-registry` before mutation logic, passing the caller's granted features as `{ userFeatures }`
- return `guardResult.errorBody` / `guardResult.errorStatus` when blocked, merge `guardResult.modifiedPayload` back into validated input when present, and run each returned `afterSuccessCallbacks` item after a successful mutation, catching/logging callback failures so committed writes still return successfully

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

### Entity Schema And Migration Workflow

When adding or changing a MikroORM entity, coding agents MUST read this section, the customers reference module guide, and `packages/cli/AGENTS.md` before editing.

1. Update `data/entities.ts` using MikroORM v7 imports: decorators from `@mikro-orm/decorators/legacy`, types from `@mikro-orm/core`.
2. Run `yarn generate` when module structure or entity discovery changed.
3. Treat `yarn db:generate` as a schema-diff probe. Review every generated file before keeping it.
4. Keep only SQL for the intended module/entity change. If the generator emits unrelated migrations because another module's snapshot is stale, remove those files from the diff instead of committing them.
5. If you author a scoped SQL migration yourself to avoid unrelated generated churn, base it on the entity metadata and existing module migration style, then update that module's `migrations/.snapshot-open-mercato.json` to the post-change schema in the same commit.
6. Do not run `yarn db:migrate` unless the user explicitly asks to apply migrations. PRs should normally contain the migration file and snapshot, not local DB state.

For new CRUD modules, use `packages/core/src/modules/customers/AGENTS.md` as the file-structure reference and copy the command/API patterns before inventing new ones.

## Module Setup Convention

Every module participating in tenant initialization must declare `setup.ts`. The generator auto-discovers these files.

See [SPEC-013](../../.ai/specs/implemented/SPEC-013-2026-01-27-decouple-module-setup.md) for the full ADR.

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
| `defaultRoleFeatures` | Declarative, merged during `ensureDefaultRoleAcls()` and `yarn mercato auth sync-role-acls` | Always | Role ACL features |

### Decoupling Rules

1. Never hardcode module-specific logic in `setup-app.ts`
2. Never directly import another module's seed functions
3. Access entity IDs with optional chaining: `(E as any).catalog?.catalog_product`
4. Use `getEntityIds()` at runtime (not import-time) for cross-module lookups
5. Integration provider packages that need bootstrap credentials or mappings SHOULD preconfigure themselves from env inside the provider module via `setup.ts` and provider-local helpers/CLI. Do not add provider-specific env bootstrapping to core setup orchestration.

### Cross-Module Coupling

When one module needs another, pick the sanctioned mechanism by use-case:

- **Events** for write side-effects — the source module emits (`createModuleEvents`), the other module subscribes (`subscribers/`). See § Events.
- **Widget injection + response enrichers** for read/UI — render another module's data without importing it. See § Widget Injection, § Response Enrichers.
- **FK-id + snapshot** for data — reference by UUID and denormalize a snapshot so reads survive the source module being absent or changed. See § Database Entities, § Extensions.

Optional integration (e.g. CRM deals optionally adjusting WMS stock): the **optional consumer** owns the glue (subscriber / enricher / widget) and resolves the peer's service inside a `try/catch` — a per-module local `tryResolve` helper that wraps `container.resolve()` and returns `undefined` when the peer is absent (see `inbox_ops/subscribers/extractionWorker.ts`, `shipping_carriers/api/webhook/[provider]/route.ts`) — then no-ops or degrades gracefully. Never declare a hard `requires` on an optional peer and never call an unconditional `container.resolve(...)` for it. The upstream/depended-on module MUST NOT import, resolve, or hard-require the consumer — inverting that direction breaks the upstream module's isomorphism.

The cross-module ORM-relation and direct-business-logic-import bans already live at line 24 and root `AGENTS.md` § Architecture — do not restate them. Verify absent-module behavior with `packages/core/src/__tests__/module-decoupling.test.ts` (§ Testing with Disabled Modules).

### ACL Grant Sync

When adding features to `acl.ts`, also add them to `setup.ts` `defaultRoleFeatures` for `admin` and any other default roles that should see the module immediately (for example `employee`, portal/customer roles, or module-specific custom roles). Then run the idempotent sync command so existing tenants receive the new grants:

```bash
yarn mercato auth sync-role-acls
```

Do this automatically unless the user explicitly asks to leave role ACLs untouched. New tenants get `defaultRoleFeatures` during setup; existing tenants only receive newly declared grants after the sync command. Use `--tenant <tenantId>` only when the user asks to target one tenant.

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

Run `yarn generate` after creating/modifying `events.ts` files.

## Operation Progress

Use the progress module for every user-visible bulk operation and every future long-running operation. Read `packages/core/src/modules/progress/AGENTS.md` before adding selected-row actions, import/export jobs, reindexing flows, external sync operations, or queued destructive work.

MUST rules:

1. **MUST create a `ProgressJob`** for server-side bulk or long-running work — return `progressJobId` to the UI so `ProgressTopBar` can track it.
2. **MUST use `@open-mercato/queue` workers** for work that should continue after navigation or retry after process failure.
3. **MUST execute domain mutations through commands** from workers — do not bypass audit, undo, cache invalidation, or events with direct ORM mutation loops.
4. **MUST scope progress jobs and worker payloads** with `tenantId` and `organizationId`.
5. **MUST use shared UI progress helpers** for browser-bound DataTable bulk loops; do not build page-local progress banners.

Reference implementation: `packages/core/src/modules/catalog/api/bulk-delete/route.ts`, `packages/core/src/modules/catalog/workers/catalog-product-bulk-delete.ts`, and `packages/core/src/modules/catalog/lib/bulkDelete.ts`.

## Translatable Fields

Declare translatable fields in the module's `translations.ts` at the module root (like `events.ts`). The generator auto-discovers these files and aggregates them into `translations-fields.generated.ts`.

```typescript
// src/modules/<module>/translations.ts
export const translatableFields: Record<string, string[]> = {
  '<module>:<entity>': ['title', 'description'],
}
```

When a module defines `translations.ts`, all its entity types automatically get the Translation Manager widget injected into their CrudForm edit pages.

Run `yarn generate` after creating/modifying `translations.ts` files.

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
- **Reactive handlers**: Declare in `notifications.handlers.ts` exporting `notificationHandlers: NotificationHandler[]`
- **Subscribers**: Create event subscribers in `subscribers/` to emit notifications on domain events
- **Client renderers**: Declare in `notifications.client.ts`; store components in `widgets/notifications/`
- **i18n**: Add translations to `i18n/<locale>.json` under `<module>.notifications.*` keys
- **Handler behavior**: Keep handlers idempotent; use `ctx.emitEvent(...)` for cross-component updates and `ctx.toast(...)`/`ctx.popup(...)` for UX side-effects

## Integrations & Data Sync

> **Moved**: Detailed guides now live in dedicated module AGENTS.md files:
> - `src/modules/integrations/AGENTS.md` — foundation layer (registry, credentials, state, health, logs, admin UI)
> - `src/modules/data_sync/AGENTS.md` — sync hub (adapters, run lifecycle, workers, mappings, admin UI)
>
> Docs reference:
> - `apps/docs/docs/framework/modules/integrations-data-sync.mdx`
> - `apps/docs/docs/api/integrations-data-sync.mdx`

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

DataTable deep-extension surfaces:
- `data-table:<tableId>:columns`
- `data-table:<tableId>:row-actions`
- `data-table:<tableId>:bulk-actions`
- `data-table:<tableId>:filters`
- `data-table:<tableId>:toolbar` — right-side actions row (Refresh, Filters, Columns, Export). Renders on the same row as the title; full-sized buttons.
- `data-table:<tableId>:search-trailing` — adjacent to the search input on the FilterBar row. Reserve for **compact triggers** (AI assistants, saved-view shortcuts). Suppressed when the host DataTable has no search input. Use `Button variant="outline"` (default size, h-9, `rounded-md`) with a single leading icon plus a short caption (e.g. `AI`) so the trigger matches the search input's `h-9` row height and the toolbar's standard rounded-rectangle button radius.

CrudForm field-injection surface:
- `crud-form:<entityId>:fields`

## API Interceptors

Define route interceptors in `api/interceptors.ts` and export `interceptors`.
- Keep scope explicit with `targetRoute` + `methods`; use wildcards only when required.
- `before`/`after` hooks must be fail-closed and timeout-safe.
- If `before` rewrites body/query, return a schema-compatible payload (route handler re-validates it).
- For CRUD list narrowing, prefer writing `query.ids` (comma-separated UUIDs). The CRUD factory merges/intersects `ids` with existing `id` filters.
- Custom (non-CRUD) API routes are opt-in: call `runCustomRouteAfterInterceptors(...)` from `@open-mercato/shared/lib/crud/custom-route-interceptor`.
- For unauthenticated custom routes (e.g. login), pass route-local context with empty identity values (`userId`, `tenantId`, `organizationId`) unless the route has a trusted authenticated principal.
- Phase-1 custom-route contract supports `after` hooks only and JSON body mutation (`merge`/`replace`) without header/cookie mutation.

## Component Replacement

Define component overrides in `widgets/components.ts` and export `componentOverrides`.
- Prefer handle-based targets (`page:*`, `data-table:*`, `crud-form:*`, `section:*`) for deterministic replacement.
- Use wrapper/props-transform modes when possible; replacement mode should preserve props compatibility.
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

- **Shared helpers**: `splitCustomFieldPayload`, `normalizeCustomFieldValues`, `normalizeCustomFieldResponse`, `applyCustomFieldsNormalization` from `@open-mercato/shared`
- **Form collection**: `collectCustomFieldValues()` from `@open-mercato/ui/backend/utils/customFieldValues`
- **Command undo**: capture custom field snapshots in `before`/`after` payloads (`snapshot.custom`), restore via `buildCustomFieldResetMap(before.custom, after.custom)`

### Response Shape

`makeCrudRoute` already extracts custom field values into `customValues` (bare keys, e.g. `{ priority: 3 }`) and `customFields` (definition array) when `list.decorateCustomFields` is configured.

To opt into the canonical single-source response shape (no top-level `cf_*`/`cf:*` redundancy — the standardization requested in #1769), set `stripPrefixedKeys: true`:

```typescript
list: {
  // ...
  decorateCustomFields: {
    entityIds: E.example.todo,
    stripPrefixedKeys: true,
  },
}
```

For non-CRUD routes (custom detail GETs, ad-hoc handlers), call `applyCustomFieldsNormalization(record, decorated, { stripPrefixedKeys: true })` to get the same shape.

The flag is opt-in to keep the existing wire format stable for callers that read `cf_*` from the top level — turn it on for new modules and migrate existing modules deliberately, with a deprecation note for any external consumer that still reads the prefixed keys.

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
- Treat wildcard grants as part of the ACL contract: `module.*` and `*` satisfy matching concrete features.
- When a runtime helper evaluates raw granted feature arrays directly (for example nav builders, notification handlers, mutation guards, command interceptors, or AI tools), MUST use the shared wildcard-aware matcher instead of exact string comparisons.

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
- When adding GDPR-relevant fields, declare or update the module's `encryption.ts` `defaultEncryptionMaps` export

## Command Side Effects

- Implement write operations via the Command pattern (don’t mutate domain state directly inside route handlers). Reference: `src/modules/customers/commands/*`.
- Include `indexer: { entityType, cacheAliases }` in both `emitCrudSideEffects` and `emitCrudUndoSideEffects`
- This ensures undo refreshes the query index and caches
- Reference: customers commands at `src/modules/customers/commands/people.ts`

## Entity Update Safety — `withAtomicFlush`

MikroORM's identity-map and subscriber infrastructure can silently discard pending scalar changes when a query (`em.find`, `em.findOne`, etc.) runs on the same `EntityManager` before an explicit `em.flush()`. Additionally, multiple `em.flush()` calls without transaction wrapping risk partial commits. See [SPEC-018](../../.ai/specs/implemented/SPEC-018-2026-02-05-safe-entity-flush.md) for the full analysis.

### Rules

- Use `withAtomicFlush(em, phases, options)` from
  `@open-mercato/shared/lib/commands/flush` when a command mutates
  entities across multiple phases that include queries on the same `EntityManager`.
- **NEVER** run `em.find` / `em.findOne` / sync helpers between scalar
  mutations and `em.flush()` on the same `EntityManager` without using `withAtomicFlush`.
- Enable `{ transaction: true }` when atomicity matters (all-or-nothing semantics).
- Keep `emitCrudSideEffects` / `emitCrudUndoSideEffects` calls **OUTSIDE** `withAtomicFlush`
  — side effects should only fire after the DB changes are committed.
- Cache invalidation follows the same rule as side effects: invalidate **after** the DB write commits, never inside the `withAtomicFlush` block. For the opt-in always-consistent read-projection tail (`OM_CACHE_SAFETY_ALWAYS_CONSISTENT`, default OFF) see `.ai/specs/2026-06-05-cache-safety-always-consistent.md`.
- This applies to **both** `execute` methods (update commands) and `undo` handlers.

### Commit-boundary guarantee (defense in depth)

`withAtomicFlush` flushes after **each** phase, then runs a final **pending-changes guard** before the transaction commits: it re-checks the `UnitOfWork` and, if any change set still lingers (a phase mutated a managed entity after its own flush boundary), flushes it defensively inside the same transaction and logs a dev warning naming `options.label`. The transaction therefore can never commit unflushed scalar work — even if a per-phase flush was missed. Pass `{ label: '<module>.<command>' }` so the warning is actionable. The guard is a safety net, **not** a license to interleave mutate→read in one phase: structure phases correctly; let the guard catch only genuine slips.

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

### Preferred: `runCrudCommandWrite` for entity + custom fields + side effects

For commands that write an entity, optionally write custom fields, and emit CRUD/index side effects in one logical operation, prefer `runCrudCommandWrite` over composing `withAtomicFlush` + `setCustomFieldsIfAny` + `emitCrudSideEffects` by hand. The helper owns the EM fork, the atomic flush boundary, the custom-field write, and the side-effect queue in the only correct order, and fails closed if any earlier step throws.

```typescript
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'

await runCrudCommandWrite({
  ctx,
  entityId: 'my_module:my_entity',
  action: 'updated',
  scope: { tenantId: record.tenantId, organizationId: record.organizationId },
  customFields: custom,
  events: myCrudEvents,
  indexer: myCrudIndexer,
  sideEffect: () => ({
    entity: record,
    identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
  }),
  phases: [
    () => {
      record.name = parsed.name
      record.status = parsed.status
    },
    () => syncEntityTags(em, record, parsed.tags),
  ],
})
```

Reference migration: `customers.deals.update` in `packages/core/src/modules/customers/commands/deals.ts`. Keep `withAtomicFlush` for cases the helper doesn't fit (multiple separate transactions per command, etc.).

## Profiling

- Enable with `OM_PROFILE` env (comma-separated filters: `*`, `all`, `customers.*`, etc.)
- CRUD factories emit `[crud:profile]` payloads; query engine attaches nested `query_engine` node
- Legacy flags (`OM_CRUD_PROFILE`, `OM_QE_PROFILE`) still work but avoid in new code

## Migrations

- Module-scoped with MikroORM: files live in `src/modules/<module>/migrations/`
- Generate: `yarn db:generate` (iterates all modules)
- Apply: `yarn db:migrate` (ordered, directory first)
- Default: update ORM entities and let `yarn db:generate` emit SQL.
- Exception: when generated output includes unrelated snapshot drift, keep or write only the intended SQL and update that module's `.snapshot-open-mercato.json` in the same change.

## Database Entities

- Live in `src/modules/<module>/data/entities.ts` (fallbacks: `db/entities.ts`, `schema.ts`)
- Tables: plural snake_case; prefer `<module>_` prefixes for module-owned tables (e.g., `catalog_products`, `sales_orders`)
- UUID PKs, explicit FKs, junction tables for M2M
- Include `deleted_at timestamptz null` for soft delete
- **User-editable entities MUST include an `updated_at` column** so OSS optimistic locking (default ON) can function — without it `CrudForm`'s auto-derive silently no-ops and concurrent edits are lost. Use `@Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })`, and make the entity's list/detail CRUD responses return `updatedAt`. The `optimistic-lock-editable-entities.test.ts` guard fails if a curated editable entity drops the column. Append-only logs, junction/assignment tables, session/token rows, background-job rows, and sub-resource lines guarded by a parent aggregate are exempt.

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

Run `yarn generate` or rely on `predev`/`prebuild`.

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
  cacheableOnListHit: false,             // see "List cache behavior" below (default false)
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

### List cache behavior (`cacheableOnListHit`)

When the opt-in CRUD list cache (`ENABLE_CRUD_API_CACHE`) is enabled, the factory stores the **enriched** list payload and partitions cache entries by the active-enricher signature (the ACL/tenant-filtered enricher ids for the caller). On a cache hit it must decide whether to re-run enrichers or serve the stored enriched fields directly:

- The cache-hit path **skips re-running enrichers only when every active enricher opted in with `cacheableOnListHit: true`** (record-pure cohort). Otherwise it re-runs all active enrichers on a hit and the cache stores the base (pre-enrichment) payload.
- Set `cacheableOnListHit: true` **only** when the enricher's output for a record is a pure function of that record's own cached state and is invalidated together with it (e.g. fields derived from the same module's own per-record data). The shipped `example.customer-todo-count` enricher keeps the default `false`: it reads other modules' tables (todos and per-customer priority) the list cache does not invalidate on, so it must re-run on every hit.
- Leave it `false` (the fail-closed default) for any enricher whose output depends on data the list cache does not invalidate on: cross-module / cross-entity reads (e.g. a product image fetched for a sales line), wall-clock-relative values (e.g. "days in stage"), or aggregates over other tables. These MUST re-run on every request so the response reflects current data.

### Response Enricher Rules

- MUST implement `enrichMany()` for batch endpoints (prevents N+1 queries)
- MUST namespace enriched fields with `_moduleName` prefix (e.g. `_example.todoCount`)
- MUST use `features` array for ACL gating — enricher runs only if user has all listed features
- MUST keep `cacheableOnListHit` at `false` (default) unless the enriched output is record-pure and invalidated with the host record — opting in on a cross-module/time-relative enricher serves stale data from the shared list cache
- Export fields are stripped: `_meta` and `_`-prefixed fields are removed from CSV/Excel exports
- Enrichers run after `CrudHooks.afterList`, before HTTP response serialization
- `critical: true` propagates errors to the HTTP response; `false` (default) uses fallback silently
- Run `yarn generate` after adding `data/enrichers.ts` to auto-discover

## Upgrade Actions

Declare once per version in `src/modules/configs/lib/upgrade-actions.ts`. Keep them idempotent, reuse module helpers. Access guarded by `configs.manage`.
