# Agents Guidelines

Leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Before Writing Code

1. Check the Task Router below — a single task may match multiple rows; read **all** relevant guides.
2. Check `.ai/specs/` and `.ai/specs/enterprise/` for existing specs on the module you're modifying
3. Enter plan mode for non-trivial tasks (3+ steps or architectural decisions)
4. Identify the reference module (customers) if building CRUD features

## Task Router — Where to Find Detailed Guidance

IMPORTANT: Before any research or coding, match the task to the root `AGENTS.md` Task Router table. A single task often maps to **multiple rows** — for example, "add a new module with search" requires both the Module Development and Search guides. Read **all** matching guides before starting. They contain the imports, patterns, and constraints you need. Only use Explore agents for topics not covered by any existing AGENTS.md.

| Task | Guide |
|------|-------|
| **Module Development** | |
| Creating a new module, scaffolding module files, auto-discovery paths | `packages/core/AGENTS.md` |
| Building CRUD API routes, adding OpenAPI specs, using `makeCrudRoute`, query engine integration | `packages/core/AGENTS.md` → API Routes |
| Adding `setup.ts` for tenant init, declaring role features, seeding defaults/examples | `packages/core/AGENTS.md` → Module Setup |
| Declaring typed events with `createModuleEvents`, emitting CRUD/lifecycle events, adding event subscribers | `packages/core/AGENTS.md` → Events |
| Adding in-app notifications, subscriber-based alerts, writing notification renderers | `packages/core/AGENTS.md` → Notifications |
| Injecting UI widgets into other modules, defining spot IDs, cross-module UI extensions | `packages/core/AGENTS.md` → Widgets |
| Adding custom fields/entities, using DSL helpers (`defineLink`, `cf.*`), declaring `ce.ts` | `packages/core/AGENTS.md` → Custom Fields |
| Adding entity extensions, cross-module data links, `data/extensions.ts` | `packages/core/AGENTS.md` → Extensions |
| Configuring RBAC features in `acl.ts`, declarative guards, permission checks | `packages/core/AGENTS.md` → Access Control |
| Using encrypted queries (`findWithDecryption`), encryption defaults, GDPR fields | `packages/core/AGENTS.md` → Encryption |
| **Specific Modules** | |
| Managing people/companies/deals/activities, **copying CRUD patterns for new modules** | `packages/core/src/modules/customers/AGENTS.md` |
| Building orders/quotes/invoices, pricing calculations, document flow (Quote→Order→Invoice), shipments/payments, channel scoping | `packages/core/src/modules/sales/AGENTS.md` |
| Managing products/categories/variants, pricing resolvers (`selectBestPrice`), offers, channel-scoped pricing, option schemas | `packages/core/src/modules/catalog/AGENTS.md` |
| Users/roles/RBAC implementation, authentication flow, session management, feature-based access control | `packages/core/src/modules/auth/AGENTS.md` |
| Multi-currency support, exchange rates, dual currency recording, realized gains/losses | `packages/core/src/modules/currencies/AGENTS.md` |
| Workflow automation, defining step-based workflows, executing instances, user tasks, async activities, event triggers, signals, compensation (saga pattern), visual editor | `packages/core/src/modules/workflows/AGENTS.md` |
| **Packages** | |
| Adding reusable utilities, encryption helpers, i18n translations (`useT`/`resolveTranslations`), boolean parsing, data engine types, request scoping | `packages/shared/AGENTS.md` |
| Building forms (`CrudForm`), data tables (`DataTable`), loading/error states, flash messages, `FormHeader`/`FormFooter`, dialog UX (`Cmd+Enter`/`Escape`) | `packages/ui/AGENTS.md` |
| Backend page components, `apiCall` usage, `RowActions` ids, `LoadingMessage`/`ErrorMessage` | `packages/ui/src/backend/AGENTS.md` |
| Configuring fulltext/vector/token search, writing `search.ts`, reindexing entities, debugging search, search CLI commands | `packages/search/AGENTS.md` |
| Adding MCP tools (`registerMcpTool`), modifying OpenCode config, debugging AI chat, session tokens, command palette, two-tier auth | `packages/ai-assistant/AGENTS.md` |
| Running generators (`yarn generate`), creating database migrations (`yarn db:generate`), scaffolding modules, build order | `packages/cli/AGENTS.md` |
| Event bus architecture, ephemeral vs persistent subscriptions, queue integration for events, event workers | `packages/events/AGENTS.md` |
| Adding cache to a module, tag-based invalidation, tenant-scoped caching, choosing strategy (memory/SQLite/Redis) | `packages/cache/AGENTS.md` |
| Adding background workers, configuring concurrency (I/O vs CPU-bound), idempotent job processing, queue strategies | `packages/queue/AGENTS.md` |
| Adding onboarding wizard steps, tenant setup hooks (`onTenantCreated`/`seedDefaults`), welcome/invitation emails | `packages/onboarding/AGENTS.md` |
| Adding static content pages (privacy policies, terms, legal pages) | `packages/content/AGENTS.md` |
| Testing standalone apps with Verdaccio, publishing packages, canary releases, template scaffolding | `packages/create-app/AGENTS.md` |
| **Testing** | |
| Integration testing, creating/running Playwright tests, converting markdown test cases to TypeScript, CI test pipeline | `.ai/qa/AGENTS.md` + `.ai/skills/integration-tests/SKILL.md` |
| **Other** | |
| Writing new specs, updating existing specs after implementation, documenting architectural decisions, maintaining changelogs | `.ai/specs/AGENTS.md` |

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Workflow Orchestration

