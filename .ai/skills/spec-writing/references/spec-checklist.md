# Spec Review Checklist

Use this checklist during review. Every item must be explicitly answered in the spec or marked N/A with justification.

## Review Process (Required)

1. Re-read the full spec from scratch with adversarial intent.
2. Run this checklist section-by-section.
3. Stress-test each mitigation in Risks & Impact Review.
4. Cross-check related module specs for conflicting assumptions.
5. Record the review result using the output format below.

## Review Output Format

Append to changelog:

```markdown
### Review — {YYYY-MM-DD}
- **Reviewer**: Agent / Human
- **Security**: Passed / {list of issues}
- **Performance**: Passed / {list of issues}
- **Cache**: Passed / {list of issues}
- **Commands**: Passed / {list of issues}
- **Risks**: Passed / {list of gaps}
- **Verdict**: Approved / Needs revision
```

## 1. Design Logic & Phasing
- [ ] TLDR defines scope, value, and clear boundaries.
- [ ] MVP is explicit; future work is deferred and labeled.
- [ ] User stories/use cases map to API/data/UI sections.
- [ ] Terminology aligns with existing modules and AGENTS naming.
- [ ] Phase plan is testable and incrementally deliverable.

## 2. Architecture & Module Isolation
- [ ] Cross-module links use FK IDs only (no direct ORM relations).
- [ ] Tenant isolation and `organization_id` scoping are explicit.
- [ ] Module/package placement is correct for monorepo conventions.
- [ ] DI usage is specified for service wiring (Awilix).
- [ ] Event/subscriber/worker boundaries are clear and non-circular.

## 3. Data Integrity & Security
- [ ] Entities/records include required tenancy/lifecycle columns where applicable.
- [ ] Write operations define atomicity/transaction boundaries.
- [ ] Input validation is defined using zod schemas.
- [ ] PII/sensitive fields and decryption behavior are documented.
- [ ] **Encryption maps mechanism is used (no hand-rolled crypto).** For every PII / GDPR-relevant column the spec proposes — names, addresses, contacts, free-text notes about people, integration credentials, secrets, document numbers — the spec MUST declare them in a module-level `<module>/encryption.ts` exporting `defaultEncryptionMaps: ModuleEncryptionMap[]` (type from `@open-mercato/shared/modules/encryption`). Reads MUST go through `findWithDecryption` / `findOneWithDecryption` (5-arg `(em, entity, where, options?, scope?)`) from `@open-mercato/shared/lib/encryption/find`. Equality-lookup columns (e.g. login email) declare a sibling `hashField`. No `crypto.subtle`, no custom KMS calls, no "TODO encrypt later". See `packages/core/AGENTS.md` → Encryption, `apps/docs/docs/user-guide/encryption.mdx`, and reference modules under `packages/core/src/modules/*/encryption.ts`.
- [ ] Security criteria covered:
- [ ] All user input is validated with zod before business logic/persistence.
- [ ] SQL/NoSQL injection vectors are mitigated with parameterized queries (no string interpolation).
- [ ] XSS protections are documented for user-rendered content (no unsafe raw HTML rendering).
- [ ] Proper encoding is defined for URLs, HTML entities, JSON payloads, and file paths.
- [ ] Secrets/credentials are excluded from logs, error messages, and API responses.
- [ ] Authentication/authorization guards are declared (`requireAuth`, `requireRoles`, `requireFeatures`).
- [ ] Tenant isolation rule is explicit: every scoped query filters by `organization_id`.

## 4. Commands, Events & Naming
- [ ] Naming is singular and consistent for entities/commands/events.
- [ ] All mutations are represented as commands.
- [ ] Undo/rollback behavior is specified for each mutation.
- [ ] Multi-step flows use compound commands or equivalent orchestration.
- [ ] Side-effect reversibility (events/notifications/external calls) is documented.
- [ ] Commands with side effects document which effects are reversible and which are not.
- [ ] Bulk operations use compound commands with per-item granularity where partial undo is required.

## 5. API, UI & Compatibility
- [ ] API contracts are complete (request/response/errors) and consistent with models.
- [ ] Routes include `openApi` expectations.
- [ ] **Canonical mechanisms — no DIY substitutes.** The spec MUST reach for the framework primitives, not invent its own:
  - [ ] **CRUD APIs** use `makeCrudRoute({ entity, entityId, operations, schema, indexer: { entityType } })` from `@open-mercato/shared/lib/crud/make-crud-route`. Custom (non-`makeCrudRoute`) write routes MUST call `validateCrudMutationGuard` before the mutation and `runCrudMutationGuardAfterSuccess` after success. See `packages/core/AGENTS.md` → API Routes / CRUD Factory.
  - [ ] **API route files export `metadata`** with per-method `requireAuth` / `requireFeatures` (no top-level `export const requireAuth`).
  - [ ] **Backend forms** use `<CrudForm>` from `@open-mercato/ui/backend/CrudForm` with helpers `createCrud` / `updateCrud` / `deleteCrud` from `@open-mercato/ui/backend/utils/crud`, throwing `createCrudFormError` from `@open-mercato/ui/backend/utils/serverErrors` for field-level errors. No raw `<form>`, no raw `fetch`. See `packages/ui/AGENTS.md` → CrudForm.
  - [ ] **Lists** use `<DataTable entityId apiPath columns />` from `@open-mercato/ui/backend/DataTable` with stable `entityId` / `extensionTableId` so widget injection (columns / row actions / bulk actions / filters / toolbar) keeps working. See `packages/ui/AGENTS.md` → DataTable.
  - [ ] **HTTP clients** use `apiCall` / `apiCallOrThrow` / `readApiResultOrThrow` from `@open-mercato/ui/backend/utils/apiCall` — never raw `fetch`.
  - [ ] **Non-`CrudForm` writes** are wrapped in `useGuardedMutation(...).runMutation(...)` and pass `retryLastMutation` in the injection context.
  - [ ] **Cache** is resolved via DI (`container.resolve('cache')`) — never `new Redis(...)` or raw SQLite. Tags include `tenant:<id>` / `org:<id>`. See `packages/cache/AGENTS.md`.
  - [ ] **Events** between modules go through `<module>/events.ts` `createModuleEvents({ moduleId, events } as const)` and `subscribers/*.ts`, never direct cross-module imports. See `packages/events/AGENTS.md`.
