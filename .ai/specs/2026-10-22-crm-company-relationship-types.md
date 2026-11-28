# CRM company relationship types

**Date:** 2026-10-22 · **Status:** Draft · **Issue:** [#7700](https://github.com/open-mercato/open-mercato/issues/7700)

## 📝 TLDR

Let one company be a customer account, partner, supplier or another tenant-defined business relationship at the same time. Add a company-only multi-select backed by customer dictionaries and scoped assignments, with list filtering and full aggregate undo. Lifecycle, person buying roles, company hierarchy, access control and legal identity remain separate concepts.

## Resolved assumptions (autonomous defaults)

| ID | Question | Default and rationale |
|---|---|---|
| T1 | Bundle with lifecycle consolidation? | No. Independent review found this feature works without any legacy lifecycle/health/renewal migration; it has its own specification. |
| T2 | Does type imply permissions, ownership or inheritance? | No. It is descriptive company classification only; no effect on lifecycle, people, children, sales authorization or visibility. |
| T3 | Can old integrations omit the field? | Yes. Omitted means unchanged; empty array explicitly clears; no pre-existing record is auto-classified. |

## 📝 Overview and Problem Statement

At baseline `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`, customer companies have single-value lifecycle/status fields but no first-class multi-valued relationship classification. A supplier can also be a customer; forcing one lifecycle/status to encode both concepts creates ambiguous filters. The requirement comes directly from #7700. [HubSpot's property documentation](https://knowledge.hubspot.com/properties/hubspots-default-contact-properties) shows why lifecycle and other classifications need explicit separate purposes; this spec does not claim market evidence for its exact seeded role names.

As an account manager, I can mark a company both customer and reseller without changing its lifecycle. As an operator, I can filter all companies that are suppliers or partners and export the same set.

## 📝 Proposed Solution and Architecture

Keep the feature wholly in customers. Use the customers dictionary kind `relationship-types` (existing custom-kind identity mapping) and company assignment entity. Existing `customers.companies.create/update/delete` commands own the assignment lifecycle; the company `updatedAt` is the concurrency token for the multi-select. No standalone child mutation route, generic graph mechanism, new DI service or cross-module relation is necessary.

Use `runCrudCommandWrite`/atomic flush phases so company edits, relationship assignments and snapshots commit together. Read existing assignments before mutation; then replace only the validated requested set. Omitted values preserve, `[]` clears, duplicates collapse. If a requested set exceeds 32 unique tokens reject it. Explicit `null` is invalid, because empty and omitted already have separate meanings. Set replacement soft-deletes removed assignments. Existing company deletion physically removes its profile/entity, so that command also physically removes all of its assignment rows within the same transaction after snapshotting them; undo/redo restores the saved rows and company under normal scoped permissions and conflict handling. Capture IDs, values and deletion state so undo does not mint unrelated records or violate the company FK.

After commit emit existing company CRUD/index/cache side effects. Invalidate company list/detail/filter/export caches; no permission, people or child-company side effect occurs. Dictionary edits use their existing commands and invalidation. Index records aggregate relationship tokens through the normal query-index contract; do not insert hand-written generated output.

## 📝 Data Models

`CustomerCompanyRelationshipType`, table `customer_company_relationship_types`:

| Field | Type / invariant |
|---|---|
| `id` | UUID primary key. |
| `tenant_id`, `organization_id` | Required UUIDs from trusted company scope. |
| `company_id` | Required UUID referencing `customer_entities.id`; command verifies live `kind='company'` in the same tenant/org. |
| `relationship_type` | Required dictionary value token, trimmed nonempty text, maximum 150 characters. |
| `created_at`, `updated_at`, `deleted_at` | Standard timestamps; nullable soft-delete timestamp. |

Add active unique `(tenant_id, organization_id, company_id, relationship_type) WHERE deleted_at IS NULL` and reverse-lookup `(tenant_id, organization_id, relationship_type, company_id)` indexes. Same-module company relation is permitted. No ORM relation to the dictionaries module is introduced; values follow existing customer dictionary storage conventions. Company aggregate version protects the form; assignment `updated_at` remains present for entity contract completeness.

Seed `customer_account`, `partner`, `reseller`, `supplier`, `competitor`, `investor` through existing idempotent customer setup/upgrade seeding in dictionary kind `relationship-types`. Preserve any existing entries/settings for that custom kind; seed defaults only for a previously absent kind (no entries or kind-setting row), preserving intentionally empty dictionaries; never append, rename or overwrite existing choices. Tenants may add options. Removing an option never deletes assignments; an existing retained token can be round-tripped or explicitly removed. New requested values must exist in the scoped dictionary unless already assigned to that company. Renaming a dictionary label does not rewrite its value; use existing dictionary semantics rather than interpreting labels as identifiers.

These tokens describe a company relationship, with no new free-text personal assessment or contact field. Existing customer names continue through decryption helpers; assignment tokens follow the same plaintext customer dictionary pattern as company lifecycle/source. No secret/PII payload enters logs. Tenant/org scope applies to both assignment and company reads.

## 📝 API Contracts

| Path | Contract |
|---|---|
| `POST /api/customers/companies` | Add optional `relationshipType: string[]`; absent creates no assignments. |
| `PUT /api/customers/companies` | Optional `relationshipType`; set replacement is atomic with other company changes. Uses company optimistic lock. |
| `GET /api/customers/companies` | Add `relationship_type: string[]`; support repeated-query-parameter `relationshipType` filter (at most 32 exact tokens, 150 characters each; commas are literal token content). OR within this category, AND with other filters. |
| `GET /api/customers/companies/[id]` | Add `company.relationshipType: string[]` and retain all existing fields. |
| Existing customer dictionaries routes | Use `/api/customers/dictionaries/relationship-types` and its existing item routes with GET/POST/PATCH/DELETE and settings guards, preserving identity mapping to stored kind `relationship-types`. The SQL assignment column remains `relationship_type`; it does not dictate the dictionary kind token. Never remap existing custom-kind entries into an underscore kind or introduce an invalid underscore route. |

Add `GET /api/customers/companies/relationship-type-options` guarded by `customers.companies.view`, returning `{items:[{value,label,icon?,color?}]}` from the same scoped dictionary helper. The existing generic dictionary GET requires people-view, so company forms must use this narrowly typed options route without widening that existing guard. Test a company-only reader, forbidden cross-scope options, cache invalidation, empty/custom dictionaries and literal-comma filters.

Serialization sorts tokens consistently and returns `[]` for no assignments. Use a scoped `EXISTS` predicate before pagination to prevent duplicated company rows and incorrect counts. List, count and export must share the same filter. New columns are filterable but not a fake alphabetical sort over joined rows. Update `makeCrudRoute` projections/indexing and `openApi` schemas without changing URLs/envelopes or existing ACLs. People/deal write routes explicitly reject `relationshipType`, rather than silently implying they support it.

Writes reuse `customers.companies.manage`, reads use `customers.companies.view`, dictionary edits reuse `customers.settings.manage`. Zod validates bounds and UUIDs before mutation; scope comes from auth. Missing/inaccessible targets are 404, invalid token/value shape is translated 400 field error, and stale edits return standard 409. Do not trust company ID/scope from a child payload. All updates return the normal fresh aggregate `updatedAt` used by inline forms.

## 📝 UI/UX and Frontend Architecture Contract

Add Relationship types to company create/detail forms with a `CrudForm` multi-select. Use an existing form group; preserve group and injection IDs. Selected values show dictionary labels, and a removed option remains visibly retained until cleared. Companies list gains a configurable column and filter, with OR semantics explained. Customer settings gains the dictionary section. No new field appears on people or deals.

Use standard `DataTable`, `Select`/multi-select, `StatusBadge`, empty/loading/error components, `apiCall`, i18n in all five locales and semantic tokens. Edit/delete carry `updatedAt`; non-form writes use guarded mutation/conflict helpers. Dialog keyboard handling and labeled icons follow shared UI conventions.

Existing company create/detail/list and settings client roots remain legacy exceptions; no new top-level `use client` directive or global provider. A small `CompanyRelationshipTypeField` client leaf owns selection state and asynchronous dictionary loading; server API/lib code owns validation. Keep new leaves below 300 LOC, add no heavy dependencies, abort stale option loads after scope changes. Require route hydration tests, client-boundary check, and a production bundle comparison capped at 5 KiB gzip route growth and zero new shared dependency chunks.

## 📝 Migration and Backward Compatibility

Add entity table/indexes and matching migration snapshot, plus dictionary seeds. Existing records retain empty relationship sets; no inference from source, lifecycle, supplier integrations or names. All API additions are optional. Old clients continue unchanged; no prior custom-field definition, column, event, ACL, import or extension spot is removed. Rollback leaves the additive table/data intact. This spec can ship before or after classification consolidation or hierarchy.

## 📝 Edge Cases & Failure Scenarios

Concurrent multi-select edits are rejected by the company lock token rather than merging competing sets silently. A dictionary option removed while a form is open is accepted only if it was already assigned; otherwise submit reports a field error and refreshes options. Assignment uniqueness is database-enforced under retries. Company delete/undo changes assignments in the same transaction; no live orphan remains. A new type never changes tenant access or propagates to linked people.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Join duplicates break counts/export | Medium | Scoped EXISTS and aggregate serialization; pagination/count/export tests. | No new multi-value sort promised. |
| Concurrent replacement loses assignments | High | Parent lock token, atomic replace and snapshot-based undo. | Clients must refresh after 409. |
| Tenant dictionary value leaks across scopes | High | Resolve all options and assignments by tenant/org, no global dictionary cache key. | None intended. |
| Users mistake supplier type for authorization | Medium | Descriptive labels/help; no automatic ACL or workflow effect. | Tenant-defined automations remain explicitly configured elsewhere. |

## 🧪 Integration and Test Coverage

Self-contained tests cover company create/update/list/detail/export and dictionary GET/POST/PATCH/DELETE; empty/omitted/invalid values, max 32, duplicates, custom options, removed-but-retained options, tenant/org guards, 403/404, 409 and undo/redo. Include two matching relationship types on one company to prove no duplicate list row and correct count/export; OR-within/AND-across filter semantics; retries and concurrent edits; company delete/restore; people/deal rejection. Browser tests cover company create/detail, list filter/export and dictionary settings, stale form conflict and keyboard interaction. No seeded/demo data dependency.

## Final Compliance Report — 2026-10-22

Reviewed root/core/customers/shared, UI/backend, events/cache, QA/spec rules and backward compatibility. Independent classification review required this split; this document contains one classification capability. Aggregate commands, scoped junction rows, indexes, optimistic versioning, snapshots, post-commit effects, additive API and standard UI/test requirements are explicit. Data/API/UI naming agrees and no cross-module relation is introduced. Verdict: ready for design review; no implementation has been performed.

Integration regression coverage also includes 101–150-character dictionary tokens, rejection above 150, and preservation of any pre-existing `relationship-types` custom dictionary with identity mapping, preserved options/settings and no data movement.

## Changelog

- 2026-10-22 — Split from classification consolidation after fresh-context scope review.

## 📋 Phasing and Implementation Plan

1. Add assignment entity, unique/reverse indexes, dictionary kind/seeds and migration snapshot; preserve empty behavior for old records.
2. Extend company commands and undo/redo with atomic set replacement and aggregate lock token; verify concurrent/retry behavior.
3. Extend company CRUD/list/detail/export and dictionary OpenAPI, with EXISTS filtering and all scoped API tests.
4. Add forms, list column/filter and settings section with i18n and browser tests; retain extension IDs.
5. Run configured gates with selected runner, client/bundle evidence and focused migration checks. No local migration without explicit authorization.