1.  **Spec-first**: Enter plan mode for non-trivial tasks (3+ steps or architectural decisions). Check `.ai/specs/` and `.ai/specs/enterprise/` before coding; create SPEC files using scope-appropriate naming (`SPEC-{number}-{date}-{title}.md` for OSS, `SPEC-ENT-{number}-{date}-{title}.md` for enterprise). Skip for small fixes.
    -   **Detailed Workflow**: Refer to the **`spec-writing` skill** for research, phasing, and architectural review standards (`.ai/skills/spec-writing/SKILL.md`).
2.  **Subagent strategy**: Use subagents liberally to keep main context clean. Offload research and parallel analysis. One task per subagent.
3.  **Self-improvement**: After corrections, update `.ai/lessons.md` or relevant AGENTS.md. Write rules that prevent the same mistake.
4.  **Verification**: Run tests, check build, suggest user verification. Ask: "Would a staff engineer approve this?"
5.  **Elegance**: For non-trivial changes, pause and ask "is there a more elegant way?" Skip for simple fixes.
6.  **Autonomous bug fixing**: When given a bug report, just fix it. Point at logs/errors, then resolve. Zero hand-holding.

### Documentation and Specifications

- OSS specs live in `.ai/specs/`; commercial/enterprise specs live in `.ai/specs/enterprise/` — see `.ai/specs/AGENTS.md` for naming, structure, and changelog conventions.
- Always check for existing specs before modifying a module. Update specs when implementing significant changes.
- For every new feature, the spec MUST list integration coverage for all affected API paths and key UI paths.
- For every new feature, implement the integration tests defined in the spec as part of the same change — see `.ai/qa/AGENTS.md` for the workflow.
- Integration tests MUST be self-contained: create required fixtures in test setup (prefer API fixtures), clean up created records in teardown/finally, and remain stable without relying on seeded/demo data.

## Monorepo Structure

### Apps (`apps/`)

-   **mercato**: Main Next.js app. Put user-created modules in `apps/mercato/src/modules/`.
-   **docs**: Documentation site.

### Packages (`packages/`)

All packages use the `@open-mercato/<package>` naming convention:

| Package | Import | When to use |
|---------|--------|-------------|
| **shared** | `@open-mercato/shared` | When you need cross-cutting utilities, types, DSL helpers, i18n, data engine |
| **ui** | `@open-mercato/ui` | When building UI components, forms, data tables, backend pages |
| **core** | `@open-mercato/core` | When working on core business modules (auth, catalog, customers, sales) |
| **cli** | `@open-mercato/cli` | When adding CLI tooling or generator commands |
| **cache** | `@open-mercato/cache` | When adding caching — resolve via DI, never use raw Redis/SQLite |
| **queue** | `@open-mercato/queue` | When adding background jobs — use worker contract, never custom queues |
| **events** | `@open-mercato/events` | When adding event-driven side effects between modules |
| **search** | `@open-mercato/search` | When configuring search indexing (fulltext, vector, tokens) |
| **ai-assistant** | `@open-mercato/ai-assistant` | When working on AI assistant or MCP server tools |
| **content** | `@open-mercato/content` | When adding static content pages (privacy, terms, legal) |
| **onboarding** | `@open-mercato/onboarding` | When modifying setup wizards or tenant provisioning flows |
| **enterprise** | `@open-mercato/enterprise` | When working on commercial enterprise-only modules and overlays |

