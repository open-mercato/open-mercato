# Agents Guidelines

This repository is designed for extensibility. Agents should leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Workflow Orchestration

### 1. Specification and plan before coding

- Enter plan mode for non-trivial task (3+ steps or architectural decisions); if the task is to make the Specification - you skip the plan mode and start writing the specification directly to the file in the `.ai/specs` (details how to name file etc below),
- if there's a existing and comprehensive specification file you can skip the plan mode and get to development mode,
- new features should follow the specification file created in the planning phase, this step could be skipped for small improvements (no architecutre decisions, less than 3 steps) or bug fixes
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity
- Save context - load only these specification file that is related to the current task at hand or required for it to finish

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-improvement Loop

- After ANY correction from the user: update specification file or `.ai/lessons.md` if it's something more general with the pattern
- Write rules for yourself that prevent the same mistake and suggest updates to `AGENTS.md` files
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Suggest user to verify the task completenes by proving it works:
  - Diff behavior between main and your changes when relevant
  - Ask yourself: "Would a staff engineer approve this?"
  - Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes – don't over-engineer
- Challenge your own work before presenting it
- Follow Open Mercato principles, design patterns and other rules defined in this file

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how


## Documentation and Specifications

Architecture Decision Records (ADRs) and feature specifications are maintained in the `.ai/specs/` folder. This serves as the source of truth for design decisions and module specifications. Save context size and load only these specs that are related to and required to finish the task at hand.

### Spec Files

- **Naming convention**: `SPEC-{number}-{date}-{title}.md` (e.g., `SPEC-003-2026-01-23-notifications-module.md`)
- **Number**: Sequential identifier (001, 002, 003, etc.)
- **Date**: Creation date in ISO format (YYYY-MM-DD)
- **Title**: Descriptive kebab-case title
- Each spec documents the module's purpose, architecture, API contracts, data models, and implementation details.
- Specs should include a **Changelog** section at the bottom to track evolution over time.
- See [`.ai/specs/README.md`](.ai/specs/README.md) for the full specification directory.

### When Developing Features

1. **Before coding**: Check if a spec exists for the module you're modifying. Browse [`.ai/specs/README.md`](.ai/specs/README.md) or search for `SPEC-*-{module-name}.md` files.
2. **When adding features**: Update the corresponding spec file with:
   - New functionality description
   - API changes
   - Data model updates
   - A changelog entry with date and summary
3. **When creating new modules**: Create a new spec file at `.ai/specs/SPEC-{next-number}-{YYYY-MM-DD}-{module-name}.md` before or alongside implementation, and update the directory table in [`.ai/specs/README.md`](.ai/specs/README.md).

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
- Update the spec directory table in [`.ai/specs/README.md`](.ai/specs/README.md) when creating new specs

This ensures the `.ai/specs/` folder remains a reliable reference for understanding module behavior and history.

## Task Management

1. **Plan First**: Write or update the plan in the specification file
2. **Verify Plans**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to specification file
6. **Capture Lessons**: Update `.ai/lessons.md` after corrections if there's a general rule that will let us save time fixing things in the future.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

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

## Standalone Applications

### What is a Standalone App?

A **standalone app** is a separate Next.js application created outside the monorepo that uses Open Mercato packages installed from npm (or a local registry like Verdaccio). This is how end users consume Open Mercato - they run `npx create-mercato-app my-app` to scaffold a new project.

**Key differences from monorepo development:**

| Aspect | Monorepo | Standalone App |
|--------|----------|----------------|
| Package source | Local workspace (`packages/`) | npm registry or Verdaccio |
| Package format | TypeScript source (`src/`) | Compiled JavaScript (`dist/`) |
| Generators read from | `src/modules/*.ts` | `dist/modules/*.js` |
| Module location | `apps/mercato/src/modules/` | `src/modules/` (app root) |

**Standalone app structure:**
```
my-app/
├── src/
│   └── modules/           # User's custom modules (.ts files)
│       └── example/
├── node_modules/
│   └── @open-mercato/     # Installed packages (compiled .js)
│       ├── core/
│       ├── shared/
│       └── ...
├── .mercato/
│   └── generated/         # Generated files from CLI
└── package.json
```

### Testing with Verdaccio

Verdaccio is a lightweight npm registry that allows testing package publishing locally before releasing to npm.

#### 1. Start Verdaccio

