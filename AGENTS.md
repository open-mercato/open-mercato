# Agents Guidelines

This repository is designed for extensibility. Agents should leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Monorepo Structure
The project is organized as a monorepo with the following structure:

### Apps (`apps/`)
- **mercato**: The main Next.js application. User-created modules go in `apps/mercato/src/modules/`.
- **docs**: Documentation site.

### Packages (`packages/`)
All packages use the `@open-mercato/<package>` naming convention:

| Package | Import | Description |
|---------|--------|-------------|
| **shared** | `@open-mercato/shared` | Core utilities, types, DSL helpers, i18n, testing, commands, data engine |
| **ui** | `@open-mercato/ui` | UI components, primitives, backend components, forms, data tables |
| **core** | `@open-mercato/core` | Core business modules (auth, catalog, customers, sales, etc.) |
| **cli** | `@open-mercato/cli` | CLI tooling and commands |
| **cache** | `@open-mercato/cache` | Multi-strategy cache service with tag-based invalidation |
| **queue** | `@open-mercato/queue` | Multi-strategy job queue (local, BullMQ) |
| **events** | `@open-mercato/events` | Event bus and pub/sub infrastructure |
| **search** | `@open-mercato/search` | Search module (fulltext, vector, tokens strategies) |
| **ai-assistant** | `@open-mercato/ai-assistant` | AI assistant and MCP server |
| **content** | `@open-mercato/content` | Content management module |
| **onboarding** | `@open-mercato/onboarding` | Onboarding flows and wizards |

### Core Modules by Package
Each package contains domain-specific modules:

**@open-mercato/core** (`packages/core/src/modules/`):
- `api_docs` - API documentation generation
- `api_keys` - API key management
- `attachments` - File attachments and uploads
- `audit_logs` - Activity and change logging
- `auth` - Authentication and authorization
- `business_rules` - Business rule engine
- `catalog` - Product catalog and pricing
- `configs` - System configuration
- `currencies` - Multi-currency support
- `customers` - Customer management (people, companies, deals)
- `dashboards` - Dashboard widgets
- `dictionaries` - Lookup tables and enumerations
- `directory` - Organizational directory
- `entities` - Custom entities and fields (EAV)
- `feature_toggles` - Feature flag management
- `perspectives` - Data perspectives and views
- `query_index` - Query indexing for fast lookups
- `sales` - Sales orders, quotes, invoices
- `widgets` - Widget infrastructure
- `workflows` - Workflow automation

**@open-mercato/search** (`packages/search/src/modules/`):
- `search` - Unified search (fulltext, vector, tokens)

**@open-mercato/ai-assistant** (`packages/ai-assistant/src/modules/`):
- `ai_assistant` - AI chat and MCP server

**@open-mercato/onboarding** (`packages/onboarding/src/modules/`):
- `onboarding` - Setup wizards and guided flows

**@open-mercato/content** (`packages/content/src/modules/`):
- `content` - Content management

**@open-mercato/events** (`packages/events/src/modules/`):
- `events` - Event bus infrastructure

### Common Import Patterns
```typescript
// Shared utilities and helpers
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

// Shared module types
import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'
import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'

// UI components
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { CrudForm } from '@open-mercato/ui/backend/crud'

// Core modules (when importing from another module)
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import type { SalesOrderEntity } from '@open-mercato/core/modules/sales'
```

## Documentation and Specifications

Architecture Decision Records (ADR) and feature specifications are maintained in the `.ai/specs/` folder. This serves as the source of truth for design decisions and module specifications.

### Spec Files
- Location: `.ai/specs/<module-name>.md` (e.g., `.ai/specs/notifications-module.md`)
- Each spec documents the module's purpose, architecture, API contracts, data models, and implementation details.
- Specs should include a **Changelog** section at the bottom to track evolution over time.

### When Developing Features
1. **Before coding**: Check if a spec exists for the module you're modifying. Read it to understand the design intent.
2. **When adding features**: Update the corresponding spec file with:
   - New functionality description
   - API changes
   - Data model updates
   - A changelog entry with date and summary
3. **When creating new modules**: Create a new spec file at `.ai/specs/<module-name>.md` before or alongside implementation.

### Spec Changelog Format
Each spec should maintain a changelog at the bottom:
```markdown
## Changelog

### 2026-01-23
- Added email notification channel support
- Updated notification preferences API

### 2026-01-15
- Initial specification
```