### Where to Put Code

- Put core platform features in `packages/<package>/src/modules/<module>/`
- Put shared utilities and types in `packages/shared/src/lib/` or `packages/shared/src/modules/`
- Put UI components in `packages/ui/src/`
- Put user/app-specific modules in `apps/mercato/src/modules/<module>/`
- MUST NOT add code directly in `apps/mercato/src/` — it's a boilerplate for user apps

### When You Need an Import

| Need | Import |
|------|--------|
| Command pattern (undo/redo) | `import { registerCommand } from '@open-mercato/shared/lib/commands'` |
| Server-side translations | `import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'` |
| Client-side translations | `import { useT } from '@open-mercato/shared/lib/i18n/context'` |
| Data engine types | `import type { DataEngine } from '@open-mercato/shared/lib/data/engine'` |
| Search config types | `import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'` |
| UI primitives | `import { Spinner } from '@open-mercato/ui/primitives/spinner'` |
| API calls (backend pages) | `import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'` |
| CRUD forms | `import { CrudForm } from '@open-mercato/ui/backend/crud'` |

Import strategy:
- Prefer package-level imports (`@open-mercato/<package>/...`) over deep relative imports (`../../../...`) when crossing module boundaries, referencing shared module internals, or importing from deeply nested files.
- Keep short relative imports for same-folder/local siblings (`./x`, `../x`) where they are clearer than package paths.

## Conventions

- Modules: plural, snake_case (folders and `id`). Special cases: `auth`, `example`.
- **Event IDs**: `module.entity.action` (singular entity, past tense action, e.g., `pos.cart.completed`). use dots as separators.
- JS/TS fields and identifiers: camelCase.
- Database tables and columns: snake_case; table names plural.
- Common columns: `id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id`.
- UUID PKs, explicit FKs, junction tables for many-to-many.
- Keep code minimal and focused; avoid side effects across modules.
- Keep modules self-contained; re-use common utilities via `src/lib/`.

## Module Development Quick Reference

All paths use `src/modules/<module>/` as shorthand. See `packages/core/AGENTS.md` for full details.

### Auto-Discovery Paths

- Frontend pages: `frontend/<path>.tsx` → `/<path>`
- Backend pages: `backend/<path>.tsx` → `/backend/<path>` (special: `backend/page.tsx` → `/backend/<module>`)
- API routes: `api/<method>/<path>.ts` → `/api/<path>` (dispatched by method)
- Subscribers: `subscribers/*.ts` — export default handler + `metadata` with `{ event, persistent?, id? }`
- Workers: `workers/*.ts` — export default handler + `metadata` with `{ queue, id?, concurrency? }`

### Optional Module Files

| File | Export | Purpose |
|------|--------|---------|
| `index.ts` | `metadata` | Module metadata |
| `cli.ts` | default | CLI commands |
| `di.ts` | `register(container)` | DI registrar (Awilix) |
| `acl.ts` | `features` | Feature-based permissions |
| `setup.ts` | `setup: ModuleSetupConfig` | Tenant initialization, role features |
| `ce.ts` | `entities` | Custom entities / custom field sets |
| `search.ts` | `searchConfig` | Search indexing configuration |
| `events.ts` | `eventsConfig` | Typed event declarations |
| `translations.ts` | `translatableFields` | Translatable field declarations per entity |
| `notifications.ts` | `notificationTypes` | Notification type definitions |
| `notifications.client.ts` | — | Client-side notification renderers |
| `ai-tools.ts` | `aiTools` | MCP AI tool definitions |
| `data/entities.ts` | — | MikroORM entities |
| `data/validators.ts` | — | Zod validation schemas |
| `data/extensions.ts` | `extensions` | Entity extensions (module links) |
| `widgets/injection/` | — | Injected UI widgets |
| `widgets/injection-table.ts` | — | Widget-to-slot mappings |

### Key Rules

