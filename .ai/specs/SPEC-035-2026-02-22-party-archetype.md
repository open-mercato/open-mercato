# SPEC-035: Party Archetype (Identity Layer)

**Status:** Draft / proposal — for discussion; implementation not committed.

## TLDR

**Key Points:**
- Introduce a **Party** abstraction and **PartyRole** so one identity (person or company) can have multiple roles (customer, supplier, partner, competitor, etc.) without duplicating records.
- New **parties** module acts as a common dependency for customers, sales, and future modules; no direct ORM relationships between modules — referrers use `party_id` (FK).

**Scope:**
- Minimal Party concept (identity) + PartyRole (role type; no temporal validity in minimal model).
- New module `parties` with entities and optional setup; customers (and later others) depend on it.
- Document two migration paths: clean break vs phased (MappedSuperclass, keep existing customer tables, add `party_roles`, migrate referrers over time).

**Concerns:**
- Migrations, commands, search, and API referrers must stay in sync; phased path requires Mikro-ORM MappedSuperclass validation.
- Implementation may not be picked up; this spec is offered as documented research and a base for future direction.

---

## Overview

Today, **Customer** (person/company in the customers module) is the primary "who" in the system. There is no notion of roles: the same organization cannot be modelled as both customer and supplier without duplication or workarounds. This spec proposes a minimal **Party** (identity) + **PartyRole** (customer, supplier, partner, competitor, etc.) so the codebase is ready for multiple development directions (e.g. procurement, partner portals) while keeping the change scope and risk explicit.

Target audience: maintainers and contributors deciding whether and how to introduce an identity layer. The spec is written so that it can remain a documentation-only contribution if implementation is deferred.

> **Market reference:** Many ERPs (e.g. Odoo, ERPNext) use a "Contact" or "Party" with roles. This spec adopts a minimal Party + PartyRole table; it does not prescribe UI or full CRM semantics.

---

## Problem Statement

- **Single role today:** Customer entity represents "who" but has no role type. The same legal entity (e.g. a company that is both buyer and supplier) would require separate customer records or custom fields, leading to duplicated identity and inconsistent references.
- **Referrers are coupled to "customer":** Sales, activities, and other modules reference `customer_entity_id`. Introducing "supplier" or "partner" would either duplicate patterns (supplier_entity_id) or force a shared identity concept later with a larger migration.
- **Gap:** A documented, minimal Party + PartyRole design and a comparison of migration strategies (clean break vs phased) so the project can choose a path when/if it implements this.
- **Why now:** Even if no immediate multi-role use case exists, documenting this model reduces future design ambiguity and avoids ad-hoc patterns (e.g. separate supplier_entity_id, duplicated identity) once supplier or partner modules emerge. The spec can remain documentation-only until implementation is needed.

---

## Proposed Solution

### Minimal model

- **Party:** A single identity (person or company). In "clean break" this is a dedicated `parties` table; in "phased" it can be a Mikro-ORM MappedSuperclass with no table, and `CustomerEntity` extends it (identity lives in existing `customer_entities` until a later phase).
- **PartyRole:** Table `party_roles`: `party_id`, `role_type` (e.g. `customer`, `supplier`, `partner`, `competitor`), tenant and organization scoping. One party can have multiple roles. **Recommended:** PartyRole is owned and managed by the **parties** module; consuming modules (customers, sales, etc.) only assign or query roles via the parties module's application service / API, not by maintaining their own role tables.

Module **parties** provides Party (concept) and PartyRole; it does not depend on customers. **Customers** (and later sales, staff, etc.) depend on parties and reference `party_id` where identity is needed.

### Option A — Clean break

- New table `parties` (id, tenant_id, organization_id, kind, display_name, …).
- New table `party_roles` (id, party_id, role_type, …).
- One-time migration: map `customer_entities` → `parties`, backfill `party_roles` for role `customer`, update all FKs and code (commands, search, API) to use `party_id`.
- **Pros:** Single source of truth, clear model. **Cons:** Big-bang change; all referrers (migrations, commands, search, API) must be updated in one go.

### Option B — Phased (backward compatible)

- **Phase 1:** Keep `customer_entities` as-is. Add module **parties** with:
  - Party as **MappedSuperclass** (no new table); `CustomerEntity` extends Party (Mikro-ORM mapping to be validated).
  - New table **party_roles** with `party_id` pointing at current customer_entity id (or a dedicated party id later). Customers module ensures a `customer` role row for each customer entity via the parties module's service/API.
