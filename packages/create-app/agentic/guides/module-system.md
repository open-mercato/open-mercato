# Open Mercato Module System — Conceptual Guide

This is the **hand-written, conceptual** layer of the module guides. It explains how an Open Mercato module is structured and how to build or extend one — the timeless concepts that rarely change. It is framework-wide; it does **not** describe any single module's data.

## How the guides are layered

- **Layer 1 — this file (`.ai/guides/module-system.md`):** conceptual and framework-wide. Module anatomy, auto-discovery, naming, the mandatory mechanisms, data-integrity rules, and the generate/migration workflow.
- **Layer 2 — generated per-module fact-sheets (`.ai/guides/modules/<module>.md` + `.ai/guides/module-facts.json`):** the concrete **facts** for one module, extracted from its source — entity IDs, events, ACL features, API routes with per-method auth, DI service tokens, searchable entities, host extension tokens, notifications, and CLI commands. These are generated; never hand-write them here.
- **Package guides (`.ai/guides/core.md`, `ui.md`, `shared.md`, …):** package-specific depth (patterns, helpers, deeper APIs).

When you need a concrete fact about a specific module — which events it emits, its entity IDs, which feature gates a route — open that module's fact-sheet. Do not infer module facts from this conceptual guide.

## Module anatomy

Each module lives in `src/modules/<id>/` and is **auto-discovered**. The only registration is one entry in `src/modules.ts` (`{ id: '<id>', from: '@app' }`). Run `yarn generate` after adding or changing any auto-discovered file.

```
src/modules/<id>/
├── index.ts                # Module metadata
├── data/
│   ├── entities.ts         # MikroORM entity classes (decorators from @mikro-orm/decorators/legacy)
│   ├── validators.ts       # Zod validation schemas
│   ├── extensions.ts       # Cross-module entity links (export `extensions`)
│   └── enrichers.ts        # Response enrichers (export `enrichers`)
├── api/
│   ├── <resource>/route.ts # REST handlers (auto-discovered by method) + `metadata` + `openApi`
│   └── interceptors.ts     # API route interception hooks (export `interceptors`)
├── backend/                # Admin UI pages (auto-discovered) + paired `page.meta.ts`
├── frontend/               # Public pages (auto-discovered); customer portal under `[orgSlug]/portal/`
├── subscribers/            # Event handlers (export `metadata` + default handler)
├── workers/                # Background jobs (export `metadata` + default handler)
├── widgets/
│   ├── injection/          # UI widgets injected into other modules
│   ├── injection-table.ts  # Widget-to-slot mappings
│   └── components.ts        # Component replacement/wrapper definitions (export `componentOverrides`)
├── di.ts                   # Awilix DI registrations (export `register(container)`)
├── acl.ts                  # Permission features (export `features`)
├── setup.ts                # Tenant init, role features, seed data (export `setup`)
├── events.ts               # Typed event declarations (export `eventsConfig`)
├── search.ts               # Search indexing configuration (export `searchConfig`)
├── ce.ts                   # Custom entities / custom field sets (export `entities`)
├── translations.ts         # Translatable fields per entity
├── notifications.ts        # Notification type definitions (export `notificationTypes`)
└── encryption.ts           # Tenant data encryption maps for sensitive / GDPR fields
```

### Auto-discovery paths

| Path pattern | Becomes |
|---|---|
| `frontend/<path>.tsx` | `/<path>` (public page) |
| `frontend/[orgSlug]/portal/<path>/page.tsx` | `/{orgSlug}/portal/<path>` (customer portal page; `[orgSlug]` MUST be first) |
| `backend/<path>.tsx` | `/backend/<path>` (admin page) |
| `backend/page.tsx` | `/backend/<module>` (module root page) |
| `api/<method>/<path>.ts` | `/api/<path>` dispatched by HTTP method |
| `subscribers/*.ts` | event subscriber (export `metadata` + default handler) |
| `workers/*.ts` | background worker (export `metadata` + default handler) |