### Auto-generating Specs
Even when not explicitly asked to update specs, agents should:
- Generate or update the spec when implementing significant changes
- Keep specs synchronized with the actual implementation
- Document any architectural decisions made during development

This ensures the `.ai/specs/` folder remains a reliable reference for understanding module behavior and history.

## Conventions
- Modules: plural, snake_case (folders and `id`). Special cases: `auth`, `example`.
- JS/TS fields and identifiers: camelCase.
- Database tables and columns: snake_case; table names plural.
- Keep code minimal and focused; avoid side effects across modules.
- **Where to put code**:
  - Core platform features → `packages/<package>/src/modules/<module>/`
  - Shared utilities and types → `packages/shared/src/lib/` or `packages/shared/src/modules/`
  - UI components → `packages/ui/src/`
  - User/app-specific modules → `apps/mercato/src/modules/<module>/`
  - Avoid adding code directly in `apps/mercato/src/` - it's a boilerplate for user apps

## Extensibility Contract
All module paths below use `src/modules/<module>/` as a shorthand. In practice:
- **Package modules**: `packages/<package>/src/modules/<module>/` (e.g., `packages/core/src/modules/customers/`)
- **App modules**: `apps/mercato/src/modules/<module>/` (e.g., `apps/mercato/src/modules/example/`)

- Auto-discovery:
  - Frontend pages under `src/modules/<module>/frontend/<path>.tsx` → `/<path>`
  - Backend pages under `src/modules/<module>/backend/<path>.tsx` → `/backend/<path>`
  - Special case: `src/modules/<module>/backend/page.tsx` → `/backend/<module>`
- Page metadata:
  - Prefer colocated `page.meta.ts`, `<name>.meta.ts`, or folder `meta.ts`.
  - Alternatively, server components may `export const metadata` from the page file itself.