```bash
# Start Verdaccio using docker-compose
docker compose up -d verdaccio
```

Configuration is at `config/verdaccio/config.yaml`.

#### 2. Setup Registry User

```bash
# Create a user for publishing (use any username/password, e.g., test/test)
yarn registry:setup-user
```

#### 3. Build and Publish Packages

```bash
# Build and publish all packages to Verdaccio
yarn registry:publish
```

This script (`scripts/registry/publish.sh`) handles everything:
- Verifies Verdaccio is running
- Unpublishes existing versions (allows republishing same version)
- Builds all packages with `yarn build:packages`
- Publishes each package in correct dependency order

#### 4. Create and Test Standalone App

```bash
# Create new app (uses packages from Verdaccio)
npx --registry http://localhost:4873 create-mercato-app@latest my-test-app
cd my-test-app

# Start database, install, initialize, and run
docker compose up -d
yarn install
yarn initialize
yarn dev
```

#### 5. Testing Workflow

When making changes to packages:

```bash
# 1. Make changes in monorepo packages

# 2. Republish to Verdaccio
yarn registry:publish

# 3. In standalone app, reinstall and test
cd /path/to/my-test-app
rm -rf node_modules .next
yarn install
yarn dev
```

#### Canary Releases

For testing unreleased changes without bumping versions:

```bash
# Publish canary version (includes commit hash)
./scripts/release-canary.sh

# Creates version like: 0.4.2-canary-abc1234567
# Test with:
npx create-mercato-app@0.4.2-canary-abc1234567 my-test-app
```

#### Cleanup

```bash
# Reset npm registry
npm config delete @open-mercato:registry

# Stop Verdaccio
docker stop verdaccio && docker rm verdaccio
```

### Important Considerations for Package Development

1. **Type declarations must be available**: Packages export types from `src/` but runtime code from `dist/`. Ensure `@types/*` dependencies needed by source files are in `dependencies` (not `devDependencies`) so they're installed in standalone apps.

2. **Generators read compiled files**: In standalone apps, CLI generators scan `node_modules/@open-mercato/*/dist/modules/` for `.js` files. Ensure packages are built before publishing.

3. **Test both environments**: Always test changes in both monorepo (`yarn dev`) and standalone app (via Verdaccio) before releasing.

