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

- [ ] Entities include `id`, `organization_id`, `created_at`, `updated_at`
- [ ] Write operations define transaction boundaries
- [ ] Input validation uses zod schemas
- [ ] All user input validated before business logic/persistence
- [ ] Auth guards are declared (`requireAuth`, `requireRoles`, `requireFeatures`)
- [ ] Tenant isolation: every scoped query filters by `organization_id`

## 4. Commands, Events & Naming

- [ ] Naming is singular and consistent
- [ ] All mutations are commands with undo logic
- [ ] Events declared in `events.ts` before emitting
- [ ] Side-effect reversibility is documented

## 5. API & UI

- [ ] API contracts are complete (request/response/errors)
- [ ] Routes include `openApi` expectations
- [ ] UI uses `CrudForm`, `DataTable`, and shared primitives
- [ ] i18n keys are planned for user-facing strings
- [ ] Pagination limits defined (`pageSize <= 100`)

## 6. Risks & Anti-Patterns

- [ ] Risks include concrete scenarios with severity and mitigation
- [ ] Blast radius and detection described
- [ ] Does not introduce cross-module ORM links
- [ ] Does not skip undoability for state changes
- [ ] Does not mix MVP with speculative future phases