- API routes MUST export `openApi` for documentation generation
- CRUD routes: use `makeCrudRoute` with `indexer: { entityType }` for query index coverage
- Feature naming convention: `<module>.<action>` (e.g., `example.view`, `example.create`).
- setup.ts: always declare `defaultRoleFeatures` when adding features to `acl.ts`
- Custom fields: use `collectCustomFieldValues()` from `@open-mercato/ui/backend/utils/customFieldValues`
- Events: use `createModuleEvents()` with `as const` for typed emit
- Translations: when adding entities with user-facing text fields (title, name, description, label), create `translations.ts` at module root declaring translatable fields. Run `yarn generate` after adding.
- Widget injection: declare in `widgets/injection/`, map via `injection-table.ts`
- Generated files: `apps/mercato/.mercato/generated/` — never edit manually
- Run `npm run modules:prepare` after adding/modifying module files

## Backward Compatibility Contract

Open Mercato modules are developed by third-party developers who depend on stable platform APIs. Every surface listed below is a **public contract**. Changes to these surfaces MUST follow the deprecation protocol or they are **breaking changes** that block merge.

### Deprecation Protocol

1. **Never remove or rename** a public contract surface in a single release.
2. **Deprecate first**: add `@deprecated` JSDoc with migration guidance and the target removal version.
3. **Provide a bridge**: re-export the old name/path, accept the old signature, or keep the old behavior alongside the new one for at least one minor version.
4. **Document in RELEASE_NOTES.md**: every deprecation and every removal must be listed with migration instructions.
5. **Spec requirement**: any PR that modifies a contract surface MUST reference a spec (in `.ai/specs/`) that includes a "Migration & Backward Compatibility" section.

### Contract Surface Categories

#### 1. Auto-Discovery File Conventions (FROZEN)

The following file names, their expected export names, and their role in module auto-discovery MUST NOT change. New convention files may be added, but existing ones are immutable.

| Convention File | Required Export | Contract |
|-----------------|---------------|----------|
| `index.ts` | `metadata: ModuleInfo` | MUST NOT rename export or change `ModuleInfo` shape in a breaking way |
| `acl.ts` | `features: Array<{id,title,module}>` | MUST NOT change array item shape; may add optional fields |
| `setup.ts` | `setup: ModuleSetupConfig` | MUST NOT remove hooks (`onTenantCreated`, `seedDefaults`, `seedExamples`, `defaultRoleFeatures`); may add optional hooks |
| `ce.ts` | `entities: CustomEntitySpec[]` | MUST NOT change `CustomEntitySpec` required fields; may add optional fields |
| `search.ts` | `searchConfig: SearchModuleConfig` | MUST NOT change `SearchEntityConfig` required fields; may add optional fields |
| `events.ts` | `eventsConfig` via `createModuleEvents()` | MUST NOT change `EventDefinition` required fields (`id`, `label`); may add optional fields |
| `translations.ts` | `translatableFields` | MUST NOT change record shape |
| `notifications.ts` | `notificationTypes: NotificationTypeDefinition[]` | MUST NOT change required fields; may add optional fields |
| `notifications.client.ts` | — | MUST NOT change renderer props contract |
| `ai-tools.ts` | `aiTools: McpToolDefinition[]` | MUST NOT change `McpToolDefinition` required fields |
| `di.ts` | `register(container)` | MUST NOT change function signature |
| `cli.ts` | default export | MUST NOT change expected signature |
| `data/entities.ts` | Entity class exports | See Database Schema rules below |
| `data/validators.ts` | Zod schema exports | MUST NOT remove or narrow existing schemas |
| `data/extensions.ts` | `extensions: EntityExtension[]` | MUST NOT change `EntityExtension` shape |
| `widgets/injection-table.ts` | `ModuleInjectionTable` | MUST NOT change table type or spot ID resolution |
| `widgets/injection/*/widget.ts` | `InjectionWidgetModule` | MUST NOT change module shape or component props |
| `widgets/dashboard/*/widget.ts` | `DashboardWidgetModule` | MUST NOT change module shape or component props |

**Auto-discovery directory conventions** (FROZEN):

| Directory Pattern | Route Mapping | Contract |
|-------------------|--------------|----------|
| `frontend/<path>.tsx` | `/<path>` | MUST NOT change routing algorithm |
| `backend/<path>.tsx` | `/backend/<path>` | MUST NOT change routing algorithm |
| `api/<method>/<path>.ts` | `/api/<path>` by HTTP method | MUST NOT change dispatch logic |
| `subscribers/*.ts` | Event handler auto-registered | MUST NOT change metadata shape `{event, persistent?, id?}` |
| `workers/*.ts` | Queue worker auto-registered | MUST NOT change metadata shape `{queue, id?, concurrency?}` |