4. **Build order matters**: The correct build sequence is:
   ```bash
   yarn build:packages   # Build packages first (CLI needs this)
   yarn generate         # Run generators
   yarn build:packages   # Rebuild with generated files
   ```

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
- Optional setup at `src/modules/<module>/setup.ts` exporting `setup` (see [Module Setup Convention](#module-setup-convention) below)
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
  - Generated files: `modules.generated.ts`, `entities.generated.ts`, `di.generated.ts`, `entities.ids.generated.ts`, `dashboard-widgets.generated.ts`, `injection-widgets.generated.ts`, `injection-tables.generated.ts`, `search.generated.ts`, `ai-tools.generated.ts`, `modules.cli.generated.ts`
  - Bootstrap registration: `registerOrmEntities`, `registerDiRegistrars`, `registerModules`/`registerCliModules`, `registerEntityIds`, `registerDashboardWidgets`, `registerInjectionWidgets`, `registerCoreInjectionWidgets`/`registerCoreInjectionTables`.
  - Runtime access: `getOrmEntities`, `getDiRegistrars`, `getModules`, `getCliModules`, `getEntityIds`, `getDashboardWidgets`, `getInjectionWidgets`, `getCoreInjectionWidgets`/`getCoreInjectionTables`.
  - Tests: use `bootstrapTest` from `@open-mercato/shared/lib/testing/bootstrap` to register only what the test needs.
- Widget injection is the preferred way to build inter-module UI extensions. Declare widgets under `src/modules/<module>/widgets/injection`, map them to slots via `widgets/injection-table.ts`, and keep metadata in colocated `*.meta.ts` files when needed. Avoid coupling modules directly—inject UI instead. Hosts expose consistent spot ids (`crud-form:<entityId>`, `data-table:<tableId>[:header|:footer]`, `admin.page:<path>:before|after`), and widgets can opt into grouped cards or tabs via `placement.kind`.
- **Notifications**: Modules can define notification types and custom UI renderers for in-app notifications.
  - **Notification types**: Declare in `src/modules/<module>/notifications.ts` exporting `notificationTypes: NotificationTypeDefinition[]`. Auto-discovered by the generator and aggregated into `notifications.generated.ts`.
  - **Notification subscribers**: Create event subscribers in `src/modules/<module>/subscribers/` to emit notifications when domain events occur (e.g., `sales.order.created`).
  - **Custom notification renderers** (client-side): Declare in `src/modules/<module>/notifications.client.ts` with React component renderers. Store renderer components in `src/modules/<module>/widgets/notifications/`.
  - **File structure example** (sales module):
    ```
    packages/core/src/modules/sales/
    ├── notifications.ts                    # Server-side type definitions (for generator)
    ├── notifications.client.ts             # Client-side types with Renderer components
    ├── subscribers/
    │   ├── order-created-notification.ts   # Subscribes to sales.order.created
    │   └── quote-created-notification.ts   # Subscribes to sales.quote.created
    └── widgets/
        └── notifications/
            ├── index.ts
            ├── SalesOrderCreatedRenderer.tsx
            └── SalesQuoteCreatedRenderer.tsx
    ```
  - **i18n**: Add notification-related translations to `src/modules/<module>/i18n/<locale>.json` under `<module>.notifications.*` keys.
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
- When you create new UI check reusable components before creating UI from scratch (see [`.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md`](.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md))
- For form/detail page headers and footers, use `FormHeader` and `FormFooter` from `@open-mercato/ui/backend/forms`. `FormHeader` supports two modes: `edit` (compact, used automatically by CrudForm) and `detail` (large title with entity type label, status badge, Actions dropdown). Delete/Cancel/Save are always standalone buttons; additional context actions (Convert, Send, etc.) go into the `menuActions` array rendered as an "Actions" dropdown. See [SPEC-016](.ai/specs/SPEC-016-2026-02-03-form-headers-footers.md) for full API.

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
- When adding new module features in `acl.ts`, also declare them in `setup.ts` `defaultRoleFeatures` so the admin/employee roles are automatically seeded with those features during tenant creation (see [Module Setup Convention](#module-setup-convention)).
- `ce.ts` files only describe custom entities or seed default custom-field sets. Always reference generated ids (`E.<module>.<entity>`) so system entities stay aligned with `generated/entities.ids.generated.ts`. System tables (e.g. catalog/sales documents) are auto-discovered from ORM metadata—exporting them in `ce.ts` is just for labeling/field seeding and will not register them as user-defined entities.

## Module Setup Convention

Every module that participates in tenant initialization **must** declare a `setup.ts` file at its root (`src/modules/<module>/setup.ts`). The generator auto-discovers these files and includes them in `modules.generated.ts`. This is the mechanism that keeps modules decoupled — no module should be hardcoded in `setup-app.ts`, `mercato init`, or onboarding flows.

See [SPEC-013](.ai/specs/SPEC-013-2026-01-27-decouple-module-setup.md) for the full architecture decision record.

### Type definition

The `ModuleSetupConfig` type is defined in `packages/shared/src/modules/setup.ts`:

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
```

### The `setup.ts` contract

```typescript
// src/modules/<module>/setup.ts
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  // 1. Declarative: which features each default role gets
  defaultRoleFeatures: {
    superadmin: ['my_module.admin_only_feature'],
    admin: ['my_module.*'],
    employee: ['my_module.view'],
  },

  // 2. Called inside setupInitialTenant() after tenant/org is created.
  //    For lightweight structural defaults: settings rows, numbering sequences.
  //    Must be idempotent. Always runs.
  async onTenantCreated({ em, tenantId, organizationId }) {
    // Seed settings, sequences, or config rows
  },

  // 3. Called during mercato init / onboarding after tenant exists.
  //    For reference data: dictionaries, tax rates, statuses, units.
  //    Always runs (not gated by --no-examples).
  async seedDefaults({ em, tenantId, organizationId, container }) {
    // Seed structural/reference data
  },

  // 4. Called during mercato init / onboarding ONLY when examples are requested.
  //    For demo data: sample products, customers, orders.
  async seedExamples({ em, tenantId, organizationId, container }) {
    // Seed example/demo data
  },
}

export default setup
```

### Lifecycle hooks

| Hook | When it runs | Gate | Use case |
|------|-------------|------|----------|
| `onTenantCreated` | Inside `setupInitialTenant()`, after tenant+org created | Always | Settings rows, numbering sequences, lightweight config |
| `seedDefaults` | After tenant setup, during init/onboarding | Always | Dictionaries, tax rates, statuses, units, address types |
| `seedExamples` | After `seedDefaults`, during init/onboarding | Skipped with `--no-examples` | Demo products, customers, orders |
| `defaultRoleFeatures` | Declarative, merged during `ensureDefaultRoleAcls()` | Always | Role ACL feature assignments |

### When to create a `setup.ts`

Create a `setup.ts` when your module needs any of the following:
- **Default role features** — the admin/employee/superadmin roles should have access to your module's features after tenant creation.
- **Tenant initialization** — your module needs settings, sequences, or config rows created when a new tenant is provisioned.
- **Structural seed data** — your module has reference data (dictionaries, statuses, units) that every tenant needs.
- **Example data** — your module can provide demo data for new installs.

### Keeping modules decoupled

The `setup.ts` convention replaces hardcoded imports in `setup-app.ts`, `mercato init`, and onboarding verify. Follow these rules:

1. **Never hardcode module-specific logic in `setup-app.ts`**. If a module needs initialization, add it to that module's `setup.ts`.
2. **Never directly import another module's seed functions** from `mercato init` or onboarding. The `seedDefaults`/`seedExamples` hooks handle this automatically.
3. **Access entity IDs with optional chaining** when referencing other modules: `(E as any).catalog?.catalog_product`. This ensures the code doesn't crash if the referenced module is disabled.
4. **Use `getEntityIds()` at runtime** (not import-time) when building lookups that reference other modules' entities. This allows the code to adapt to which modules are enabled.

### Adding features to default roles

When you add new features in `acl.ts`, also add them to `setup.ts` `defaultRoleFeatures`:

```typescript
// acl.ts
export const features = [
  { id: 'my_module.view', title: 'View items', module: 'my_module' },
  { id: 'my_module.manage', title: 'Manage items', module: 'my_module' },
]

// setup.ts
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['my_module.*'],
    employee: ['my_module.view'],
  },
}
```

This replaces the old pattern of editing `setup-app.ts` to add features to the hardcoded role arrays.

### Testing with disabled modules

The module-decoupling test (`packages/core/src/__tests__/module-decoupling.test.ts`) verifies that the app works when optional modules are disabled. When writing tests that depend on the module registry:

```typescript
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

// Register modules before test runs
const testModules: Module[] = [
  { id: 'auth', setup: { defaultRoleFeatures: { admin: ['auth.*'] } } },
  // ... other modules your test needs
]
registerModules(testModules)
```

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
For local development and Claude Code integration. Authenticates once at startup using an API key from `.mcp.json` - no session tokens required per request.

```bash
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
- Tool loader: `packages/ai-assistant/src/modules/ai_assistant/lib/tool-loader.ts`

### Module AI Tools

Modules can expose AI tools via MCP by creating an `ai-tools.ts` file. Tools are **auto-discovered** by the generator - no manual registration required.

**File location**: `src/modules/<module>/ai-tools.ts` (for packages: `packages/<package>/src/modules/<module>/ai-tools.ts`)

**Structure**:
```typescript
import { z } from 'zod'
import type { AiToolDefinition } from '@open-mercato/ai-assistant'

export const aiTools: AiToolDefinition[] = [
  {
    name: 'module_action',          // No dots allowed, use underscores
    description: 'What this tool does',
    inputSchema: z.object({
      param: z.string().describe('Parameter description'),
    }),
    requiredFeatures: ['module.feature'],  // ACL features required
    handler: async (input, ctx) => {
      const service = ctx.container.resolve('myService')
      return { success: true }
    },
  },
]
```

**Registration flow**:
1. Create `ai-tools.ts` in your module
2. Run `npm run modules:prepare` (generates `ai-tools.generated.ts`)
3. Tools are automatically loaded at MCP server startup

**Generated file**: `apps/mercato/.mercato/generated/ai-tools.generated.ts`

**Example**: See `packages/search/src/modules/search/ai-tools.ts` for search-related tools.

### MCP Tools Reference

The AI assistant exposes 4 core tools via MCP for understanding and interacting with the system:

#### `entity_context` - Get full context for an entity

Use when you need to understand a database entity (fields, relationships, API endpoints).

**Input:** `{ "entity": "SalesOrder" }`

**Output:**
- `entity.fields` - All columns with types and nullability
- `relationships` - Array of triples: `(Entity)-[TYPE:property]->(Target)`
- `endpoints` - CRUD operations with paths and operationIds

**Example usage:**
```
"I need to create a sales order"
-> Call entity_context("SalesOrder")
-> Get fields + POST endpoint
-> Call api_execute with the endpoint
```

#### `schema_overview` - Discover entities and relationships

Use for high-level exploration: what entities exist, how they relate.

**Input:**
- `{ }` - Get all entities grouped by module
- `{ "module": "sales" }` - Filter to one module
- `{ "includeGraph": true }` - Include relationship triples

**Output:**
- `stats` - Total entities, relationships, modules
- `entities` - Entities grouped by module
- `graph` - Relationship triples (if requested)

**Example usage:**
```
"What entities are in the sales module?"
-> Call schema_overview({ module: "sales" })
```

#### `api_discover` - Search API endpoints

Use to find endpoints by natural language query. Returns schema summary.

**Input:** `{ "query": "create order", "method": "POST" }`

**Output:** Matching endpoints with:
- `path`, `method`, `operationId`
- `requestBody` - Schema with required fields and types

**Example usage:**
```
"How do I update a customer?"
-> Call api_discover({ query: "update customer" })
```

#### `api_execute` - Call an API endpoint

Use to execute API operations after discovering the endpoint.

**Input:**
```json
{
  "method": "POST",
  "path": "/api/sales/orders",
  "body": { "customerId": "...", "lines": [...] }
}
```

**Workflow pattern:**
1. `entity_context` or `api_discover` -> understand the API
2. `api_execute` -> make the call

### Relationship Triple Format

Relationships are always expressed as triples:
```
(SourceEntity)-[RELATIONSHIP_TYPE:propertyName]->(TargetEntity)
```

Types:
- `BELONGS_TO` - ManyToOne (e.g., OrderLine belongs to Order)
- `HAS_MANY` - OneToMany (e.g., Order has many Lines)
- `HAS_ONE` - OneToOne owner
- `BELONGS_TO_ONE` - OneToOne inverse
- `HAS_MANY_MANY` / `BELONGS_TO_MANY` - ManyToMany

The `?` suffix indicates nullable: `(Order)-[BELONGS_TO?:channel]->(Channel)`

## Event Module Configuration

Modules that emit events must declare them in an `events.ts` file for type safety, runtime validation, and workflow trigger discovery.

### Creating Module Events

**File**: `src/modules/<module>/events.ts`

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'customers.people.created', label: 'Customer (Person) Created', entity: 'people', category: 'crud' },
  { id: 'customers.people.updated', label: 'Customer (Person) Updated', entity: 'people', category: 'crud' },
  { id: 'customers.people.deleted', label: 'Customer (Person) Deleted', entity: 'people', category: 'crud' },
  // Lifecycle events can be excluded from workflow triggers
  { id: 'customers.pricing.resolve.before', label: 'Before Pricing Resolve', category: 'lifecycle', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'customers',
  events,
})