- No change yet to sales/staff FKs; they keep using `customer_entity_id` where applicable.
- **Phase 2:** New modules (e.g. suppliers) create or reuse parties via `party_roles`. Gradually migrate referrers (sales, staff, search, API) to `party_id` where identity is needed; deprecate or keep `customer_entity_id` for backward compatibility as agreed.
- **Pros:** No big bang; existing APIs and data stay valid. **Cons:** Temporary dual reference (customer_entity_id vs party_id); MappedSuperclass behavior with existing `customer_entities` table and queries must be verified (Mikro-ORM research). During the dual-reference phase, `party_id` must be derivable from `customer_entity_id` to avoid divergence.
- **Fallback:** If MappedSuperclass introduces unexpected query or migration constraints, the fallback is to introduce a dedicated `parties` table (Option A style) and migrate identity explicitly.

### Recommendation

Propose **Option B** for discussion unless the team prefers a single cutover (Option A). The MappedSuperclass path should be validated with Mikro-ORM (inheritance, discriminators, queries) before committing to Phase 1.

### Alternatives considered

| Alternative | Why rejected (for this spec) |
|-------------|------------------------------|
| No Party; only add `role_type` on CustomerEntity | Does not scale to supplier/partner as separate concerns and duplicates identity if same org is both customer and supplier. |
| Party only; no PartyRole | One role per party would require multiple party records per legal entity, defeating the goal of a single identity. |
| Consuming modules own PartyRole rows | Semantic chaos; role lifecycle and uniqueness would be scattered. Recommended: parties module owns and manages PartyRole; consumers only assign via application service. |

---

## User Stories / Use Cases

- **User** wants to **model the same company as both customer and supplier** so that **one identity is reused across sales and procurement**.
- **User** wants to **attach roles (e.g. partner, competitor) to an identity** so that **reporting and workflows can treat them consistently**.
- **Maintainer** wants **a documented migration path (clean break vs phased)** so that **implementation can be planned or deferred without losing the design**.

---

## Architecture

- **parties** (new): defines Party (concept + optional MappedSuperclass) and PartyRole entity; owns and manages PartyRole; no dependency on customers.
- **customers:** depends on parties; either extends Party (Option B) or references `party_id` (Option A / Option B Phase 2); assigns customer role via parties' application service.
- **sales / staff / others:** reference `party_id` when identity is needed (Phase 2 in Option B). No direct ORM relations across modules; use FK IDs and separate fetches (per AGENTS.md).

Data flow: create/update Party (or CustomerEntity as Party) → assign roles via parties module service → referrers query by `party_id` and optionally filter by `role_type`.

### Commands & Events (to be refined in implementation)

- Commands: e.g. `parties.party.create`, `parties.party_role.assign`; customers module calls into parties for role assignment.
- Events: e.g. `parties.party.created`, `parties.party_role.assigned` — to be aligned with existing event conventions when implemented.

---

## Data Models

### Party (conceptual)

- **Option A:** Dedicated table `parties`: `id` (UUID), `tenant_id`, `organization_id`, `kind` (person | company), `display_name`, optional common fields (e.g. `primary_email`, `primary_phone`), `is_active`, `created_at`, `updated_at`, `deleted_at`.
- **Option B Phase 1:** No table; MappedSuperclass with same logical fields; `CustomerEntity` maps to `customer_entities` table with these fields.

**Canonical contact data ownership** (display_name, primary_email, primary_phone, etc.): to be decided if/when Party becomes a dedicated table; in Phase 1, CustomerEntity continues to own these fields.

### PartyRole (minimal)

- `id`: UUID
- `party_id`: UUID (FK to parties or, in Option B Phase 1, to customer_entities id)
- `role_type`: string (e.g. `customer`, `supplier`, `partner`, `competitor`)
- `tenant_id`, `organization_id`: for scoping
- `created_at`, `updated_at`, `deleted_at`
- Unique constraint: `(party_id, role_type)`.

**Minimal model omits** `valid_from` / `valid_to` to keep Phase 1 simple (fewer indexes, no temporal uniqueness edge cases). Temporal validity can be added in a follow-up if business requirements demand it.

---

## API Contracts

To be detailed when implementation is chosen. Example direction:

- **GET /api/parties** — list parties (filter by organization, optional role_type).
- **GET /api/parties/:id** — party detail.
- **GET /api/parties/:id/roles** — list roles for a party.
- **POST /api/parties** — create party (Option A) or delegate to customers when Party is MappedSuperclass.
- **POST /api/parties/:id/roles** — assign role (idempotent; owned by parties module).

Existing customer and sales APIs continue to work; Phase 2 may add `party_id` to responses and optionally deprecate customer-only identifiers where it makes sense.

---

## Migration & Compatibility

- **Option A:** One migration: create `parties` and `party_roles`; migrate `customer_entities` → `parties`; add `party_id` to referrers; drop or keep `customer_entity_id` with a clear deprecation path.
- **Option B Phase 1:** Migration only for `party_roles` table; backfill `party_roles` from existing customer_entities (role_type = customer). No change to `customer_entities` schema.
- **Option B Phase 2:** Add `party_id` to referrers as needed; optional backfill from existing customer_entity_id to party_id; keep backward compatibility as agreed.

---

## Implementation Plan (high level)

### Phase 1 — Foundation (Option B)

1. Add **parties** module (structure: `data/entities`, `acl`, `setup` if needed).
2. Implement Party (MappedSuperclass or table) and PartyRole entity; add `party_roles` migration (no valid_from/valid_to).
3. Customers: CustomerEntity extends Party (if MappedSuperclass); ensure one `party_roles` row per customer with role_type = customer via parties module service.
4. Document all referrers that still use `customer_entity_id` vs `party_id` (commands, search, API).

### Phase 2 — Referrers (Option B)

1. Sales/staff and other referrers switch to `party_id` where identity is required; keep or deprecate old FKs.
2. Search: index by `party_id` and optionally by `role_type`.
3. API: expose `party_id` where appropriate; align OpenAPI and clients.

### Open Questions

- Mikro-ORM: does MappedSuperclass work with the existing `customer_entities` table and current query patterns (filters, indexes)?
- Temporal validity: `valid_from` / `valid_to` on PartyRole can be added in a follow-up if business requirements demand it; minimal model keeps uniqueness as `(party_id, role_type)` only.

### Fallback

If MappedSuperclass introduces unexpected query or migration constraints, fallback is to introduce a dedicated `parties` table (Option A style) and migrate identity explicitly.

---

## Risks & Impact Review

### Migration & Deployment

- **Option A:** Large migration and referrer updates; risk of partial failure. Mitigation: single transaction for data migration; checklist of all referrers (commands, search, API). Residual: deployment and testing burden.
- **Option B Phase 1:** Low risk; new table and backfill only. Residual: temporary dual model (customer_entity_id vs party_id).
- **Option B Phase 2:** Same as Option A but scoped per referrer; can be done incrementally. **MappedSuperclass:** If constraints appear, fallback to Option A (dedicated parties table).

### Tenant & Data Isolation

- All new tables and FKs must be scoped by `tenant_id` / `organization_id`; queries must filter by tenant. Mitigation: follow existing patterns in customers/sales. Residual: none if implemented per AGENTS.md.

### Data Integrity

- Backfill of `party_roles` must be idempotent and consistent (one role per party/role_type; uniqueness `(party_id, role_type)`). Mitigation: migration in transaction; validation in application layer. Residual: none if constraints are in place.

---

## Final Compliance Report — 2026-02-22

### AGENTS.md files reviewed

- Root `AGENTS.md`
- `packages/core/AGENTS.md`

### Compliance matrix

| Rule | Status | Notes |
|------|--------|-------|
| No direct ORM relationships between modules | Compliant | Parties and referrers use FK IDs only |
| Filter by organization_id / tenant | Compliant | All entities scoped |
| Validate inputs (zod); validators in data/validators | To be applied at implementation | N/A for spec-only |

### Internal consistency

| Check | Status |
|-------|--------|
| Data models align with Option A/B | Pass |
| API section marked as "to be detailed when implemented" | Pass |
| Risks cover migration and isolation | Pass |

### Verdict

- **Spec as documentation:** Approved for inclusion. Implementation to follow AGENTS.md and module conventions when/if the project proceeds.

---

## Author note

This spec is offered as a draft for discussion and possible future implementation. The author may not be able to own full implementation; the research and documented options (clean break vs phased) are intended as a contribution to the project's direction. It is understood that the spec may remain a documentation-only artifact.