#### 2. Type Definitions & Interfaces (STABLE)

These exported types are consumed by module developers. Required fields MUST NOT be removed or have their types narrowed. Optional fields may be added freely.

**Immutable required fields** (removing or renaming any is a breaking change):

- `Module`: `id`, `info`, `backendRoutes`, `frontendRoutes`, `apis`, `subscribers`, `workers`, `setup`
- `ModuleInfo`: `name` (all fields are optional today — keep them optional)
- `PageMetadata`: all fields remain optional; MUST NOT remove any existing field
- `ModuleSetupConfig`: `onTenantCreated`, `seedDefaults`, `seedExamples`, `defaultRoleFeatures` — MUST NOT remove
- `EventDefinition`: `id`, `label` — MUST NOT remove; `category`, `module`, `entity`, `description` — MUST NOT remove
- `EventPayload`: `id`, `tenantId`, `organizationId` — MUST NOT remove
- `EntityExtension`: `base`, `extension`, `join` — MUST NOT remove
- `CustomFieldDefinition`: `key`, `kind` — MUST NOT remove; all other fields remain optional
- `CustomEntitySpec`: `id` — MUST NOT remove
- `InjectionWidgetMetadata`: `id`, `title` — MUST NOT remove
- `InjectionWidgetComponentProps`: `context`, `data`, `onDataChange`, `disabled` — MUST NOT remove
- `WidgetInjectionEventHandlers`: all existing handler names (`onLoad`, `onBeforeSave`, `onSave`, `onAfterSave`, `onBeforeDelete`, `onDelete`, `onAfterDelete`, `onDeleteError`) — MUST NOT remove or change signatures
- `SearchModuleConfig`: `entities` — MUST NOT remove; `SearchEntityConfig.entityId` — MUST NOT remove
- `NotificationTypeDefinition`: `type`, `module`, `titleKey`, `icon`, `severity`, `actions` — MUST NOT remove
- `DashboardWidgetMetadata`: `id`, `title` — MUST NOT remove
- `DashboardWidgetComponentProps`: `mode`, `layout`, `settings`, `context`, `onSettingsChange`, `refreshToken` — MUST NOT remove
- `OpenApiRouteDoc`: `methods` — MUST NOT remove
- `McpToolDefinition`: `name`, `description`, `inputSchema`, `handler` — MUST NOT remove
- `WorkerMeta`: `queue` — MUST NOT remove

#### 3. Function Signatures (STABLE)

These functions are called directly by module code. Their signatures MUST NOT change in a breaking way. New optional parameters may be added.

| Function | Package | Contract |
|----------|---------|----------|
| `createModuleEvents(options)` | `@open-mercato/shared/modules/events` | MUST NOT change `options` required shape or return type |
| `makeCrudRoute(opts)` | `@open-mercato/shared/lib/crud/factory` | MUST NOT remove existing `opts` fields; MUST NOT change return shape |
| `findWithDecryption(em, entityName, where, options?, scope?)` | `@open-mercato/shared/lib/encryption/find` | MUST NOT change parameter order or required params |
| `findOneWithDecryption(...)` | `@open-mercato/shared/lib/encryption/find` | Same as above |
| `findAndCountWithDecryption(...)` | `@open-mercato/shared/lib/encryption/find` | Same as above |
| `entityId(moduleId, entity)` | `@open-mercato/shared/modules/dsl` | MUST NOT change |
| `defineLink(base, extension, opts)` | `@open-mercato/shared/modules/dsl` | MUST NOT change |
| `defineFields(entity, fields, source?)` | `@open-mercato/shared/modules/dsl` | MUST NOT change |
| `cf.text`, `cf.multiline`, `cf.integer`, `cf.float`, `cf.boolean`, `cf.select`, `cf.currency`, `cf.dictionary` | `@open-mercato/shared/modules/dsl` | MUST NOT remove any helper or change required params |
| `lazyDashboardWidget(loader)` | `@open-mercato/shared/modules/dashboard/widgets` | MUST NOT change |
| `registerMcpTool(tool, options?)` | `@open-mercato/ai-assistant` | MUST NOT change |
| `apiCall` / `apiCallOrThrow` / `readApiResultOrThrow` | `@open-mercato/ui/backend/utils/apiCall` | MUST NOT change |
| `useT()` | `@open-mercato/shared/lib/i18n/context` | MUST NOT change return type |
| `resolveTranslations()` | `@open-mercato/shared/lib/i18n/server` | MUST NOT change |
| `createCrudOpenApiFactory(config)` | `@open-mercato/shared/lib/openapi/crud` | MUST NOT change |
| `collectCustomFieldValues()` | `@open-mercato/ui/backend/utils/customFieldValues` | MUST NOT change |
| `flash()` | `@open-mercato/ui` | MUST NOT change |
| `CrudForm` component props | `@open-mercato/ui/backend/crud` | MUST NOT remove existing props |
| `DataTable` component props | `@open-mercato/ui/backend` | MUST NOT remove existing props |
| `parseBooleanToken` / `parseBooleanWithDefault` | `@open-mercato/shared/lib/boolean` | MUST NOT change |

