# Code Review Checklist — Full Reference

Apply every applicable section based on which files changed. Skip sections that don't apply to the diff.

## 1. Architecture & Module Independence

- [ ] No direct ORM relationships between modules (use FK IDs, fetch separately)
- [ ] No direct module-to-module function calls for side effects (use events)
- [ ] No direct imports from other modules' business logic
- [ ] Cross-module data uses extension entities declared in `data/extensions.ts`
- [ ] Entity access: optional chaining for cross-module IDs — `(E as any).catalog?.catalog_product`
- [ ] Entity IDs resolved at runtime via `getEntityIds()`, not at import time
- [ ] All queries on tenant-scoped entities filter by `organization_id` AND `tenant_id`
- [ ] No cross-tenant data leaks in API responses
- [ ] Services resolved via DI (Awilix) — never `new` directly
- [ ] No hardcoded module-specific logic in `setup-app.ts`
- [ ] Code placed in correct location (core features in `packages/`, app-specific in `apps/mercato/src/modules/`)
- [ ] No code added directly in `apps/mercato/src/` outside of `modules/`
- [ ] `@open-mercato/shared` has zero domain dependencies — no imports from `@open-mercato/core`

## 2. Security & Authentication

- [ ] All inputs validated with zod schemas in `data/validators.ts`
- [ ] TypeScript types derived from zod via `z.infer<typeof schema>` (no manual interface duplication)
- [ ] No `any` types — use zod + `z.infer`, narrow with runtime checks
- [ ] Every API endpoint declares auth guards (`requireAuth`, `requireRoles`, `requireFeatures`)
- [ ] Passwords hashed with bcryptjs (cost >= 10)
- [ ] No credentials logged or included in error responses
- [ ] Auth endpoints return minimal error messages (no "email not found" vs "wrong password" distinction)
- [ ] `findWithDecryption`/`findOneWithDecryption` used instead of raw `em.find`/`em.findOne`
- [ ] `tenantId` and `organizationId` supplied to decryption helpers
- [ ] No hand-rolled AES/KMS — use `TenantDataEncryptionService`
- [ ] GDPR-relevant fields update encryption defaults in `src/modules/entities/lib/encryptionDefaults.ts`
- [ ] No sensitive fields (passwords, tokens, SSNs, bank accounts) exposed in search indexes
- [ ] `fieldPolicy.excluded` defined for sensitive fields in search config
- [ ] `fieldPolicy.hashOnly` used for PII needing exact-match but not fuzzy search
- [ ] No sensitive data cached without encryption

## 3. Data Integrity & ORM

- [ ] No hand-written migrations — entities updated, `yarn db:generate` used
- [ ] UUID primary keys with `defaultRaw: 'gen_random_uuid()'`
- [ ] Standard columns present: `id`, `created_at`, `updated_at`, `organization_id`, `tenant_id`
- [ ] Soft delete via `deleted_at` (not hard delete for historical records)
- [ ] Table names: plural snake_case
- [ ] Column names: snake_case
- [ ] Junction tables for many-to-many relationships
- [ ] Explicit foreign keys (no implicit ORM resolution across modules)
- [ ] `withAtomicFlush` used when mutating entities across phases that include queries
- [ ] Scalar changes flushed BEFORE relation syncs that query on same `EntityManager`
- [ ] No `em.find`/`em.findOne` between scalar mutations and `em.flush()` without `withAtomicFlush`
- [ ] Transactions are atomic — all-or-nothing semantics

## 4. API Routes

- [ ] `openApi` exported for documentation generation
- [ ] `metadata` exported with auth guard declarations
- [ ] `makeCrudRoute` used with `indexer: { entityType }` for query index coverage
- [ ] Zod validation on all request inputs
- [ ] Tenant scoping applied in all queries
- [ ] `apiCall`/`apiCallOrThrow` used — no raw `fetch`
- [ ] `readJsonSafe(response, fallback)` for JSON parsing — no `.json().catch()`
- [ ] CRUD operations use `createCrud`/`updateCrud`/`deleteCrud`
- [ ] Local validation errors thrown via `createCrudFormError(message, fieldErrors?)`
- [ ] `pageSize` <= 100 for list endpoints
- [ ] Export handler functions (`GET`, `POST`, `PUT`, `DELETE`) matching HTTP method

## 5. Events