### Convention-file reference

| File | Export | Purpose |
|------|--------|---------|
| `index.ts` | `metadata` | Module metadata |
| `di.ts` | `register(container)` | DI registrations (Awilix) |
| `acl.ts` | `features` | Permission features (`['mod.view', 'mod.manage', …]`) |
| `setup.ts` | `setup` | Tenant init, default role features, seed data |
| `ce.ts` | `entities` | Custom entities / custom field sets |
| `events.ts` | `eventsConfig` | Typed event declarations (`createModuleEvents`) |
| `search.ts` | `searchConfig` | Search indexing config |
| `translations.ts` | `translatableFields` | Translatable fields per entity |
| `notifications.ts` | `notificationTypes` | Notification type definitions |
| `data/entities.ts` | — | MikroORM entity classes |
| `data/validators.ts` | — | Zod validation schemas |
| `data/extensions.ts` | `extensions` | Entity extensions (cross-module links) |
| `data/enrichers.ts` | `enrichers` | Response enrichers |
| `api/interceptors.ts` | `interceptors` | API route interception hooks |
| `widgets/components.ts` | `componentOverrides` | Component replacement/wrapper definitions |

## Naming conventions

- **Module IDs:** plural, snake_case (`order_items`). Special cases: `auth`, `example`.
- **Event IDs:** `module.entity.action` (singular entity, past-tense action, e.g. `sales.order.created`).
- **Entity IDs:** colon form `module:entity` (e.g. `customers:customer_person_profile`) — the canonical interop token, **not** the raw class name and **not** the dotted friendly alias some enrichers use.
- **DB tables:** plural, snake_case with a module prefix (`catalog_products`).
- **DB columns:** snake_case (`created_at`, `organization_id`). Common columns: `id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id`.
- **Feature IDs:** `<module>.<action>` (`my_module.view`, `my_module.manage`). FROZEN once shipped — rename by adding the new ID alongside and keeping the old as a deprecated alias.
- **JS/TS identifiers:** camelCase. UUID primary keys, explicit foreign keys, junction tables for M2M.

## Mandatory module mechanisms

The framework provides **one canonical primitive per concern**. Do not invent your own routing, auth, persistence, forms, caching, or cross-module calls. If a feature is not listed here, ask before rolling your own.

| Concern | Canonical mechanism |
|---|---|
| Module structure & auto-discovery | `src/modules/<id>/{api,backend,frontend,data,subscribers,workers,widgets}` + `index.ts` + one line in `src/modules.ts` — discovered by `yarn generate` |
| API routes | Files under `api/**/route.ts` exporting handlers + per-method `metadata` (`requireAuth` / `requireFeatures`) + `openApi`. NEVER a top-level `export const requireAuth` — the registry ignores it |
| CRUD APIs | `makeCrudRoute({ orm, list, create, update, del, indexer })` from `@open-mercato/shared/lib/crud/factory`. Always set `indexer` for query-index coverage. Custom (non-factory) write routes MUST run the mutation guard registry (`runMutationGuards`) |
| CRUD forms | `<CrudForm />` from `@open-mercato/ui/backend/CrudForm` + `createCrud`/`updateCrud`/`deleteCrud`. Never raw `<form>`, never raw `fetch` |
| Data tables | `<DataTable entityId apiPath … />` from `@open-mercato/ui/backend/DataTable`. Keep `entityId` / `extensionTableId` stable so widget injection keeps working |
| HTTP from the client | `apiCall` / `apiCallOrThrow` from `@open-mercato/ui/backend/utils/apiCall` — never raw `fetch` |
| Authorization (RBAC) | Declare features in `acl.ts`, grant in `setup.ts` `defaultRoleFeatures`, gate with `requireFeatures` in `metadata` / `page.meta.ts`. NEVER `requireRoles` (role names mutate). Treat `module.*` / `*` wildcard grants as part of the contract |
| Multi-tenant scoping | Every tenant-scoped entity has indexed `organization_id` + `tenant_id`; every read/write filters by them. The CRUD factory injects scope — do not bypass it. Ad-hoc queries use `withScopedPayload` |
| Encryption for sensitive data | Declare `encryption.ts` `defaultEncryptionMaps`; read via `findWithDecryption` / `findOneWithDecryption`. NEVER hand-roll AES/KMS, NEVER `em.find` on encrypted columns |
| Cache | Resolve from DI (`container.resolve('cache')`) — never `new Redis(...)`. Tag with `tenant:<id>` / `org:<id>` so invalidation stays tenant-scoped |
| Background workers | `workers/*.ts` exporting `metadata: { queue, id?, concurrency? }` + default handler. Never spin up custom queues |
| Events between modules | `events.ts` with `createModuleEvents({ moduleId, events } as const)`; subscribe in `subscribers/`. Never call another module's services directly across boundaries |
| Domain writes | Implement through the Command pattern so audit, undo, cache, events, and indexing stay consistent — do not mutate domain state directly in route handlers |
| i18n | `useT()` client-side, `resolveTranslations()` server-side; keys in `src/i18n/<locale>.json`. Never hard-code user-facing strings |

