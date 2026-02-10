# Spec Review Checklist

This checklist is used during the architectural review of a specification. Every "MUST" rule from `AGENTS.md` and PR #525 is represented here.

## 1. Design Logic & Phasing
- [ ] **TLDR**: Does the spec start with a clear TLDR section (Key Points, Major Features)?
- [ ] **Market Research**: Does the spec states it's was reviewed against other open source market leaders solutions?
- [ ] **Phase 1 MVP**: Is the scope strictly limited to an MVP? Are complex features explicitly deferred?
- [ ] **User Stories**: Are there clear user stories covering the main use cases?
- [ ] **Terminology**: Does the spec reuse terminology from core modules (Sales, Catalog)?

## 2. Architecture & Module Isolation
- [ ] **No Direct ORM Links**: Are cross-module relationships handled by FK IDs only?
- [ ] **Visual Clarity**: Are complex workflows or logic illustrated with diagrams (e.g., Mermaid)?
- [ ] **Tenant Scoping**: Dose every data query include `organization_id` (and `tenant_id` where applicable)?
- [ ] **Package Location**: Is the code proposed for the correct location (`packages/` for core, `apps/mercato/src/modules/` for app-specific)?
- [ ] **DI Usage**: Are services intended to be resolved via Awilix?

## 3. Data Integrity & Security
- [ ] **Standard Columns**: Does every entity include `id`, `created_at`, `updated_at`, `deleted_at`, `organization_id`, `tenant_id`?
- [ ] **Soft Delete**: Is `deleted_at` used instead of hard deletes?
- [ ] **Zod Validation**: Are all API inputs protected by Zod schemas?
- [ ] **Encryption**: Are PII or sensitive fields identified for `findWithDecryption`?
- [ ] **Transactions**: Is `withAtomicFlush` used for multi-phase mutations?
- [ ] **Security Review (Optional)**: Does the spec address rate limiting, cookie security, and PII leakage?

## 4. Commands & Naming
- [ ] **Singular Naming (CRITICAL)**: Are all Command IDs and Event IDs using singular entity names (e.g., `pos.cart.manage`, not `pos.carts.manage`)? (Tip: Run `scripts/validate_naming.py` to check).
- [ ] **Undoability**: Is every state-changing command explicitly reversible?
- [ ] **Status Transitions**: Are entity statuses designed to be bi-directional where possible?
- [ ] **Audit Log Handler (Optional)**: Does the command specify its `buildLog` and parent references?
- [ ] **Atomic Commands**: Are multi-step actions wrapped in Compound Commands?

## 5. API & UI Consistency
- [ ] **CrudForm/DataTable**: Does the UI design leverage standard components instead of custom ones?
- [ ] **UI Design Skill**: If the spec requires backend UI, was the `backend-ui-design` skill used to ensure adherence to design and UX standards?
- [ ] **i18n**: Are all user-facing strings planned as translation keys in the i18n table?
- [ ] **PageSize**: Are list endpoint limits set to `<= 100`?
- [ ] **Migration Flow**: Is there a clear strategy for data migration and backward compatibility?
- [ ] **OpenAPI**: Are routes planned to export `openApi` metadata?

## 6. Risks & Impact
- [ ] **Failure Scenarios**: Does the spec address "What Can Go Wrong" (Network failure, race conditions, partial writes)?
- [ ] **Mitigation**: Is every risk paired with a concrete mitigation strategy?
- [ ] **Blast Radius**: Is the impact of feature failure clearly defined?

## 7. Anti-Patterns & DON'Ts
- [ ] **DON'T** document standard platform features (e.g., mandatory columns like `organization_id`, basic CRUD flow). Focus purely on the **architectural diff** and unique domain logic.

- [ ] **DON'T** mix Phase 1 technical specs with Phase 2/3 "ideas." Defer details for future phases.
- [ ] **Plural Naming (DON'T)**: Never use plural naming for entities, Command IDs, or Event IDs (e.g., NO `pos.carts.manage`). Use singular only.
- [ ] **Custom UI (DON'T)**: Avoid custom UI logic if standard `CrudForm` or `DataTable` components can be used.
- [ ] **Skip Undo (DON'T)**: Every state-changing command MUST define how it is reversed.
- [ ] **Cross-Module ORM (DON'T)**: Never create direct ORM relationships across module boundaries.