- [ ] Events declared in the emitting module's `events.ts`
- [ ] `createModuleEvents()` used with `as const` for type safety
- [ ] Event fields include `id` (required), `label` (required), `category`
- [ ] `npm run modules:prepare` run after creating/modifying `events.ts`
- [ ] No undeclared events emitted
- [ ] Subscribers export `metadata` with `{ event, persistent?, id? }`
- [ ] One side effect per subscriber file
- [ ] Persistent subscribers are idempotent (may be retried)
- [ ] Ephemeral subscribers used only for real-time UI updates and cache invalidation

## 6. Commands & Undo/Redo

- [ ] All write operations implemented as commands via `registerCommand`
- [ ] Multi-step operations use compound commands
- [ ] Every command is undoable with before/after snapshots
- [ ] `extractUndoPayload()` used from `@open-mercato/shared/lib/commands/undo.ts`
- [ ] Custom field snapshots captured in `snapshot.custom`
- [ ] Undo restores via `buildCustomFieldResetMap(before.custom, after.custom)`
- [ ] `buildLog()` loads snapshots via forked `EntityManager` or `refresh: true`
- [ ] Side effects (`emitCrudSideEffects`) called OUTSIDE `withAtomicFlush`
- [ ] Both `emitCrudSideEffects` and `emitCrudUndoSideEffects` include `indexer: { entityType, cacheAliases }`

## 7. Search Configuration

- [ ] `search.ts` created for every module with searchable entities
- [ ] Exports `searchConfig: SearchModuleConfig`
- [ ] `checksumSource` included in every `buildSource` return
- [ ] `fieldPolicy.excluded` defined for sensitive fields
- [ ] `fieldPolicy.hashOnly` defined for PII fields (email, phone, tax_id)
- [ ] `formatResult` defined for every entity using tokens strategy
- [ ] No encrypted/sensitive fields in `buildSource` text output
- [ ] Entity ID format matches `module:entity_name` exactly
- [ ] `SearchService` used for direct search, `SearchIndexer` for config-aware indexing

## 8. Cache

- [ ] Resolved via DI: `container.resolve('cacheService')` — never raw Redis/SQLite
- [ ] Scoped to tenant: `tenantId` in keys or `runWithCacheTenant()`
- [ ] Tag-based invalidation for CRUD side effects
- [ ] Every write operation lists which cache tags it invalidates
- [ ] Nested data declares invalidation chains (child change invalidates parent cache)
- [ ] No stale cross-tenant data possible
- [ ] No sensitive data cached without encryption

## 9. Queue & Workers

- [ ] Workers are idempotent — duplicate execution MUST NOT corrupt data
- [ ] `metadata` exported with `{ queue, id?, concurrency? }`
- [ ] Concurrency <= 20
- [ ] I/O-bound: concurrency 5-10; CPU-bound: 1-2; database-heavy: 3-5
- [ ] Works with both `local` and `async` strategies

## 10. Module Setup

- [ ] `defaultRoleFeatures` in `setup.ts` mirrors features from `acl.ts`
- [ ] Lifecycle hooks: `onTenantCreated`, `seedDefaults`, `seedExamples` as needed
- [ ] All hooks are idempotent — re-running MUST NOT create duplicates
- [ ] No hardcoded module-specific logic in `setup-app.ts`
- [ ] No direct imports of another module's seed functions
- [ ] `getEntityIds()` used at runtime for cross-module lookups

## 11. Custom Fields & Entities

- [ ] Custom entities declared in `ce.ts` under `entities[].fields`
- [ ] Generated IDs referenced via `E.<module>.<entity>`
- [ ] `collectCustomFieldValues()` used in form submission
- [ ] `splitCustomFieldPayload`, `normalizeCustomFieldValues`, `normalizeCustomFieldResponse` from `@open-mercato/shared`
- [ ] DSL helpers used: `defineLink`, `entityId`, `cf.*` from `@open-mercato/shared/modules/dsl`

## 12. UI & Backend Pages

### Forms
- [ ] `CrudForm` used for all create/edit flows — never custom forms
- [ ] Dialog forms use `embedded={true}`
- [ ] Zod schema drives validation, field errors via `createCrudFormError`
- [ ] `fields` and `groups` in memoized helpers
- [ ] `entityIds` passed when custom fields involved
- [ ] `FormHeader` and `FormFooter` from `@open-mercato/ui/backend/forms`

### Tables
- [ ] `DataTable` used for all list views — never manual tables
- [ ] Column truncation: `meta.truncate` and `meta.maxWidth` set where needed
- [ ] `RowActions` with stable `id` values (`edit`, `open`, `delete`)
- [ ] `rowClickActionIds` configured if needed
- [ ] `pageSize` <= 100
- [ ] Exports: `buildCrudExportUrl` + `exportOptions` on `DataTable`

