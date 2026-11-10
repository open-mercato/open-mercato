# CRM company identifiers

## 📝 TLDR

Give a company multiple country-qualified tax and registration identifiers, with deterministic normalization and scoped duplicate warnings. This implements the identifier-record capability of [issue #7700](https://github.com/open-mercato/open-mercato/issues/7700) independently of enrichment, contact, consent and deal changes. Optional [company enrichment](2026-10-22-crm-company-enrichment.md) consumes this model without being required for manual entry.

## Overview

Status: proposed, design only, 2026-10-22. Read with the [Phase 1 decision record](2026-10-22-crm-field-model-phase-1.md), which defines shared architecture, frontend, validation and compatibility requirements. Baseline: `main` at `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`. Existing company profiles and `CustomerAddress` remain the owners of company and address data. Neither provider lookup nor external network calls are included. Research and product-pattern sources were read on 2026-10-22; source dates, citations and limitations remain in the [research evidence](assets/crm-field-model-phase-1/research.md).

## Resolved assumptions (autonomous defaults)

| Question | Default | Reason |
|---|---|---|
| Where do international rules live? | Core identifier type descriptors plus optional packages; no lookup provider required or installed automatically. | Keep manual identifiers country-neutral and independently deployable. |
| Can duplicates be legitimate? | Warn across accessible companies; block duplicate identifier rows only within the same company. | Branches may share a legal identity; no automatic merge. |
| Can manual entry claim verification? | Never; verification fields remain null unless the separate enrichment capability accepts a successful verification for the exact normalized value. | Manual identifiers remain useful without asserting legal validity. |
| Can optional behavior block entry? | No; unknown/removed type descriptors fall back to generic validation and retain saved data. | Package removal must not make existing identifiers unusable. |

## 📝 Problem Statement

The company profile has name/domain/industry and addresses but no normalized multi-identifier model. Domain/name matching alone cannot reliably distinguish branches, similarly named companies, or businesses without websites. The [research evidence](assets/crm-field-model-phase-1/research.md), including Odoo's corporate Tax ID pattern, motivates structured identity; it does not prescribe national validation or automatic enrichment.

## 📝 Proposed Solution

Add an Identifiers section to company detail/create flows. A user chooses category, type, country and value, sees validation/duplicate results, and saves. No automatic company merge, hierarchy propagation, external lookup or country-specific package activation is included. The separate enrichment spec adds Fetch data later without changing manual CRUD.

Manual edits to category, type, country or value clear verification metadata. A type descriptor or provider disappearing leaves stored identifiers readable and editable with generic validation. The model retains nullable verification fields as an additive integration seam; lookup success, provider-verifiable status and acceptance are defined by the separate enrichment capability.

## 📝 Architecture

Implementation lives in `packages/core/src/modules/customers/`: entities/validators, `commands/companyIdentifiers.ts`, API routes, identifier type descriptors, encryption maps and company-detail client leaves. Identifier type descriptors supply bounded namespaced type IDs, category, allowed ISO alpha-2 countries, `normalize(input)` and `validate(input)` for `{category,type,country,value}`. They are pure deterministic rules usable without a provider registry, credentials or network access. Optional packages may contribute descriptors; this does not introduce another auto-discovery convention.

Type descriptor labels use translation keys; entered/output strings have length limits and render as text. Core generic validation accepts bounded unknown type tokens so stored data survives an optional package being disabled. Known descriptors validate category/country compatibility. External lookup interface and provider DI token are owned solely by the enrichment spec.

Initial generic type descriptors can name `eu_vat`, `us_ein`, `gb_vat`, `gb_crn`, `de_hrb`; they assert neither legal verification nor provider availability. Optional identifier packages can add `pl_nip`, `pl_regon`, `pl_krs`. Generic normalization removes surrounding/internal whitespace; country/type descriptors may remove known formatting punctuation and normalize case. Never universally strip non-digits or leading zeros. Keep the raw entered form for display/audit and the normalized value for comparison. Type-specific normalization must be deterministic and versioned; normalization updates require previewed backfills, not changed duplicate semantics on read.

Identifier entry has no hard dependency on integrations, catalog, sales, auth consent or external official-module pointers. Core customers never imports an optional package. Provider-specific settings and network behavior belong to the separately deployable enrichment capability and its provider packages.

## 📝 Data Model

`CustomerCompanyIdentifier`, table `customer_company_identifiers`:

| Field | Contract |
|---|---|
| `id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at` | Standard UUID/scope/version/soft-delete columns; scope copied from company after authorization. |
| `company_entity_id` | UUID of same-scope live `CustomerEntity(kind=company)`; same-module FK. |
| `category` | `tax` or `registration`. |
| `type`, `country` | Registry token ≤64 chars, ISO alpha-2 country; type-country compatibility validated when known. |
| `value`, `raw_value` | Normalized and entered text, 1–128 chars; encrypted. |
| `value_hash`, `normalization_version` | Nullable keyed framework `v2:` blind equality digest of normalized value, plus descriptor version; never persist an unkeyed fallback hash or plaintext search token. |
| `verified_at`, `verification_source` | Nullable timestamp and provider ID, set only from an accepted successful verification of this exact normalized value. |

When a keyed lookup secret is available, equality lookup includes `(tenant_id, organization_id, category, type, country, value_hash)`; the partial active-row unique constraint adds `company_entity_id` and applies only where `value_hash IS NOT NULL`. Company listing index `(tenant_id, organization_id, company_entity_id, deleted_at, id)`. Normalize and encrypt through framework services; declare `value` and `raw_value` as encrypted fields in `customers/encryption.ts` **without an automatic `hashField` mapping**. The command computes the separate nullable `value_hash` using the canonical helper and accepts only its keyed `v2:` result. The current encryption service overwrites a configured hash field unconditionally, so configuring that automatic sibling mapping would reintroduce the unkeyed fallback; no shared crypto-service change is required. The current `hashForLookup` can return an unkeyed fallback when no secret exists: persist only a keyed `v2:` digest, otherwise store null. Do not implement custom crypto or persist that fallback.

Always serialize create/update/restore on the authorized parent company before checking active same-company identifiers. With no keyed secret, compare normalized values after framework decryption within that locked parent to preserve deduplication despite nullable hashes; the same guard covers null-digest legacy rows when a key later becomes available. For cross-company warnings, scope and authorize candidate companies first, then compare decrypted values using bounded paged scans with early termination at the 20-match limit. Never issue an unscoped fallback scan or infer hidden matches. Include a truncated flag when the authorized scan bound is reached rather than claiming exhaustive absence. Key availability changes require an explicit digest backfill; do not change normalization or comparison semantics on read. Duplicate results never expose another organization or a hidden-match count. Do not make identifiers vector-searchable by default.


## 📝 API Contracts

All routes export `metadata` and `openApi`; CRUD uses `makeCrudRoute` plus indexer, commands, custom-field handling where relevant and parent-scope validation. Listed routes are proposed additive contracts; existing companies/address routes are not renamed.

| Route | Input / output | Authorization |
|---|---|---|
| `GET /api/customers/company-identifiers?companyEntityId=UUID` | Existing paged envelope, `items` contain camelCase fields plus `updatedAt`, max pageSize 100. `id` query returns one identifier. | `customers.companies.view`; parent accessible. |
| `POST /api/customers/company-identifiers` | `{companyEntityId, category, type, country, value}` → existing create envelope with ID. | `customers.companies.manage`. |
| `PUT /api/customers/company-identifiers` | `{id, category?, type?, country?, value?}`; standard child-version header → current success envelope. | Same manage feature. |
| `DELETE /api/customers/company-identifiers?id=UUID` | Standard child-version header; soft delete. | Same manage feature. |
| `POST /api/customers/company-identifiers/duplicates` | `{companyEntityId, category, type, country, value}` → `{matches:[{companyEntityId,displayName}],truncated}`; cap 20 accessible matches. | Company view + manage; no write despite POST body avoiding URL PII. |

Standard error statuses: 400 invalid/schema/unknown type shape, 401 unauthenticated, 403 insufficient features, 404 inaccessible parent/child, 409 stale child or duplicate row, and 422 a known descriptor rejects the identifier. Unknown descriptor tokens use generic validation, not fabricated verification. Duplicate checks use POST bodies to avoid identifiers in URLs and are private/uncached.


## 📝 UI/UX

Reuse company detail's `SectionHeader`, `DataTable`, `CrudForm` and existing company create/detail composition. Identifier rows show type, country, entered value and nullable verification source/time; do not show a Fetch action until the enrichment capability is enabled. Use `Alert`'s current `status/style/size` API, semantic tokens and localized messages. Empty, loading, validation, duplicate-warning, read-only, save-failure and conflict states are distinct. Keyboard submission/cancel and accessible row controls follow the shared frontend contract.

New client leaf `CompanyIdentifiersSection` owns row actions/versioned forms and is imported only by company route composition. No new page-root client directive, provider SDK, global provider or extra network calls on list render. Each leaf stays ≤300 LOC. All writes retain guard context and use each identifier's own `updatedAt`; never forward the company version as a child version.

## Migration & Backward Compatibility

Add the identifier table/indexes and encryption maps with the existing-tenant `buildEncryptionMapBackfillSql` migration. No speculative extraction from notes/custom fields, no inferred country, no existing company edits. Existing VAT-like custom fields stay unchanged until a separate explicit import mapping selects them. Future lead-funnel duplicate detection can call the same scoped identifier lookup instead of inventing another VAT column; its proposed lead entity is not implemented by this spec. Identifier type interfaces and routes are additive public surfaces; document them in framework docs and `UPGRADE_NOTES.md` when implemented. Never edit generated registries by hand; run `yarn generate` after discovery changes. Disabling a type package or future provider does not remove identifiers. Rollback disables identifier UI/routes and retains data; no destructive down migration after writes.

Undo identifier create/update/delete restores value and prior verification snapshot under current optimistic concurrency. Re-index/invalidate company detail, company list and identifier caches after execute and undo; duplicate responses are private, uncached. Any cached company document follows existing encrypted DI cache policy with tenant/org tags. Composite enrichment undo belongs to the separate enrichment spec. Existing company delete and undo of company creation physically remove the company/profile. Extend those commands to acquire the same parent lock as identifier writes, snapshot all active/deleted identifiers with original IDs/verification and encrypted values, then remove children before parent in the same transaction. Restore parent before children under current scope/uniqueness checks. Do not cascade away rows outside the undo snapshot. A concurrent child write serializes or conflicts; it cannot be silently omitted from deletion evidence. Enrichment receipts, when installed, follow that capability's compatible cleanup/restore contract.

## 📝 Risks & Impact Review

| Failure / severity | Mitigation | Residual risk |
|---|---|---|
| Cross-organization identifier oracle / critical | Authorize company first; exact scope on hash query and filtered result; no hidden count. | Privileged same-org users can detect shared IDs by design. |
| Concurrent duplicate creation / medium | Parent lock plus decrypted same-company comparison, backed by scoped partial uniqueness when keyed digests exist; translate violation into field error. | Cross-company duplicates intentionally allowed with warning. |
| Unkeyed identifier digest leaks enumerable values / high | Persist only keyed `v2:` digest or null; scoped authorized decryption fallback and no custom crypto. | No-secret cross-company checks cost more and can return truncated results. |
| Normalization change merges unlike IDs / high | Versioned descriptor, no digit-only global normalization, reviewed backfill report. | Unknown types receive generic validation only. |

## Integration Coverage

`customers/__integration__/TC-CRM-IDENTIFIERS-001.spec.ts`: exercise every identifier verb and duplicate endpoint with fixtures in two tenants and two organizations; check child-parent mismatch, view/manage and wildcard grants, encrypted reads/hash dedupe, stale update/delete, unknown/removed type descriptors, verification invalidation, normalization versions and concurrent duplicate creation. Run with keyed secret, without pepper/lookup secret, with encryption enabled/disabled and across null-digest backfill; assert persisted hashes are keyed `v2:` or null, same-company racing writes still dedupe, and authorized cross-company fallback never exposes hidden records or counts. Verify bounded fallback/truncated results and no network/provider requirement. UI: company create/detail, identifier edit/delete and duplicate warning at desktop/mobile with keyboard and hydration checks. Verify execute/undo cache and index invalidation, plus undo after concurrent edit. Include company physical delete/create-undo with active/deleted identifiers, full delete-undo restoration and racing identifier creation, plus an encryption-service integration test proving persisted no-secret hashes stay null after encrypt/flush. Clean fixtures in finally. Provider listing, lookup, apply and receipt tests ship with the separate enrichment capability.

## Final Compliance Report — 2026-10-22

Design review: additive identifier contracts, customers ownership, pure optional type descriptors, scoped encrypted lookup, commands/undo, child versions, mutation guards, OpenAPI and DS components specified. No runtime/provider dependency or local migration is introduced by this PR. Implementation remains gated on the integration matrix and shared validation sequence; no executed runtime tests are claimed.

## Changelog

- 2026-10-22: Initial researched identifier model; retained normalization, deduplication, verification seam and conservative migration. Split optional enrichment into its own capability spec after scope review.

## 📋 Implementation Plan

### Phase 1 — Identifier storage and validation

1. Add entity, deterministic type descriptors, validators, maps/migration and same-company uniqueness; fixture migration, normalization and encrypted equality tests pass with existing company flows unchanged and no provider installed.

### Phase 2 — Identifier CRUD and user flow

1. Add commands/CRUD/OpenAPI and company section with update/delete conflicts; all identifier/duplicate API and UI integration tests ship together.
2. Verify removed/unknown descriptor behavior, execute/undo invalidation and compatibility documentation. The resulting manual identifier capability is independently usable; enrichment is a separate follow-on spec.