- API under `src/modules/<module>/api/<method>/<path>.ts` → `/api/<path>` dispatched by method
  - **OpenAPI Specifications**: All API route files MUST export an `openApi` object to document request/response schemas for automatic API documentation generation. This ensures consistent API documentation across all modules.
    - For CRUD routes, create an `openapi.ts` helper file in your module's `api/` directory following the pattern from `packages/core/src/modules/catalog/api/openapi.ts`
    - Export `openApi` from each route file with schemas for all HTTP methods (GET, POST, PUT, DELETE)
    - Use Zod schemas for request bodies, query parameters, and response shapes
    - Example structure:
      ```typescript
      // src/modules/<module>/api/openapi.ts
      import { createCrudOpenApiFactory } from '@open-mercato/shared/lib/openapi/crud'

      export const buildModuleCrudOpenApi = createCrudOpenApiFactory({
        defaultTag: 'ModuleName',
        // ... other config
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
    - For non-CRUD routes, manually define the `openApi` object with full HTTP method specifications
- Subscribers under `src/modules/<module>/subscribers/*.ts` exporting default handler and `metadata` with `{ event: string, persistent?: boolean, id?: string }`
- Workers under `src/modules/<module>/workers/*.ts` exporting default handler and `metadata` with `{ queue: string, id?: string, concurrency?: number }`
- Optional CLI at `src/modules/<module>/cli.ts` default export
- Optional metadata at `src/modules/<module>/index.ts` exporting `metadata`
- Optional features at `src/modules/<module>/acl.ts` exporting `features`
- Optional custom entities at `src/modules/<module>/ce.ts` exporting `entities`
- Optional DI registrar at `src/modules/<module>/di.ts` exporting `register(container)`
- Optional upgrade actions: declare once per version in `packages/core/src/modules/configs/lib/upgrade-actions.ts`; actions are auto-discovered by the backend upgrade banner and stored per tenant/organization in `upgrade_action_runs`. Keep them idempotent, reuse module helpers (e.g., catalog seeds), and do not introduce new features—access is guarded by `configs.manage`.
- Extensions and fields:
  - Per-module entity extensions: declare in `src/modules/<module>/data/extensions.ts` as `export const extensions: EntityExtension[]`.
- Custom fields: declare in `src/modules/<module>/ce.ts` under `entities[].fields`. `data/fields.ts` is no longer supported.
- Generators add these to `modules.generated.ts` so they’re available at runtime.
- Prefer using the DSL helpers from `@open-mercato/shared/modules/dsl`:
  - `defineLink()` with `entityId()` or `linkable()` for module-to-module extensions.
  - `defineFields()` with `cf.*` helpers for field sets.
- Generated registries now flow through DI bindings. Generated files are in `apps/mercato/.mercato/generated/`. Do not import generated files inside packages; only the app bootstrap should import and register them.
  - Generated files: `modules.generated.ts`, `entities.generated.ts`, `di.generated.ts`, `entities.ids.generated.ts`, `dashboard-widgets.generated.ts`, `injection-widgets.generated.ts`, `injection-tables.generated.ts`, `search.generated.ts`, `modules.cli.generated.ts`
  - Bootstrap registration: `registerOrmEntities`, `registerDiRegistrars`, `registerModules`/`registerCliModules`, `registerEntityIds`, `registerDashboardWidgets`, `registerInjectionWidgets`, `registerCoreInjectionWidgets`/`registerCoreInjectionTables`.
  - Runtime access: `getOrmEntities`, `getDiRegistrars`, `getModules`, `getCliModules`, `getEntityIds`, `getDashboardWidgets`, `getInjectionWidgets`, `getCoreInjectionWidgets`/`getCoreInjectionTables`.
  - Tests: use `bootstrapTest` from `@open-mercato/shared/lib/testing/bootstrap` to register only what the test needs.
- Widget injection is the preferred way to build inter-module UI extensions. Declare widgets under `src/modules/<module>/widgets/injection`, map them to slots via `widgets/injection-table.ts`, and keep metadata in colocated `*.meta.ts` files when needed. Avoid coupling modules directly—inject UI instead. Hosts expose consistent spot ids (`crud-form:<entityId>`, `data-table:<tableId>[:header|:footer]`, `admin.page:<path>:before|after`), and widgets can opt into grouped cards or tabs via `placement.kind`.
- Reuse the shared custom-field helpers from `packages/shared` (e.g., `splitCustomFieldPayload`, `normalizeCustomFieldValues`, `normalizeCustomFieldResponse`) instead of re-implementing cf_* parsing or normalization.
- When submitting CRUD forms, collect custom-field payloads via `collectCustomFieldValues()` from `@open-mercato/ui/backend/utils/customFieldValues` instead of ad-hoc loops. Pass `{ transform }` to normalize values (e.g., `normalizeCustomFieldSubmitValue`) and always reuse this helper for both `cf_` and `cf:` prefixed keys so forms stay consistent.
- Custom entities CRUD: follow the customers module API patterns (CRUD factory + query engine). Always wire custom field helpers for create/update/response normalization, and set `indexer: { entityType }` in `makeCrudRoute` so custom entities stay indexed and custom fields remain queryable.
- Command undo + custom fields: capture custom field snapshots inside the same `before`/`after` payloads (e.g., `snapshot.custom`) and restore via `buildCustomFieldResetMap(before.custom, after.custom)` in `undo`. Do not rely on `changes`/`changesJson` for restoration.
- Command side effects must include `indexer: { entityType, cacheAliases }` in both `emitCrudSideEffects` and `emitCrudUndoSideEffects` so undo refreshes the query index and caches (e.g., search indexes and derived caches).
- New admin pages and entities must use CRUD factory API routes and undoable commands, with custom fields fully supported in create/update/response flows. See customers examples: `packages/core/src/modules/customers/api/people/route.ts`, `packages/core/src/modules/customers/commands/people.ts`, `packages/core/src/modules/customers/backend/customers/people/page.tsx`.
- Database entities (MikroORM) live in `src/modules/<module>/data/entities.ts` (fallbacks: `db/entities.ts` or `schema.ts` for compatibility).
- Generators build (output to `apps/mercato/.mercato/generated/`):
  - `modules.generated.ts` (routes/APIs/CLIs + info; subscribers and workers included per module)
  - `entities.generated.ts` (MikroORM entities)
  - `di.generated.ts` (DI registrars)
  - `entities.ids.generated.ts` (entity ID registry)
  - `search.generated.ts` (search configurations)
  - Run `npm run modules:prepare` or rely on `predev`/`prebuild`.
- Query index coverage:
  - Every CRUD route that should emit index/refresh events must configure `indexer: { entityType }` in `makeCrudRoute` (see sales orders/lines/payments/shipments, catalog products, customer deals).
  - Partial coverage warnings in the UI mean the index is missing records—ensure the route has `indexer` enabled and rerun a reindex task if needed.
- Migrations (module-scoped with MikroORM):
  - Generate all modules: `npm run db:generate` (iterates modules, writes to `src/modules/<module>/migrations`)
  - Apply all modules: `npm run db:migrate` (ordered, directory first)
  - **Never hand-write migration files. Update the ORM entities first and let `npm run db:generate` emit the SQL so the snapshots stay in sync.**

## Database Naming
- Tables: plural snake_case (e.g., `users`, `user_roles`, `example_items`).
- Common columns: `id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id` when applicable.
- Prefer UUID PKs (`uuid`) and explicit FKs; use junction tables for many-to-many.

## Module Isomorphism Rules
- **NO direct relationships between modules**: Modules must remain isomorphic and independent.
- **NO @ManyToOne/@OneToMany relationships across modules**: Use foreign key IDs instead.
- **Fetch related data separately**: When you need data from another module, fetch it with separate queries using the foreign key IDs.
- **Example**: Instead of `user.tenant` relationship, use `user.tenantId` and fetch tenant separately with `em.findOne('Tenant', { id: user.tenantId })`.
- This ensures modules can be developed, tested, and deployed independently.

## Multi-tenant Rules
- Always include and filter by `organization_id` for tenant-scoped entities.
- Never expose cross-tenant data from API handlers.
- Authentication must attach organization context explicitly.

## Row-Level Security (RLS)
- RLS provides database-level tenant isolation as defense-in-depth. Even if application code omits a tenant filter, PostgreSQL policies block cross-tenant reads/writes.
- **Do NOT remove application-level `tenant_id` filtering**—keep both layers (defense-in-depth).
- Controlled by `RLS_ENABLED` env var (`true` to activate context setting; policies exist in the DB regardless).
- RLS policies are auto-synced: after every `dbMigrate()` run (and therefore `mercato init`), any new table with a `tenant_id` column automatically receives an `rls_tenant_isolation_<table>` policy.
- Manual sync: run `yarn mercato db rls-sync` (supports `--dry-run`).
- Context is set via `setRlsContext()` in CRUD factory `withCtx()`, `BasicQueryEngine`, and `HybridQueryEngine`.
- Spec: `.ai/specs/row-level-security.md`; helpers: `packages/shared/src/lib/db/rls.ts`, `packages/shared/src/lib/db/rls-sync.ts`.

## Security and Quality
- Validate all inputs with `zod`.
- Place validators next to entities (per module) in `src/modules/<module>/data/validators.ts`.
- Define create/update/input schemas and reuse from APIs, CLIs, and admin forms.
- Derive TypeScript types from zod via `z.infer<typeof schema>`.
- Use MikroORM EntityManager/repositories; never interpolate into SQL strings.
- Use DI (Awilix) to inject services; avoid new-ing classes directly in handlers.
- Hash passwords with `bcryptjs` (cost ≥10). Never log credentials.
- Return minimal error messages for auth (avoid revealing whether email exists).
- Always confirm the project still builds after your changes and surface build failures immediately.
- When encryption is enabled and populated relations lack tenant/org scope, run `findWithDecryption`/`findOneWithDecryption` from `packages/shared/src/lib/encryption/find.ts` (or `decryptEntitiesWithFallbackScope` for manual graphs) with the parent tenantId (and optional organizationId) so nested records are decrypted consistently. Actually its good to use these helpers instead of `em.find` and `em.findOne` just for safety

## Encryption
- Respect the feature flag: only encrypt/decrypt when tenant data encryption is enabled and the service is healthy.
- Prefer the helpers: use `findWithDecryption`/`findOneWithDecryption` (or `decryptEntitiesWithFallbackScope` for ad-hoc graphs) to decrypt populated relations that lack `tenant_id`/`organization_id`, passing the parent scope as fallback.
- Keep scopes explicit: always supply tenantId and, when available, organizationId to decryption helpers so cross-tenant leaks are avoided.
- Do not hand-roll AES/KMS calls; rely on `TenantDataEncryptionService` utilities and the shared helpers for custom fields and entities.
- Query index storage: keep `entity_indexes.doc` encrypted at rest; decrypt only on read. Use the centralized helpers in `packages/shared/src/lib/encryption/indexDoc.ts` (e.g. `decryptIndexDocCustomFields`, `decryptIndexDocForSearch`) instead of ad-hoc `cf:*` loops.
- Vector search storage: treat `vector_search.result_title` / `result_subtitle` / `result_icon` as encrypted at rest by default; decrypt only when presenting search hits (reuse the tenant encryption service, do not implement bespoke crypto).
- When you add an entity field that may contain personal or GDPR-relevant data, update the default encryption map for that entity (used by `mercato init` and `seed-encryption`) in `packages/core/src/modules/entities/lib/encryptionDefaults.ts`.

## Profiling
- Enable the tree profiler by exporting `OM_PROFILE` (or `NEXT_PUBLIC_OM_PROFILE` in the browser) with comma-separated filters (`*`, `all`, `customers.*`, etc.). Legacy flags (`OM_CRUD_PROFILE`, `OM_QE_PROFILE`) still work but should be avoided in new work.
- CRUD factories already emit `[crud:profile]` payloads; the query engine attaches its breakdown as a nested `query_engine` node when invoked from CRUD, so you only get one snapshot per profiled request.
- When you call the hybrid query engine directly (CLI/tests) you can still pass the profiler explicitly or rely on the same env flag to receive `[qe:profile]` entries.
- Treat profiler output as part of your acceptance checklist for slow paths—capture a snapshot before/after changes when tuning performance-heavy flows.

## Access control
- Prefer declarative guards in metadata: `requireAuth`, `requireRoles`, and `requireFeatures`.
- RBAC is two-layered: Role ACLs and User ACLs per tenant. Features are string-based and declared per module in `src/modules/<module>/acl.ts`.
- Use the DI `rbacService.userHasAllFeatures(userId, features, { tenantId, organizationId })` for server-side checks.
- Special flags: `isSuperAdmin` (all features), and optional organization visibility list to restrict org scope.

### Features
- Features are string-based permissions that control access to module functionality (e.g., `users.view`, `users.create`, `users.edit`, `users.delete`).
- **Every module MUST expose all its features in `src/modules/<module>/acl.ts`** by exporting a `features` array of strings.
- Feature naming convention: `<module>.<action>` (e.g., `example.view`, `example.create`, `example.edit`, `example.delete`).
- Features are assigned to roles and users through Role ACLs and User ACLs.
- Pages, APIs, and other protected resources use `requireFeatures` in their metadata to declare which features are required for access.
- The `acl.ts` file serves as the single source of truth for all features provided by a module, making it easy to audit and manage permissions.
- Example `acl.ts` structure:
  ```typescript
  export const features = [
    'example.view',
    'example.create',
    'example.edit',
    'example.delete',
  ];
  ```

### HTTP calls in UI
- In client components and utilities, call the higher-level helpers from `@open-mercato/ui/backend/utils/apiCall` (e.g., `apiCall`, `apiCallOrThrow`, `readApiResultOrThrow`) instead of the global `fetch`. They automatically wrap `apiFetch` so headers, auth, and error handling stay consistent—reach for `apiFetch` directly only when you truly need the raw `Response`.
- When showing fetch states in backend pages, use the shared `LoadingMessage` and `ErrorMessage` components from `@open-mercato/ui/backend/detail` so loading and failure cases stay consistent.
- For CRUD form submissions, call `createCrud` / `updateCrud` / `deleteCrud`; these already delegate to `raiseCrudError`, so you always get a structured error object with `message`, `details`, and `fieldErrors`.
- When you need to call ad-hoc endpoints, use `apiCall()` (or `apiCallOrThrow` / `readApiResultOrThrow`) which return `{ ok, status, result, response }`. They handle JSON parsing (via `readJsonSafe(res, fallback)`) and keep the `Response` instance intact for error propagation.
- The CRUD helpers now expose the parsed response (`const { result } = await createCrud<Payload>('module/resource', body)`); read data from the `result` field instead of cloning the response or calling `res.json()` yourself.
- `readJsonSafe(response, fallback)` accepts an optional fallback (default `null`) so callers never have to wrap parsing in `try/catch`. Pass explicit fallbacks when the UI needs defaults.
- When local validation needs to abort, throw `createCrudFormError(message, fieldErrors?)` from `@open-mercato/ui/backend/utils/serverErrors` instead of ad-hoc objects or strings.
- To read JSON bodies defensively, prefer `readJsonSafe(response)`—it never throws and keeps compatibility with older call-sites.
- Avoid swallowing response bodies (`res.json().catch(() => ({}))` or `await res.json().catch(() => null)`). Use the shared helpers so the error pipeline stays consistent.
- Keep request `pageSize` at or below 100 to respect API validation limits.

## Code Style
- Keep modules self-contained; re-use common utilities via `src/lib/`.
- No one-letter variable names.
- Avoid in-line comments; prefer self-documenting code.
- Keep exports minimal and typed.
- Avoid casting to `any`; prefer precise types and union narrowing with runtime checks. When in doubt, extract and reuse shared types instead of `any`.
- When parsing boolean-like strings (env/query/CLI), use `@open-mercato/shared/lib/boolean` (`parseBooleanToken`, `parseBooleanWithDefault`, `TRUE_VALUES`, `FALSE_VALUES`) instead of ad-hoc lists.
 - Prefer small, reusable libraries and utilities with minimal or no external dependencies where it makes sense.
 - Favor functional programming (pure functions, data-first utilities) over classes.
 - Write any necessary code comments in English.

## Internationalization
- Always add user-facing copy to the relevant locale files when introducing or modifying features.
- Keep locales in sync: update every supported language file, and add fallbacks only when the translation is genuinely unavailable.
- Run or document any required sync scripts so `src/modules/generated.ts` and other build artefacts stay aligned with locale updates.
- Avoid hard-coded strings; leverage the shared translation utilities in `packages/ui` to read from locale dictionaries.
- Client components can grab the translator with `useT` from `@open-mercato/shared/lib/i18n/context`:
  ```tsx
  import { useT } from '@open-mercato/shared/lib/i18n/context'

  export function LoginTitle() {
    const t = useT()
    return <h1>{t('auth.login.title')}</h1>
  }
  ```
- Server code can call `resolveTranslations()` or `createTranslator()` from `@open-mercato/shared/lib/i18n/server` to format copy before rendering:
  ```ts
  import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

  export async function getLoginLabels() {
    const { t } = await resolveTranslations()
    return { title: t('auth.login.title') }
  }
  ```

## UI Interaction
- Every new dialog must support `Cmd/Ctrl + Enter` as a primary action shortcut and `Escape` to cancel, mirroring the shared UX patterns used across modules.
- Default to `CrudForm` for new forms and `DataTable` for tables displaying information unless a different component is explicitly required.
- New CRUD forms should use `CrudForm` wired to CRUD factory/commands APIs and be shared between create/edit flows.
- Prefer reusing components from the shared `packages/ui` package before introducing new UI primitives.
- For new `DataTable` columns, set `meta.truncate` and `meta.maxWidth` in the column config when you need specific truncation behavior; only rely on defaults when those are not set.
- When you create new UI check reusable components before creating UI from scratch (see `.ai/specs/ui-reusable-components.md`)

### Type Safety Addendum
- Centralize reusable types and constants (e.g., custom field kinds) in `packages/shared` and import them everywhere to avoid drift.
- Do not introduce new `any`-typed APIs; define DTOs via zod schemas and `z.infer` for runtime + compile-time safety.
- If a helper requires dynamic behavior, expose narrow interfaces (e.g., `QueryEngine`) rather than passing `any`/`unknown`.

## What’s new (data model evolution)
- Keep modules separated and isomorphic: when extending another module’s data, add a separate extension entity and declare a link in `data/extensions.ts` (do not mutate core entities). Pattern mirrors Medusa’s module links.
- Custom fields: users can add/remove/modify fields per entity without schema forks. We store definitions and values in a dedicated `entities` module (EAV). A future admin UI will let users manage fields, and generic list/detail pages will consume them for filtering and forms.
- Query layer: access via DI (`queryEngine`) to fetch base entities with optional extensions and/or custom fields using a unified API for filtering, fields selection, pagination, and sorting.
  - Soft delete: entities should include `deleted_at timestamptz null`. The query engine excludes rows with non-null `deleted_at` by default; pass `withDeleted: true` to include them.
  - Request scoping helpers (`withScopedPayload`, `parseScopedCommandInput`, etc.) live in `packages/shared/src/lib/api/scoped.ts`. Import from there instead of redefining per module so tenants/organization enforcement stays consistent. Prefer `createScopedApiHelpers()` to tailor module-specific translations while keeping behaviour aligned.
- Catalog price selection, channel scoping, and layered overrides must use the helpers exported from `packages/core/src/modules/catalog/lib/pricing.ts`. Reuse `selectBestPrice`, `resolvePriceVariantId`, etc., instead of reimplementing scoring logic. If you need to customize the algorithm, register a resolver via `registerCatalogPricingResolver(resolver, { priority })` so your logic composes with the default `resolveCatalogPrice` pipeline. The helper now emits `catalog.pricing.resolve.before|after` events; reach for the DI token `catalogPricingService` when you need to resolve prices so overrides (event-driven or service swaps) take effect.
- Order/quote totals must be computed through the DI-provided `salesCalculationService`, which wraps the existing `salesCalculations` registry and dispatches `sales.line.calculate.*` / `sales.document.calculate.*` events. Never reimplement document math inline; register line/totals calculators or override the service via DI.
- When adding new module features in `acl.ts`, mirror them in the `mercato init` role seeding (see `packages/core/src/modules/auth/cli.ts`) so the default admin role ships with immediate access to the capabilities you just enabled.
- `ce.ts` files only describe custom entities or seed default custom-field sets. Always reference generated ids (`E.<module>.<entity>`) so system entities stay aligned with `generated/entities.ids.generated.ts`. System tables (e.g. catalog/sales documents) are auto-discovered from ORM metadata—exporting them in `ce.ts` is just for labeling/field seeding and will not register them as user-defined entities.

## Search Module Configuration
- **Every module with searchable entities MUST provide a `search.ts` file** at `src/modules/<module>/search.ts` or `packages/<package>/src/modules/<module>/search.ts`.
- The search config is auto-discovered by generators and registered via `generated/search.generated.ts`.
- Export a `searchConfig` (or default export) of type `SearchModuleConfig` from `@open-mercato/shared/modules/search`.

### Search Config Structure
```typescript
// src/modules/<module>/search.ts
import type { SearchModuleConfig, SearchBuildContext } from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'your_module:your_entity',  // Must match entity registry
      enabled: true,
      priority: 10,  // Higher = appears first in mixed results

      // FOR VECTOR SEARCH: buildSource generates text for embeddings
      buildSource: async (ctx: SearchBuildContext) => ({
        text: [`Name: ${ctx.record.name}`, `Description: ${ctx.record.description}`],
        presenter: { title: ctx.record.name, subtitle: ctx.record.status, icon: 'lucide:file' },
      }),

      // FOR MEILISEARCH: fieldPolicy controls full-text indexing
      fieldPolicy: {
        searchable: ['name', 'description'],  // Indexed for full-text
        hashOnly: ['email'],                   // Hashed, not searchable
        excluded: ['password'],                // Never indexed
      },

      // Optional: Custom presenter formatting for search results
      formatResult: async (ctx: SearchBuildContext) => ({
        title: ctx.record.name,
        subtitle: ctx.record.status,
        icon: 'lucide:user',
      }),

      // Optional: Primary URL for the record
      resolveUrl: async (ctx: SearchBuildContext) => `/backend/your-module/${ctx.record.id}`,
    },
  ],
}

export default searchConfig
```

### Search Strategies and Configuration Mapping

| Strategy | Indexing Config | Presenter Config | Use Case |
|----------|----------------|------------------|----------|
| `fulltext` | `fieldPolicy` | Stored in index | Fast, typo-tolerant full-text search |
| `vector` | `buildSource` | `buildSource.presenter` | Semantic/AI-powered search via embeddings |
| `tokens` | Automatic | `formatResult` | Exact keyword matching (PostgreSQL) |

#### Fulltext Strategy
Uses `fieldPolicy` to control which fields are indexed. Presenter is stored directly in the fulltext index during indexing.
```typescript
fieldPolicy: {
  searchable: ['name', 'description'],  // Indexed and searchable
  hashOnly: ['email'],                   // Hashed for exact match only
  excluded: ['password'],                // Never indexed
}
```

#### Vector Strategy
Uses `buildSource` to generate text for embeddings. Presenter is returned from `buildSource` and stored alongside vectors.
```typescript
buildSource: async (ctx) => ({
  text: [`Name: ${ctx.record.name}`],  // Text to embed
  presenter: { title: ctx.record.name, subtitle: ctx.record.status },
})
```

#### Tokens (Keyword) Strategy
Indexes automatically from `entity_indexes` table. **Presenter is resolved at search time** using `formatResult` from search.ts config. If no config exists, falls back to extracting common fields (`display_name`, `name`, `title`, etc.) from the indexed document.
```typescript
// Configure presenter for token/keyword search results
formatResult: async (ctx: SearchBuildContext) => ({
  title: ctx.record.display_name ?? ctx.record.name,
  subtitle: ctx.record.email ?? ctx.record.status,
  icon: 'lucide:user',
  badge: 'Customer',
}),
```

**Important:** For entities that only use token search (no fulltext/vector), you MUST define `formatResult` to display meaningful titles instead of raw UUIDs in Cmd+K results.
Recommendation: when introducing new entities, add a search presenter (`formatResult` or `buildSource.presenter`) so results are human-friendly; see `packages/core/src/modules/customers/search.ts` for an example.

### Running Search Queue Workers
For production with `QUEUE_STRATEGY=async`, start workers in separate processes:
```bash
# Full-text indexing worker
yarn mercato search worker fulltext-indexing --concurrency=5

# Vector embedding indexing worker
yarn mercato search worker vector-indexing --concurrency=10
```

For development with `QUEUE_STRATEGY=local`, jobs are processed from `.queue/` automatically.

### Useful CLI Commands
```bash
yarn mercato search status                 # Check search module status and available strategies
yarn mercato search reindex --tenant <id>  # Trigger reindex for all strategies
yarn mercato search query -q "term" --tenant <id>  # Test search
```

See `packages/search/src/modules/search/README.md` for full documentation.

## AI Assistant Module

### MCP Server Modes

The AI Assistant provides two MCP HTTP server modes:

#### Development Server (`yarn mcp:dev`)
For local development and Claude Code integration. Authenticates once at startup using an API key - no session tokens required per request.

```bash
# Reads API key from .mcp.json headers.x-api-key or OPEN_MERCATO_API_KEY env
yarn mcp:dev
```

**Configuration (`.mcp.json`):**
```json
{
  "mcpServers": {
    "open-mercato": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "x-api-key": "omk_your_api_key_here"
      }
    }
  }
}
```

**Environment variables:**
- `OPEN_MERCATO_API_KEY` - API key (alternative to .mcp.json)
- `MCP_DEV_PORT` - Port (default: 3001)
- `MCP_DEBUG` - Enable debug logging (`true`/`false`)

#### Production Server (`yarn mcp:serve`)
For web-based AI chat. Requires two-tier authentication: server API key + user session tokens.

```bash
# Requires MCP_SERVER_API_KEY in .env
yarn mcp:serve
```

**Environment variables:**
- `MCP_SERVER_API_KEY` - Required. Static API key for server-level auth.

#### Comparison

| Feature | Dev (`mcp:dev`) | Production (`mcp:serve`) |
|---------|-----------------|-------------------------|
| Auth | API key only | API key + session tokens |
| Permission check | Once at startup | Per tool call |
| Session tokens | Not required | Required (`_sessionToken`) |
| Use case | Claude Code, local dev | Web AI chat interface |

### Session Management
- Chat sessions use ephemeral API keys that inherit the user's permissions.
- Session tokens are created when a new chat starts and expire after **2 hours** of inactivity.
- When a session expires, tool calls return a `SESSION_EXPIRED` error with a user-friendly message.
- The AI will receive: `"Your chat session has expired. Please close and reopen the chat window to continue."`
- The AI should relay this message naturally to the user without mentioning technical details like tokens.

### MCP CLI Commands

```bash
# Run development server (Claude Code / local dev)
yarn mcp:dev

# Run production server (web AI chat)
yarn mcp:serve

# List all available MCP tools
yarn mercato ai_assistant mcp:list-tools

# List tools with descriptions
yarn mercato ai_assistant mcp:list-tools --verbose
```

### Key Files
- Dev server: `packages/ai-assistant/src/modules/ai_assistant/lib/mcp-dev-server.ts`
- Production server: `packages/ai-assistant/src/modules/ai_assistant/lib/http-server.ts`
- Session creation: `packages/ai-assistant/src/modules/ai_assistant/api/chat/route.ts`
- Session validation: `packages/ai-assistant/src/modules/ai_assistant/lib/http-server.ts`
- API key service: `packages/core/src/modules/api_keys/services/apiKeyService.ts`
- CLI commands: `packages/ai-assistant/src/modules/ai_assistant/cli.ts`
