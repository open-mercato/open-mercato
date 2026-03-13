# Code Review Checklist

## 1. Architecture & Module Independence

- [ ] No ORM relationships between modules — FK IDs only
- [ ] No direct module-to-module function calls for side effects
- [ ] DI (Awilix) used for service wiring
- [ ] No cross-tenant data exposure
- [ ] Code in correct location (`src/modules/<id>/`)

## 2. Security

- [ ] All inputs validated with zod in `data/validators.ts`
- [ ] No `any` types
- [ ] Auth guards on all endpoints (`requireAuth`, `requireRoles`, `requireFeatures`)
- [ ] Passwords hashed with bcryptjs (cost >= 10)
- [ ] No credentials logged or in error messages
- [ ] `findWithDecryption` used instead of raw `em.find`/`em.findOne`
- [ ] Tenant isolation: queries filter by `organization_id`

## 3. Data Integrity & ORM

- [ ] No hand-written migrations — entities updated, `yarn db:generate` run
- [ ] Migration scope matches PR intent (no unrelated schema churn)
- [ ] UUID primary keys with standard columns (`id`, `created_at`, `updated_at`)
- [ ] Soft delete via `deleted_at` where applicable
- [ ] Atomic transactions for multi-step writes

## 4. API Routes

- [ ] `openApi` exported for documentation
- [ ] `metadata` exported with auth guards
- [ ] Zod validation on request body
- [ ] Tenant scoping in queries
- [ ] `apiCall` used instead of raw `fetch`
- [ ] `pageSize <= 100`

## 5. Events & Commands

- [ ] Events declared in `events.ts` with `createModuleEvents` and `as const`
- [ ] Subscribers export `metadata` with `{ event, persistent?, id? }`
- [ ] Workers export `metadata` with `{ queue, id?, concurrency? }`
- [ ] All mutations implemented as commands with undo logic
- [ ] Side effects outside `withAtomicFlush`

## 6. UI & Backend Pages

- [ ] Forms use `CrudForm` (not custom)
- [ ] Tables use `DataTable` (not custom)
- [ ] Notifications use `flash()` (not alert/toast)
- [ ] Dialog forms have `embedded={true}`
- [ ] Keyboard: `Cmd/Ctrl+Enter` submit, `Escape` cancel
- [ ] Loading states: `LoadingMessage` or `DataLoader`
- [ ] Error states: `ErrorMessage` or `ErrorNotice`
- [ ] Empty states: `EmptyState`
- [ ] `RowActions` items have stable `id` values
- [ ] i18n: `useT()` client-side — no hardcoded strings

## 7. Naming Conventions

- [ ] Modules: plural, snake_case
- [ ] JS/TS identifiers: camelCase
- [ ] DB tables/columns: snake_case, plural table names
- [ ] Feature naming: `<module>.<action>` (e.g. `inventory.view`)
- [ ] Event naming: `module.entity.action` (singular entity, past tense)

## 8. Anti-Patterns

- [ ] No cross-module ORM links
- [ ] No plural entity/command/event naming
- [ ] No direct `fetch()` calls
- [ ] No custom toast/notification implementations
- [ ] No inline styles (use Tailwind)
- [ ] No hardcoded colors (use theme)
- [ ] No empty `catch` blocks
- [ ] No `any` types
- [ ] No missing loading/error states
