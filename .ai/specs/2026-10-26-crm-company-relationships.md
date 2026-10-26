# CRM Company Relationships

## 📝 TLDR

Let CRM users record typed relationships between two companies. Each tenant/organization defines its own **relationship types**. A type has a name and a **dependency type**: `parent_child` (directional; each side has its own label, e.g. "Parent company" / "Subsidiary") or `equal` (symmetric, one label, e.g. "Partner"). A new **Relationships** tab on the v2 company detail page lists the company's direct relationships and lets users add, edit and remove them. Everything stays inside the `customers` module.

## 📝 Overview

- **Module:** `packages/core/src/modules/customers` (the reference CRUD module).
- **Surfaces touched:** two new entities plus migration, two CRUD APIs, one read API scoped to a company, one settings section, one new tab on `backend/customers/companies-v2/[id]`, and an extra blocker in the company delete command.
- **Out of scope (deferred):** hierarchy tree / corporate-group view, extra fields on a relationship (notes, dates, custom fields), the classic `companies/[id]` page, person↔person and person↔company relationships, AI tools, fulltext search over relationships.

## 📝 Problem Statement

The CRM links people to companies (`customer_person_company_links`) and deals to companies (`customer_deal_companies`). It cannot say how two companies relate to each other. B2B users can't record corporate groups (holding → subsidiaries), franchise networks or peer partnerships. Today they fall back on tags or notes, which can't be queried, aren't directional, and don't show up from the other company's side.

## 📝 Proposed Solution