#### 4. Import Paths (STABLE)

All documented import paths in the "When You Need an Import" table and in package AGENTS.md files are public API. If a module is moved internally, the old import path MUST be re-exported for backward compatibility with a `@deprecated` annotation.

#### 5. Event IDs (FROZEN)

Published event IDs (declared in any module's `events.ts`) are consumed by subscribers in other modules and by workflow triggers. Changing an event ID is a **breaking change**.

- MUST NOT rename an existing event ID
- MUST NOT remove an existing event ID
- MUST NOT change an event's payload shape in a way that removes existing fields
- MAY add new optional fields to event payloads
- MAY add new event IDs freely
- To retire an event: deprecate it, emit both old and new IDs during the bridge period, then remove after one minor version

#### 6. Widget Injection Spot IDs (FROZEN)

Spot IDs are the addresses where external modules inject UI. Renaming or removing a spot ID silently breaks all modules targeting it.

- MUST NOT rename an existing spot ID (e.g., `crud-form:catalog.product`, `sales.document.detail.order:tabs`, `backend:record:current`)
- MUST NOT remove an existing spot ID from a page
- MUST NOT change the context/data type passed to widgets at existing spots
- MAY add new spot IDs to new or existing pages
- MAY add new optional context fields to existing spots
- Wildcard spots (`crud-form:*`, `data-table:*`) MUST continue to match as documented

#### 7. API Route URLs (STABLE)

External tools, frontends, and integrations depend on API URL patterns.

- MUST NOT rename or remove an existing API route URL
- MUST NOT change the HTTP method for an existing operation
- MUST NOT remove fields from existing response schemas
- MAY add new optional fields to request/response schemas
- MAY add new API routes freely
- To retire a route: deprecate with `deprecated: true` in `openApi`, keep it functional for at least one minor version, then remove

#### 8. Database Schema (ADDITIVE-ONLY)

Module developers create entities and run migrations. Core schema changes can break their data.

- MUST NOT rename existing tables or columns
- MUST NOT remove existing columns (use soft-deprecation: stop writing, keep column)
- MUST NOT change column types in a narrowing way (e.g., `text` → `varchar(50)`)
- MUST NOT remove or rename indexes that modules may depend on
- MUST NOT change the standard column contract (`id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id`)
- MAY add new columns with defaults (non-breaking)
- MAY add new tables freely
- MAY add new indexes freely
- MAY widen column types (e.g., `varchar(100)` → `text`)
- Foreign key column names on core entities (e.g., `organization_id`, `tenant_id`) are frozen

#### 9. DI Service Names (STABLE)

Module code resolves services by name from the Awilix container. Renaming a DI registration breaks all resolvers.

- MUST NOT rename existing DI service registration keys
- MUST NOT change the interface of a resolved service in a breaking way
- MAY add new DI registrations freely
- MAY add optional methods to existing service interfaces

#### 10. ACL Feature IDs (FROZEN)

Feature IDs are stored in database role configurations. Renaming a feature ID orphans existing role assignments.

- MUST NOT rename an existing feature ID
- MUST NOT remove an existing feature ID without a data migration that updates all stored role configs
- MAY add new feature IDs freely

#### 11. Notification Type IDs (FROZEN)

Notification types are referenced by subscribers, stored in database records, and rendered by client-side renderers.

- MUST NOT rename a `type` string on `NotificationTypeDefinition`
- MUST NOT remove an existing notification type
- MAY add new notification types freely

#### 12. CLI Commands (STABLE)

- MUST NOT rename or remove existing CLI commands or their required flags
- MAY add new commands or optional flags freely

#### 13. Generated File Contracts (STABLE)

Files in `apps/mercato/.mercato/generated/` are produced by the CLI generators. The generator output shape MUST remain compatible with the bootstrap consumer.

- MUST NOT change the export names of generated files
- MUST NOT change the `BootstrapData` type's required fields
- MAY add new generated files and new optional fields to `BootstrapData`

### Allowed vs Breaking Changes — Quick Reference

| Surface | Add new | Add optional field | Remove field | Rename | Change type |
|---------|---------|-------------------|-------------|--------|-------------|
| Convention files | OK | OK | BREAKING | BREAKING | BREAKING |
| Type interfaces | OK | OK | BREAKING | BREAKING | BREAKING (narrowing) |
| Function params | OK (optional) | OK | BREAKING | BREAKING | BREAKING |
| Event IDs | OK | OK (payload) | BREAKING | BREAKING | n/a |
| Spot IDs | OK | OK (context) | BREAKING | BREAKING | BREAKING (context) |
| API routes | OK | OK (req/res fields) | BREAKING (res fields) | BREAKING | BREAKING |
| DB columns | OK (with default) | n/a | BREAKING | BREAKING | BREAKING (narrowing) |
| DI names | OK | OK | BREAKING | BREAKING | BREAKING |
| Feature IDs | OK | n/a | BREAKING* | BREAKING | n/a |
| Import paths | OK | n/a | BREAKING | BREAKING | n/a |

\* Feature ID removal requires a data migration.

## Critical Rules

### Architecture

-   **NO direct ORM relationships between modules** — use foreign key IDs, fetch separately
-   Always filter by `organization_id` for tenant-scoped entities
-   Never expose cross-tenant data from API handlers
-   Use DI (Awilix) to inject services; avoid `new`-ing directly
-   Modules must remain isomorphic and independent
-   When extending another module's data, add a separate extension entity and declare a link in `data/extensions.ts`

### Data & Security

-   Validate all inputs with zod; place validators in `data/validators.ts`
-   Derive TypeScript types from zod via `z.infer<typeof schema>`
-   Use `findWithDecryption`/`findOneWithDecryption` instead of `em.find`/`em.findOne`
-   Never hand-write migrations — update ORM entities, run `yarn db:generate`
-   Hash passwords with bcryptjs (cost >=10), never log credentials
-   Return minimal error messages for auth (avoid revealing whether email exists)
-   RBAC: prefer declarative guards (`requireAuth`, `requireRoles`, `requireFeatures`) in page metadata

### UI & HTTP

-   Use `apiCall`/`apiCallOrThrow`/`readApiResultOrThrow` from `@open-mercato/ui/backend/utils/apiCall` — never use raw `fetch`
-   If a backend page cannot use `CrudForm`, wrap every write (`POST`/`PUT`/`PATCH`/`DELETE`) in `useGuardedMutation(...).runMutation(...)` and include `retryLastMutation` in the injection context
-   For CRUD forms: `createCrud`/`updateCrud`/`deleteCrud` (auto-handle `raiseCrudError`)
-   For local validation errors: throw `createCrudFormError(message, fieldErrors?)` from `@open-mercato/ui/backend/utils/serverErrors`
-   Read JSON defensively: `readJsonSafe(response, fallback)` — never `.json().catch(() => ...)`
-   Use `LoadingMessage`/`ErrorMessage` from `@open-mercato/ui/backend/detail`
-   i18n: `useT()` client-side, `resolveTranslations()` server-side
-   Never hard-code user-facing strings — use locale files
-   Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel
-   Keep `pageSize` at or below 100

### Code Quality

- No `any` types — use zod schemas with `z.infer`, narrow with runtime checks
- Prefer functional, data-first utilities over classes
- No one-letter variable names, no inline comments (self-documenting code)
- Don't add docstrings/comments/type annotations to code you didn't change
- Boolean parsing: use `parseBooleanToken`/`parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean`
- Confirm project still builds after changes

## Key Commands

```bash
yarn dev                  # Start development server
yarn build                # Build everything
yarn build:packages       # Build packages only
yarn lint                 # Lint all packages
yarn test                 # Run tests
yarn generate             # Run module generators
yarn db:generate          # Generate database migrations
yarn db:migrate           # Apply database migrations
yarn initialize           # Full project initialization
yarn dev:greenfield       # Fresh dev environment setup
yarn test:integration     # Run integration tests (Playwright, headless)
yarn test:integration:report  # View HTML test report
```
