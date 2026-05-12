# Spec Review Checklist

Every item must be answered in the spec or marked N/A with justification.

## 1. Design Logic & Phasing

- [ ] TLDR defines scope, value, and clear boundaries
- [ ] MVP is explicit; future work is deferred and labeled
- [ ] User stories map to API/data/UI sections
- [ ] Phase plan is testable and incrementally deliverable

## 2. Architecture & Module Isolation

- [ ] Cross-module links use FK IDs only (no direct ORM relations)
- [ ] Tenant isolation and `organization_id` scoping are explicit
- [ ] Module placement is in `src/modules/<id>/`
- [ ] DI usage is specified (Awilix)
- [ ] Event/subscriber boundaries are clear and non-circular

## 3. Data Integrity & Security

- [ ] Entities include `id`, `organization_id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `is_active`
- [ ] Write operations define transaction boundaries
- [ ] Input validation uses zod schemas
- [ ] All user input validated before business logic/persistence
- [ ] Auth guards declared per-method in `metadata` (`requireAuth`, `requireFeatures`) — never legacy top-level `export const requireAuth`
- [ ] Tenant isolation: every scoped query filters by `organization_id` (and `tenant_id` where applicable)
- [ ] **Encryption maps mechanism is used (no hand-rolled crypto).** For every PII / GDPR-relevant column the spec proposes — names, addresses, contacts, free-text notes about people, integration credentials, secrets, document numbers — the spec MUST declare them in a module-level `<module>/encryption.ts` exporting `defaultEncryptionMaps: ModuleEncryptionMap[]` (type from `@open-mercato/shared/modules/encryption`). Reads MUST go through `findWithDecryption` / `findOneWithDecryption` (5-arg `(em, entity, where, options?, scope?)`) from `@open-mercato/shared/lib/encryption/find`. Equality-lookup columns (e.g. login email) declare a sibling `hashField`. No `crypto.subtle`, no custom KMS calls, no "TODO encrypt later". See `AGENTS.md` → CRITICAL Rule #11 (Encryption maps) + the "Encryption maps for sensitive data" row of the Mandatory Module Mechanisms table; `.ai/skills/data-model-design/SKILL.md` § Sensitive Data and Encryption Maps.

## 4. Commands, Events & Naming

- [ ] Naming is singular and consistent
- [ ] All mutations are commands with undo logic
- [ ] Events declared in `<module>/events.ts` via `createModuleEvents({ moduleId, events } as const)` before emitting; cross-module side effects use `subscribers/*.ts`, never direct cross-module imports
- [ ] Side-effect reversibility is documented

## 5. API & UI — Canonical Mechanisms

- [ ] API contracts are complete (request/response/errors)
- [ ] Routes include `openApi` expectations
- [ ] **Canonical mechanisms — no DIY substitutes.** The spec MUST reach for the framework primitives, not invent its own. See `AGENTS.md` → **Mandatory Module Mechanisms**.
  - [ ] **CRUD APIs** use `makeCrudRoute({ entity, entityId, operations, schema, indexer: { entityType } })` from `@open-mercato/shared/lib/crud/factory`. Custom write routes call `validateCrudMutationGuard` before mutation and `runCrudMutationGuardAfterSuccess` after.
  - [ ] **API route files export `metadata`** with per-method `requireAuth` / `requireFeatures` (no top-level `export const requireAuth`).
  - [ ] **Backend forms** use `<CrudForm>` from `@open-mercato/ui/backend/CrudForm` with helpers `createCrud` / `updateCrud` / `deleteCrud` from `@open-mercato/ui/backend/utils/crud`, throwing `createCrudFormError` from `@open-mercato/ui/backend/utils/serverErrors` for field-level errors. No raw `<form>`, no raw `fetch`.
  - [ ] **Lists** use `<DataTable entityId apiPath columns />` from `@open-mercato/ui/backend/DataTable` with stable `entityId` / `extensionTableId` so widget injection (columns / row actions / bulk actions / filters / toolbar) keeps working.
  - [ ] **HTTP clients** use `apiCall` / `apiCallOrThrow` / `readApiResultOrThrow` from `@open-mercato/ui/backend/utils/apiCall` — never raw `fetch`.
  - [ ] **Non-`CrudForm` writes** are wrapped in `useGuardedMutation(...).runMutation(...)` and pass `retryLastMutation` in the injection context.
  - [ ] **Cache** is resolved via DI (`container.resolve('cache')`) — never `new Redis(...)` or raw SQLite. Tags include `tenant:<id>` / `org:<id>`.
- [ ] **Design System compliance for every UI mock and className snippet in the spec.** See `AGENTS.md` → CRITICAL Rule #10 (Strict Design System alignment) and `.ai/skills/backend-ui-design/SKILL.md`.
  - [ ] Use semantic status tokens (`text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`, `text-status-info-icon`, `text-destructive`, `bg-destructive`) — NEVER hardcoded shades like `text-red-500`, `bg-green-100`, `text-amber-*`, `text-emerald-*`, `bg-blue-*`. Status tokens already cover dark mode; no `dark:` overrides.
  - [ ] Use the Tailwind text scale (`text-xs` 12, `text-sm` 14, `text-base` 16, `text-lg` 18, `text-xl` 20, `text-2xl` 24) or `text-overline` for 11px uppercase labels — NEVER arbitrary sizes (`text-[11px]`, `text-[13px]`, `text-[15px]`, `p-[13px]`, `rounded-[24px]`, `z-[9999]`).
  - [ ] Use shared primitives instead of raw HTML: `<Alert variant=...>` for inline status, `flash('msg', 'success|error|warning|info')` for toasts, `useConfirmDialog()` for destructive confirmations, `<StatusBadge>` for entity status, `<FormField label error>` to wrap form inputs, `<SectionHeader title count action>` for section headers, `<CollapsibleSection>` for collapsible regions, `<LoadingMessage>` / `<Spinner>` / `<DataLoader>` for async states, `<EmptyState>` (or DataTable `emptyState` prop) for empty lists.
  - [ ] Use lucide-react icons in PAGE BODY UI (`Page`, `DataTable`, `CrudForm`, cards, buttons) — never inline `<svg>`. Sizes from the `size-{3|4|5|6}` scale; `strokeWidth` is not overridden per-instance. `page.meta.ts` icons follow the `React.createElement('svg', …)` pattern.
  - [ ] Every dialog supports `Cmd/Ctrl+Enter` to submit and `Escape` to cancel.
  - [ ] Every icon-only button has an `aria-label`.
  - [ ] Boy Scout rule: when the spec edits an existing page, any line touched gets migrated to semantic tokens / DS scale.
- [ ] i18n keys are planned for user-facing strings (`useT()` client-side, `resolveTranslations()` server-side; never hard-coded labels)
- [ ] Pagination limits defined (`pageSize <= 100`)

## 6. Risks & Anti-Patterns

- [ ] Risks include concrete scenarios with severity and mitigation
- [ ] Blast radius and detection described
- [ ] Does not introduce cross-module ORM links
- [ ] Does not skip undoability for state changes
- [ ] Does not mix MVP with speculative future phases
- [ ] Does not introduce hand-rolled AES, raw `fetch`, raw `<form>`, `new Redis(...)`, or arbitrary Tailwind sizes / status colors