> Rule of thumb: if you reach for raw `fetch`, raw `<form>`, ad-hoc `crypto`, ad-hoc `Redis`, or a manual cross-module join, stop and check the row above — there is a canonical helper.

## Entity-update safety & data integrity

- **`withAtomicFlush`.** MikroORM can silently discard pending scalar changes when a query (`em.find`/`em.findOne`/sync helper) runs on the same `EntityManager` between a scalar mutation and `em.flush()`. Multi-phase mutations MUST use `withAtomicFlush(em, phases, { transaction: true })` from `@open-mercato/shared/lib/commands/flush`. Keep `emitCrudSideEffects` and cache invalidation **outside** the block — they fire only after the DB write commits. For entity + custom fields + side effects in one write, prefer `runCrudCommandWrite`.
- **Optimistic locking (default ON).** Every **new user-editable entity** MUST carry an `updated_at` column and return `updatedAt` in its list/detail responses, so the OSS optimistic lock can detect concurrent edits. `CrudForm` auto-derives the lock header from `initialValues.updatedAt` (covers update and delete). Append-only logs, junction/assignment tables, session/token rows, and parent-guarded sub-resource lines are exempt.
- **Encryption.** Sensitive / GDPR fields go through the encryption-maps mechanism (`encryption.ts` + `findWithDecryption`), never hand-rolled crypto. Always pass `tenantId` and `organizationId` to the decryption helpers.
- **Tenant isolation.** Never expose cross-tenant data; always filter by `organization_id` (and `tenant_id`). Never create direct ORM relationships between modules — reference by FK id and fetch separately.

## Generate & migration workflow

- **After editing `src/modules.ts` or any structural module file:** run `yarn generate`. Never hand-edit anything under `.mercato/generated/*`.
- **After editing `data/entities.ts`:** run `yarn db:generate` as a schema-diff probe. Default to the generated SQL; if it emits unrelated churn from another module's stale snapshot, keep only the SQL for your change and update that module's `migrations/.snapshot-open-mercato.json` in the same commit.
- **Do not run `yarn db:migrate`** unless the user explicitly asks. A PR should normally include the migration file plus snapshot, not local DB state. Never hand-edit a migration that has already shipped — add a new one.
- **New ACL features must be visible immediately:** add the feature to `acl.ts` **and** to `setup.ts` `defaultRoleFeatures`, then run `yarn mercato auth sync-role-acls` so existing tenants pick it up.

## Where to go next

- A specific module's surface (entities, events, routes, auth, search, CLI): its **fact-sheet** at `.ai/guides/modules/<module>.md`.
- Deeper package patterns: the matching **package guide** (`core.md`, `ui.md`, `shared.md`, `events.md`, `queue.md`, `cache.md`, `search.md`).
- Scaffolding a module end-to-end: the `om-module-scaffold` skill.