1. **Relationship types**: a new tenant/org-scoped entity managed in Customers configuration (`/backend/config/customers`), next to Pipelines and Dictionaries.
2. **Company relationships**: a new entity with one row per relationship, connecting two `customer_entities` rows of kind `company`. For `parent_child`, `source` is the parent and `target` is the child. For `equal`, the pair is stored in canonical order (lower UUID as `source`), so A↔B and B↔A are the same row.
3. **Invariants enforced by the server** (inside the command, in a transaction):
   - no relationship from a company to itself;
   - no duplicate (same type + same pair; for `equal` types the order of the pair doesn't matter);
   - **one parent per company per `parent_child` type**;
   - **no cycles** within a `parent_child` type;
   - both companies are in the same tenant and organization as the relationship.
4. **Relationships tab** (v2 company page only): a flat list of the company's direct relationships, each shown from the viewed company's point of view ("Parent company: Acme Holding", "Subsidiary: Acme Retail", "Partner: Foo Ltd"). Adding reuses `LinkEntityDialog` + `companyAdapter`; editing and deleting are row actions.
5. **Seeded defaults** per tenant/org in `setup.ts` → `seedDefaults`: "Corporate group" (`parent_child`, labels "Parent company" / "Subsidiary") and "Partner" (`equal`). Names and labels are resolved through `resolveTranslations()` at seed time (locale keys under `customers.companyRelationshipTypes.defaults.*`); after seeding they are ordinary user-editable data.

### Alternatives considered

| Alternative | Why it lost |
|---|---|
| A new dictionary kind in `customer_dictionary_entries` | A dictionary entry has nowhere to store the dependency type or the per-side labels, and can't enforce "block delete while in use" or "dependency type frozen while in use" without special-casing the generic dictionary commands. |
| A self-referencing `parent_company_id` column on `customer_companies` (the Odoo/Salesforce "Parent Account" approach) | Covers only one hierarchy and no peer relationships. Typed relationships handle both. |
| Two directed rows for `equal` relationships (A→B and B→A) | Two rows to keep in sync on every write and undo. A canonical single row plus a direction-agnostic read query is simpler. |

### Market check

- **Salesforce:** "Parent Account" (one parent, one hierarchy) plus, in Financial Services Cloud, *Account-Account Relationships* with **reciprocal roles**, where each side has its own label. This matches our per-side labels for `parent_child`.
- **HubSpot:** company-to-company *association labels*, either paired (e.g. "Parent"/"Child", one parent company) or unpaired (symmetric). This is the same split as `parent_child` vs `equal`. HubSpot limits the built-in parent/child association to one parent, the same as our single-parent rule.
- **Odoo:** a single `parent_id` on the partner record, so one hierarchy and no peers.
- **What we skip for v1:** the hierarchy tree view (Salesforce "View Hierarchy"), association limits per type, and relationship-level custom fields.

## 📝 Architecture

```
Settings (config/customers)                  Company v2 detail page
  CompanyRelationshipTypeSettings              CompanyDetailTabs  ── 'relationships' tab
        │ apiCall + useGuardedMutation              │
        ▼                                           ▼ CompanyRelationshipsSection
/api/customers/company-relationship-types    GET /api/customers/companies/{id}/relationships   (oriented read)
        │ makeCrudRoute + commands            /api/customers/company-relationships             (writes)
        ▼                                           │ makeCrudRoute + commands
customer_company_relationship_types ◄──FK── customer_company_relationships ──FK──► customer_entities (×2)
```

- **Reused:** `makeCrudRoute` with `indexer`, the undoable command pattern (`commands/pipelines.ts`, `commands/personCompanyLinks.ts`), `withAtomicFlush`, `emitCrudSideEffects` / `emitCrudUndoSideEffects`, `LinkEntityDialog` + `components/linking/adapters/companyAdapter.tsx` (with `renderLinkSettings` for type and direction), `useGuardedMutation`, `buildOptimisticLockHeader` / `surfaceRecordConflict`, `CompanyDetailTabs`.
- **New files** (under `customers/`): `commands/companyRelationshipTypes.ts`, `commands/companyRelationships.ts`, `lib/companyRelationships.ts` (invariant checks, canonical ordering, orientation helper), `api/company-relationship-types/route.ts`, `api/company-relationships/route.ts`, `api/companies/[id]/relationships/route.ts`, `components/CompanyRelationshipTypeSettings.tsx`, `components/detail/CompanyRelationshipsSection.tsx`, `components/detail/CompanyRelationshipDialog.tsx`.
- **ACL:** no new features. Types: read with `customers.companies.view`, write with `customers.settings.manage`. Relationships: read with `customers.companies.view`, write with `customers.companies.manage`. All three features already exist. With the default grants in `setup.ts`, only admins (via `customers.*`) can manage types; employees can view types and manage relationships if they hold `customers.companies.manage`.
- **Coupling:** everything is inside `customers`. ORM relations between these entities and `CustomerEntity` are allowed because they are in the same module. No other module is touched.

## 📝 Data Model

### `customer_company_relationship_types` — `CustomerCompanyRelationshipType`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organization_id`, `tenant_id` | uuid | scope |
| `name` | text | required, 1–150 chars; the type's name in settings and pickers; also the label on both sides for `equal` |
| `dependency_type` | text | `'parent_child' \| 'equal'`; **cannot change while active relationships use the type** |
| `parent_label` | text, nullable | how the parent is described from the child's side (e.g. "Parent company"); required when `parent_child`, null when `equal` |
| `child_label` | text, nullable | how the child is described from the parent's side (e.g. "Subsidiary"); required when `parent_child`, null when `equal` |
| `normalized_name` | text | lower-cased, trimmed `name`; used for uniqueness |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | `updated_at` has onCreate + onUpdate (optimistic locking) |

Indexes: `(organization_id, tenant_id)`; unique `(organization_id, tenant_id, normalized_name) WHERE deleted_at IS NULL`.

### `customer_company_relationships` — `CustomerCompanyRelationship`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id`, `tenant_id` | uuid | scope; must equal both companies' scope |
| `relationship_type_id` | uuid FK → `customer_company_relationship_types.id` | `ManyToOne` |
| `dependency_type` | text | copied from the type at write time; lets partial unique indexes target `parent_child` rows (it stays correct because the type's dependency type is frozen while in use) |
| `source_company_entity_id` | uuid FK → `customer_entities.id` | parent for `parent_child`; lower UUID for `equal` |
| `target_company_entity_id` | uuid FK → `customer_entities.id` | child for `parent_child`; higher UUID for `equal` |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | soft delete for undo |

Constraints and indexes:
- `CHECK (source_company_entity_id <> target_company_entity_id)`
- `CHECK (dependency_type <> 'equal' OR source_company_entity_id < target_company_entity_id)` (backs the canonical order in the DB; JS compares lowercased UUID strings, which sorts the same as Postgres `uuid` ordering)
- unique `(relationship_type_id, source_company_entity_id, target_company_entity_id) WHERE deleted_at IS NULL` (no duplicates)
- unique `(relationship_type_id, target_company_entity_id) WHERE deleted_at IS NULL AND dependency_type = 'parent_child'` (single parent)
- indexes `(organization_id, tenant_id)`, `(source_company_entity_id)`, `(target_company_entity_id)`

The two unique indexes back up the application-level checks: a concurrent race fails with a mapped 409 instead of writing a bad row. No column holds sensitive data, so there are no encryption entries.

Migration: one SQL migration in `customers/migrations/` plus an updated `.snapshot-open-mercato.json`. Purely additive. Both entities are registered for the query indexer (entity ids generated by `yarn generate`; `makeCrudRoute` `indexer: { entityType }`).

## 📝 API Contracts

All routes are tenant/org scoped through the standard `withScopedPayload` / organization-scope helpers. List and detail responses include `updatedAt`. Writes go through the command bus (undoable), mutation guards and optimistic locking (default ON).

### Relationship types — `/api/customers/company-relationship-types` (`makeCrudRoute`)

- `GET` (`customers.companies.view`): paginated (`pageSize` ≤ 100), `search`, `ids`. Each item: `{ id, name, dependencyType, parentLabel, childLabel, usageCount, updatedAt }`. `usageCount` is the number of active relationships of the type, used by the settings UI to explain why a type can't be deleted or have its dependency type changed. It is added in the route's `afterList` hook with one grouped `count(*) … group by relationship_type_id` query over the ids on the page.
- `POST` / `PUT` (`customers.settings.manage`): zod schema in `data/validators.ts`:
  ```ts
  { name: string(1..150), dependencyType: 'parent_child' | 'equal',
    parentLabel?: string(1..150) | null, childLabel?: string(1..150) | null }
  ```
  Refinement: `parentLabel` and `childLabel` are both required when `parent_child` and both forced to `null` when `equal`.
  - `409 customers.companyRelationshipTypes.errors.duplicateName` when the name is taken.
  - `409 …errors.dependencyTypeLocked` when `PUT` changes `dependencyType` while `usageCount > 0`.
- `DELETE` (`customers.settings.manage`): soft delete.
  - `409 …errors.inUse` (with `count`) while active relationships reference the type.
- Commands: `customers.company_relationship_types.{create,update,delete}`, each with undo.

### Relationships — writes at `/api/customers/company-relationships` (`makeCrudRoute`)

- `POST` (`customers.companies.manage`):
  ```ts
  { relationshipTypeId: uuid, sourceCompanyId: uuid, targetCompanyId: uuid }
  ```
  For `parent_child`, `source` is the parent. For `equal`, the server puts the pair in canonical order before storing, so callers can send it in either order.
- `PUT` (`customers.companies.manage`): `{ id, relationshipTypeId?, sourceCompanyId?, targetCompanyId? }`. Lets the user change the type or swap the direction. The pair of companies must stay the same (only its order may change). On every update the command:
  - recomputes `dependency_type` from the (possibly new) type;
  - re-canonicalizes the pair when the new type is `equal`;
  - requires explicit `sourceCompanyId` and `targetCompanyId` when the new type is `parent_child` and the old one was `equal` (otherwise `400 …errors.directionRequired`), so the stored UUID order never silently becomes the direction;
  - re-runs all invariant checks against the new type.
- `DELETE` (`customers.companies.manage`): soft delete.
- `GET` (`customers.companies.view`): generic list filtered by `companyId` / `relationshipTypeId` / `ids` (for API consumers and the indexer).
- Commands: `customers.company_relationships.{create,update,delete}`, each with undo.
- Errors (`409`, translated):

  | Key | When |
  |---|---|
  | `…errors.selfRelation` | both sides are the same company |
  | `…errors.duplicate` | the same type already links this pair |
  | `…errors.parentExists` | the child already has a parent of this type; the response includes `{ existingParent: { id, displayName } }` |
  | `…errors.cycle` | the new link would make the parent its own descendant |
  | `…errors.companyNotFound` | a company is missing, deleted, or in another scope; returned as `404` |
  | `…errors.typeNotFound` | the type is missing, deleted, or in another scope; returned as `404` |

### Relationships for one company — `GET /api/customers/companies/{id}/relationships`

Feature `customers.companies.view`. This is a read-only route modelled on `api/companies/[id]/people/route.ts`. Query: `page`, `pageSize` (≤ 100, default 50), `search` (related company name), `relationshipTypeId`.

```ts
{ items: Array<{
    id, updatedAt,
    role: 'parent' | 'child' | 'peer',          // the RELATED company's role relative to {id}
    label: string,                               // parentLabel | childLabel | name, chosen by role
    relationshipType: { id, name, dependencyType, parentLabel, childLabel },
    relatedCompany: { id, displayName, deletedAt: null },
  }>,
  total, page, pageSize }
```

Related company names are loaded with `findWithDecryption`. `display_name` is encrypted (`encryption.ts`), so `search` and the name sort can't run in SQL: like `api/companies/[id]/people/route.ts`, the route loads the company's active relationships (bounded fetch, capped at 1000 rows), decrypts, then filters, sorts and paginates in memory. Rows whose related company isn't visible under the caller's organization scope are left out.

### Invariant checks (`lib/companyRelationships.ts`)

These run inside `withAtomicFlush(em, …, { transaction: true })` in the create, update, undo-of-update and undo-of-delete commands:

1. Lock the involved type rows with `PESSIMISTIC_WRITE` (`SELECT … FOR UPDATE`): the one type on create/undo-of-delete; the old and the new type on update/undo-of-update, always in ascending id order to avoid deadlocks. This serializes all writes for one type, so two concurrent inserts can't together form a cycle. The type's `dependency_type` is read **after** the lock is taken.
2. Lock both company `customer_entities` rows with `PESSIMISTIC_WRITE`, in ascending id order. `deleteCompanyCommand` takes the same lock (issue #7613), so a relationship insert and a company delete serialize instead of racing into an FK violation.
3. Check both companies (`kind = 'company'`, not deleted, same tenant and organization) and the type (not deleted).
4. Check self-relation, duplicate and single parent (these mirror the DB indexes and produce friendly errors).
5. **Cycle check** (`parent_child` only): use a recursive CTE to walk *up* from the proposed parent over active rows of the same type. If the proposed child appears among the ancestors, reject. The single-parent rule means the walk is a simple chain, bounded by the depth of the hierarchy. Add a guard limit (e.g. 1000 hops) that fails closed.

**Type-side serialization.** The type update, type delete, undo-of-type-update and undo-of-type-delete commands take the same `PESSIMISTIC_WRITE` lock on the type row before checking `dependencyTypeLocked` / `inUse`. A relationship write and a type change therefore can't interleave, which is what keeps the copied `dependency_type` on relationship rows correct.

### Company delete (`commands/companies.ts`)

`deleteCompanyCommand` counts active relationships where the company is the source or the target, and adds a `customers.companies.delete.blockers.relationships` entry ("company relationships ({{count}})") to `buildCompanyHasDependentsError`. The company delete is blocked, the same way active person links already block it. Soft-deleted relationship rows referencing the company are hard-deleted in the same transaction to satisfy the FKs, following the existing person-link precedent. Because the company itself is hard-deleted:
- an earlier relationship delete can no longer be undone once the company is gone (undo fails with `404 companyNotFound`);
- undoing the company delete restores the company but none of its earlier, already-removed relationships.

### Events (`events.ts`, additive)

- `customers.company_relationship_type.{created,updated,deleted}` (`category: 'crud'`)
- `customers.company_relationship.{created,updated,deleted}` (`category: 'crud'`, `clientBroadcast: true`, so open company pages on either side refresh the tab). The payload carries `id`, `relationshipTypeId`, `sourceCompanyEntityId`, `targetCompanyEntityId`, `organizationId` and `tenantId`; the tab refetches when its company id is either side.

## 📝 UI/UX

### Settings: `CompanyRelationshipTypeSettings` in `CustomersConfigurationSections`

- A table with columns Name, Dependency type ("Parent → child" / "Equal"), Labels ("Parent company / Subsidiary" or "—") and In use (count). Row actions: Edit, Delete.
- The create/edit dialog has Name, Dependency type (radio) and, for `parent_child` only, Parent label and Child label, with a short preview line: "Acme Holding is the *Parent company* of Acme Retail; Acme Retail is a *Subsidiary* of Acme Holding".
- The Dependency type radio is disabled while the type is in use, with a hint explaining why.
- Delete on a type that's in use shows the `inUse` error through the standard flash; the button isn't hidden, so the reason is visible.
- Non-`CrudForm` writes go through `useGuardedMutation` with optimistic-lock headers. Dialogs support `Cmd/Ctrl+Enter` to submit and `Escape` to cancel.

### Company v2 detail page: Relationships tab

- **Tab registration:** `CompanyDetailTabs` gets a built-in `'relationships'` tab (icon `Network`, label `customers.companies.tabs.relationships`) placed after People, with an optional additive `relationshipsCount` badge prop. The tab is shown to everyone with `customers.companies.view`. Add/Edit/Delete controls appear only with `customers.companies.manage`.
- **`CompanyRelationshipsSection`:** a flat list sorted by type name and then related company name. Each row shows:
  - the **label** chip (role-aware: "Parent company", "Subsidiary", "Partner");
  - the related company name, linking to that company's v2 page;
  - the type name, as muted secondary text;
  - row actions: Edit, Remove (with a confirm dialog).

  Above the list sit a search box, a type filter, and an **Add relationship** button that owns its own toolbar action, following `2026-10-03-customer-tab-actions.md`.
- **Add:** opens `LinkEntityDialog` with an adapter from `createCompanyLinkAdapter({ excludeIds })`, where `excludeIds` holds the current company. Already-related companies stay selectable, because a company can be related through several types. `renderLinkSettings` provides:
  - a **Type** select;
  - for `parent_child` types, a **"Selected company is"** toggle with the two labels as options ("Parent company" / "Subsidiary").

  On confirm, the client sends one `POST` per company in `addedIds`. Successes and failures are reported separately: a success flash with the count, and one error line per failed company with the translated reason. When "Selected company is" is set to the parent side and more than one company is added, the confirm handler rejects before any `POST` with a translated local error (`createCrudFormError`), because the current company can have only one parent per type. This needs no change to the `LinkEntityDialog` contract.
- **Edit:** `CompanyRelationshipDialog` changes the type and/or swaps the direction. The related company can't change; to point at another company, remove the relationship and add a new one. The `PUT` is wrapped in `withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), …)`, and conflicts go through `surfaceRecordConflict(err, t)`.
- **States:** `LoadingMessage`, `ErrorMessage`, and an empty state with a short explanation plus an Add button (when permitted). An SSE event `customers.company_relationship.*` that involves this company triggers a refetch.
- All strings come from the `customers` locale files. Only DS tokens are used, with no status colors (the label chip uses the neutral `Tag`/`Badge` variant).

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Two users at once make A parent of B and B parent of A (same type) | The type-row lock serializes them. The second write sees the first and gets `409 cycle`. |
| Two users at once add different parents to the same child | The single-parent partial unique index rejects the second insert, and the DB error maps to `409 parentExists`. |
| Changing the dependency type of a type that's in use | `409 dependencyTypeLocked`; the UI disables the control in advance. |
| Deleting a type that's in use | `409 inUse` with a count. |
| Deleting a company that has relationships | Blocked by the existing dependents error, which now also lists "company relationships (N)". |
| Undo of a relationship delete after the same slot was taken (another parent added, or a cycle formed) | Undo re-runs the invariant checks and fails with the same translated 409. The row stays deleted. |
| Undo of a type delete when the name is taken again | Fails with `409 duplicateName`. |
| Undo of a relationship update after the old slot was taken | Undo-of-update locks old and new types, re-runs the checks and fails with the matching 409; the row keeps its current state. |
| Changing a relationship from an `equal` to a `parent_child` type without choosing a direction | `400 directionRequired`; the edit dialog always sends the direction, so only raw API callers hit this. |
| A company is deleted while someone adds a relationship to it | Both commands lock the company row, so they serialize: either the delete is blocked by the new relationship, or the create gets `404 companyNotFound`. |
| Undo of an old relationship delete after one of its companies was deleted | Fails with `404 companyNotFound` (the company delete hard-deleted the soft-deleted row). |
| Related company is outside the caller's organization scope | Writes return 404 `companyNotFound`; the read endpoint leaves the row out. |
| Renaming a type or its labels | Every relationship of that type shows the new labels immediately, because labels are resolved at read time. |
| Stale edit | `409` optimistic-lock conflict, shown through the unified conflict bar. |
| A large group (hundreds of subsidiaries) | The tab paginates (`pageSize` ≤ 100), with search and a type filter. |

## 📝 Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Company deletion is newly blocked by relationships | Medium | `commands/companies.ts`, UX | Uses the existing blocker message pattern, the user sees exactly what to remove, and only data created after this feature is affected | Low |
| Contention from the cycle-check lock | Low | write throughput for one type | The lock is per type, the transaction is short, and relationship writes are rare | Low |
| `dependency_type` copy on relationship rows drifts from the type | Medium | data integrity | The type's `dependencyType` is immutable while `usageCount > 0`; type commands and relationship commands take the same type-row lock, and relationship updates recompute the copy | Low |
| Deadlock between relationship writes | Low | write availability | Type rows and then company rows are always locked in ascending id order | Low |
| In-memory filtering on the per-company read | Low | performance | Bounded fetch (1000 rows), the same approach as the company People tab | Low |
| Cross-tenant leak through the related company | High | security | Writes require both companies to match the relationship scope, reads filter by scope, and integration tests cover a cross-org attempt | Low |
| Contract surfaces (`BACKWARD_COMPATIBILITY.md`) | Low | API, events, DB, UI | Everything is additive: new tables, routes and events; a new built-in tab id (`CompanyTabId` already accepts `string`); a new optional `relationshipsCount` prop on `CompanyDetailTabs` for the badge; no change to `LinkEntityDialog`; no existing route, event or ACL id changes | None |

**Rollback:** turn off the UI by reverting the tab and settings section. The tables are additive and can stay. Reverting the migration drops both new tables and nothing else.

## 📋 Phasing

1. **Phase 1 — Relationship types:** entity, migration, validators, commands, CRUD API, events, seed defaults, settings section, i18n, tests. It ships alone: admins can define types.
2. **Phase 2 — Relationships backend:** entity, migration, invariant library, commands with undo, write API plus the per-company read API, company-delete blocker, events, tests. It ships alone: the API is usable.
3. **Phase 3 — Relationships tab (v2):** tab registration, section, add/edit dialogs, live refresh, integration tests. This completes the feature.

## 📋 Implementation Plan

### Phase 1 — Relationship types
1. Add `CustomerCompanyRelationshipType` to `data/entities.ts`, generate the migration with `yarn db:generate` (keep only this change) and update the snapshot. **Test:** `yarn db:generate` reports no changes afterwards.
2. Add zod schemas (create/update/delete, with the `parent_child` label refinement) to `data/validators.ts`. **Test:** validator unit tests.
3. Add `commands/companyRelationshipTypes.ts` (create/update/delete with undo, all under the type-row lock; duplicate-name check now; the `dependencyTypeLocked` and `inUse` checks are written against a usage-count helper that returns 0 until Phase 2) and register the events. **Test:** command unit tests, including undo.
4. Add `api/company-relationship-types/route.ts` (`makeCrudRoute` + `indexer`, OpenAPI; `usageCount` in `afterList`, always 0 until Phase 2). Run `yarn generate`. **Test:** route unit tests.
5. Seed "Corporate group" and "Partner" in `seedDefaults`, skipping when a type with the same normalized name exists. **Test:** seeding is idempotent.
6. Add `CompanyRelationshipTypeSettings` to `CustomersConfigurationSections`, plus i18n keys for all locales. **Test:** component test; `yarn i18n:check-sync`.
7. Integration tests TC-CRM-REL-001/002 (below).

### Phase 2 — Relationships backend
1. Add `CustomerCompanyRelationship` with the check constraint and partial unique indexes, migration and snapshot.
2. Add `lib/companyRelationships.ts`: canonical ordering, orientation (`role`/`label`) and the invariant checks, including the recursive-CTE cycle check under the type-row lock. **Test:** unit tests for each invariant and for orientation.
3. Add `commands/companyRelationships.ts` (create/update/delete with undo; update and both undos re-validate; type change recomputes `dependency_type` and the pair order; DB unique violations map to translated 409s) and events with `clientBroadcast` and both company ids in the payload. Wire the real usage count into the type commands and `afterList`. **Test:** command unit tests, including a type change from `equal` to `parent_child` and back.
4. Add `api/company-relationships/route.ts` (writes plus generic GET) and `api/companies/[id]/relationships/route.ts` (oriented read). **Test:** route unit tests.
5. Extend `deleteCompanyCommand` with the relationships blocker and the cleanup of soft-deleted rows. **Test:** extend the existing company-delete tests.
6. Integration tests TC-CRM-REL-003..006 and TC-CRM-REL-010.

### Phase 3 — Relationships tab (v2 company page)
1. Add the `'relationships'` tab plus the optional `relationshipsCount` to `CompanyDetailTabs`. **Test:** update `CompanyDetailTabs.test.tsx`.
2. Add `CompanyRelationshipsSection` (list, search, type filter, empty/loading/error states, SSE refetch) and render it in `companies-v2/[id]/page.tsx` when `activeTab === 'relationships'`. **Test:** section component test.
3. Add the add flow through `LinkEntityDialog` + `companyAdapter` with `renderLinkSettings`, per-company result reporting, and the single-parent selection limit. **Test:** component test.
4. Add `CompanyRelationshipDialog` (edit: type and direction, optimistic lock, conflict bar) and remove with confirm, both through `useGuardedMutation`. **Test:** component test.
5. Integration tests TC-CRM-REL-007..009, then the full validation gate (`.ai/agentic.config.json`).

### Integration coverage (`customers/__integration__/`, self-contained fixtures created via the API, cleaned up in teardown)

| ID | Path | Scenario |
|---|---|---|
| TC-CRM-REL-001 | `/api/customers/company-relationship-types` | CRUD; label refinement; duplicate name → 409 |
| TC-CRM-REL-002 | `/backend/config/customers` | create/edit/delete a type in settings |
| TC-CRM-REL-003 | `/api/customers/company-relationships` | create `parent_child` and `equal`; `equal` stored canonically (B↔A duplicate → 409); self-relation → 409 |
| TC-CRM-REL-004 | same | second parent → 409 `parentExists`; A→B→C then C→A → 409 `cycle`; update swap direction |
| TC-CRM-REL-005 | same + `/api/customers/companies/{id}/relationships` | orientation (`role`/`label`) from both sides; company in another org → 404 and not listed |
| TC-CRM-REL-006 | `DELETE /api/customers/companies` | delete blocked while relationships exist; allowed after they're removed |
| TC-CRM-REL-007 | `/backend/customers/companies-v2/{id}?tab=relationships` | add a subsidiary through the dialog; it appears on both companies with the correct labels |
| TC-CRM-REL-008 | same | edit (swap direction), remove with confirm, empty state |
| TC-CRM-REL-009 | same | a user with `customers.companies.view` only sees the list without Add/Edit/Remove |
| TC-CRM-REL-010 | `/api/customers/company-relationship-types` + `/backend/config/customers` (Phase 2) | type in use: `PUT` changing `dependencyType` → 409, `DELETE` → 409 `inUse`; settings UI disables the dependency type and shows the delete error |

## 📝 Final Compliance Report

- Inside a single module; no cross-module ORM relations: ✅
- Tenant/org scoping on every read and write; cross-org test included: ✅
- `makeCrudRoute` + `indexer`, undoable commands, `withAtomicFlush`, side effects after commit: ✅
- Optimistic locking (`updated_at`, `updatedAt` in responses, lock headers in custom dialogs): ✅
- Reuses existing ACL features; no new ones: ✅
- i18n for all strings; DS tokens only; dialog keyboard shortcuts: ✅
- Additive contract changes only (`BACKWARD_COMPATIBILITY.md`): ✅
- Integration tests listed for every new API and UI path: ✅

## Changelog

- 2026-10-26: Applied the architectural review: type-change semantics on `PUT` (`directionRequired`, recomputed `dependency_type` and pair order); lock ordering for types and company rows (company-delete race, #7613); type-side lock serialization; undo-of-update re-validation; `excludeIds` instead of `clientFilter`, and a single-parent check in the confirm handler; in-memory search because `display_name` is encrypted; consequences of the company hard delete for undo; DB `CHECK` for canonical order; `usageCount` via `afterList`; both company ids in the event payload; translated seeds; precise ACL wording; in-use integration case moved to Phase 2 (TC-CRM-REL-010).
- 2026-10-26: Initial spec. Open Questions resolved: per-side labels for `parent_child`; dedicated types table; block cycles and allow one parent per type; reject duplicates; no extra relationship fields; block deleting a type in use; v2 company page only; seed default types; flat list (tree view deferred).