// Export typed emit function for use in commands
export const emitCustomersEvent = eventsConfig.emit

// Export event IDs as a type for external use
export type CustomersEventId = typeof events[number]['id']

export default eventsConfig
```

### Event Definition Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Event identifier (pattern: `module.entity.action`) |
| `label` | Yes | Human-readable label for UI |
| `description` | No | Optional detailed description |
| `category` | No | `'crud'` \| `'lifecycle'` \| `'system'` \| `'custom'` |
| `entity` | No | Associated entity name |
| `excludeFromTriggers` | No | If `true`, hidden from workflow trigger selection |

### TypeScript Enforcement

Using `as const` with the events array provides compile-time safety:

```typescript
// ✅ Compiles - event is declared
emitCustomersEvent('customers.people.created', { id: '123', tenantId: 'abc' })

// ❌ TypeScript error - event not declared
emitCustomersEvent('customers.people.exploded', { id: '123' })
```

### Runtime Validation

Undeclared events trigger runtime warnings:
```
[events] Module "customers" tried to emit undeclared event "customers.people.exploded".
Add it to the module's events.ts file first.
```

### Auto-Discovery

Events are auto-discovered by generators and registered via `generated/events.generated.ts`. Run `npm run modules:prepare` after creating or modifying `events.ts` files.

### UI Integration

Use the `EventSelect` component from `@open-mercato/ui/backend/inputs/EventSelect` for event selection. It fetches declared events via the `/api/events` endpoint.