### Feedback & States
- [ ] `flash()` for all user feedback — never `alert()` or custom toast
- [ ] `LoadingMessage` and `ErrorMessage` from `@open-mercato/ui/backend/detail`
- [ ] `TabEmptyState` for empty but healthy sections
- [ ] `Notice` (compact/variant) for inline hints and warnings

### Keyboard & UX
- [ ] Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel
- [ ] `FormHeader mode="detail"` for view pages, `mode="edit"` for CrudForm pages

## 13. i18n & Translations

- [ ] No hardcoded user-facing strings
- [ ] Client-side: `useT()` from `@open-mercato/shared/lib/i18n/context`
- [ ] Server-side: `resolveTranslations()` from `@open-mercato/shared/lib/i18n/server`
- [ ] Translation keys in module locale files
- [ ] Notification strings use `<module>.notifications.*` keys

## 14. Naming Conventions

- [ ] Module folders: plural, snake_case (exceptions: `auth`, `example`)
- [ ] Module `id`: matches folder name (plural, snake_case)
- [ ] JS/TS identifiers: camelCase
- [ ] Database tables: plural snake_case
- [ ] Database columns: snake_case
- [ ] ACL features: `<module>.<entity>.<action>`
- [ ] Event IDs: `<module>.<entity>.<past_tense_verb>`
- [ ] No one-letter variable names

## 15. Code Quality

- [ ] No `any` types introduced
- [ ] No `unknown` or `any` exported from shared packages
- [ ] Narrow, typed interfaces exported from shared packages
- [ ] Functional, data-first utilities preferred over classes
- [ ] Boolean parsing: `parseBooleanToken`/`parseBooleanWithDefault`
- [ ] No added docstrings/comments/annotations on unchanged code
- [ ] Self-documenting code — no inline comments needed
- [ ] Imports use correct package paths (see AGENTS.md import table)

## 16. Notifications

- [ ] Types declared in `notifications.ts` with `notificationTypes: NotificationTypeDefinition[]`
- [ ] Event subscribers emit notifications on domain events
- [ ] Client renderers in `notifications.client.ts`
- [ ] Components in `widgets/notifications/`
- [ ] Translation keys: `<module>.notifications.*`
- [ ] `expiresAfterHours` set appropriately

## 17. Widget Injection

- [ ] Widgets declared in `widgets/injection/`
- [ ] Mapped via `widgets/injection-table.ts`
- [ ] Metadata in colocated `*.meta.ts` files
- [ ] Spot IDs follow convention: `crud-form:<entityId>`, `data-table:<tableId>`, `admin.page:<path>`

## 18. AI Tools (MCP)

- [ ] `requiredFeatures` set for RBAC enforcement — never empty
- [ ] Zod schemas for `inputSchema` — never raw JSON Schema
- [ ] Handler returns serializable objects
- [ ] `moduleId` matches module's `id` field
- [ ] `_sessionToken` deleted from args before passing to handler
- [ ] `null` return from token lookup handled — return SESSION_EXPIRED

## 19. Generated Files & Build

- [ ] Files in `apps/mercato/.mercato/generated/` never edited manually
- [ ] `npm run modules:prepare` run after adding/modifying module files
- [ ] No imports from generated files in packages (only app bootstrap imports)
- [ ] Project still builds after changes (`yarn build`)

## 20. Anti-Pattern Checklist

Flag any of these patterns as violations:

| Anti-Pattern | Severity | Fix |
|---|---|---|
| Direct ORM relationships between modules | Critical | Use FK IDs, fetch separately |
| Missing `organization_id` filter on tenant queries | Critical | Add tenant scoping |
| Raw `em.find`/`em.findOne` without decryption | High | Use `findWithDecryption` |
| Missing `openApi` export on API route | High | Add OpenAPI spec export |
| Missing `metadata` export on subscriber/worker | High | Add metadata with required fields |
| Raw `fetch` in UI code | High | Use `apiCall`/`apiCallOrThrow` |
| Custom form instead of `CrudForm` | Medium | Refactor to use `CrudForm` |
| Custom table instead of `DataTable` | Medium | Refactor to use `DataTable` |
| `any` type | Medium | Use zod + `z.infer` |
| Hardcoded user-facing string | Medium | Use i18n translation key |
| Hand-written migration | Medium | Delete and run `yarn db:generate` |
| `alert()` or custom toast | Medium | Use `flash()` |
| One-letter variable name | Low | Use descriptive name |
| Inline comment on self-explanatory code | Low | Remove comment |
| Added docstring on unchanged function | Low | Remove docstring |