- [ ] **Design System compliance for every UI mock and className snippet in the spec.** See `.ai/ds-rules.md` (foundations) and `.ai/ui-components.md` (component reference). The spec MUST:
  - [ ] Use semantic status tokens (`text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`, `text-status-info-icon`, `text-destructive`, `bg-destructive`) — NEVER hardcoded Tailwind shades like `text-red-500`, `bg-green-100`, `text-amber-*`, `text-emerald-*`, `bg-blue-*`. Status tokens already cover dark mode; no `dark:` overrides.
  - [ ] Use the Tailwind text scale (`text-xs` 12, `text-sm` 14, `text-base` 16, `text-lg` 18, `text-xl` 20, `text-2xl` 24) or the `text-overline` token for 11px uppercase labels — NEVER arbitrary sizes (`text-[11px]`, `text-[13px]`, `text-[15px]`, `p-[13px]`, `rounded-[24px]`, `z-[9999]`).
  - [ ] Use shared primitives instead of raw HTML: `<Alert variant=...>` for inline status, `flash('msg', 'success|error|warning|info')` for toasts, `useConfirmDialog()` for destructive confirmations, `<StatusBadge>` for entity status, `<FormField label error>` to wrap form inputs, `<SectionHeader title count action>` for section headers, `<CollapsibleSection>` for collapsible regions, `<LoadingMessage>` / `<Spinner>` / `<DataLoader>` for async states, `<EmptyState>` (or DataTable `emptyState` prop) for empty lists.
  - [ ] Use lucide-react icons in PAGE BODY UI (`Page`, `DataTable`, `CrudForm`, cards, buttons) — never inline `<svg>`. Sizes from the `size-{3|4|5|6}` scale; `strokeWidth` is not overridden per-instance. `page.meta.ts` icons follow the `React.createElement('svg', …)` pattern instead of importing from `lucide-react`.
  - [ ] Every dialog supports `Cmd/Ctrl+Enter` to submit and `Escape` to cancel.
  - [ ] Every icon-only button has an `aria-label`.
  - [ ] When the spec edits an existing page, it honours the **Boy Scout rule**: any line touched gets migrated to semantic tokens / DS scale.
- [ ] i18n keys are planned for all user-facing strings (`useT()` client-side, `resolveTranslations()` server-side; never hard-coded labels in components).
- [ ] Pagination limits are defined (`pageSize <= 100`) where applicable.
- [ ] Migration/backward compatibility strategy is explicit.

## 6. Performance, Cache & Scale
- [ ] Query/index strategy is defined for expected access patterns.
- [ ] N+1 risks and large-list behavior are addressed.
- [ ] Bulk operations define batching/chunking strategy.
- [ ] Background worker threshold for heavy operations is considered.
- [ ] Every query pattern identifies supporting index(es).
- [ ] Schemas avoid unbounded arrays, nested JSON blobs, and count-growing denormalized fields.
- [ ] Large list/search APIs use cursor/keyset pagination (not OFFSET) for scale.
- [ ] N+1 mitigation states expected query count for critical operations.
- [ ] Operations touching >1000 rows justify foreground execution or defer to worker.
- [ ] Query schemas define expected cardinality/access pattern (point lookup, range scan, full scan).
- [ ] Cache criteria covered:
- [ ] Read-heavy endpoints declare caching strategy (memory/SQLite/Redis) and TTL.
- [ ] Cache keys/tags are tenant-scoped.
- [ ] Every write path lists cache tag invalidations.
- [ ] Cache miss behavior is explicit (fallback query, cold-start behavior).
- [ ] Nested/composed data declares invalidation chains (child changes invalidate parent caches).
- [ ] Cache design prevents stale cross-tenant data leakage.

## 7. Risks, Impact & Anti-Patterns
- [ ] Risks & Impact Review includes concrete scenarios and severities.
- [ ] Each risk has mitigation and residual risk.
- [ ] Blast radius and operational detection are described.
- [ ] Anti-pattern checks:
- [ ] Does not restate obvious platform boilerplate as feature scope.
- [ ] Does not mix MVP build plan with speculative future phases.
- [ ] Does not skip undoability for state changes.
- [ ] Does not introduce cross-module ORM links.
- [ ] Does not use plural command/event naming.
