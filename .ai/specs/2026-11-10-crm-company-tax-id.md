# CRM company VAT / tax ID

## TLDR

Give the company profile a single optional `taxId` (NIP / VAT ID) column, exposed on the create and edit forms, the companies list and the companies API, encrypted like the rest of the profile. It is an interim, additive contract: the country-qualified identifier model in [CRM company identifiers](2026-10-22-crm-company-identifiers.md) stays the target, and this spec fixes how `tax_id` is bridged into it so nothing shipped here has to be removed.

**Key points:**
- Companies had no place for their tax ID; the only `taxId` lived on addresses, so tenants used a custom field.
- The field is optional everywhere: API, company create page, Sales quick-create and the edit form. A company MAY have no tax ID (not VAT-registered, foreign, early-stage lead), which matches the module constraint in `customers/AGENTS.md` ("MUST have name; tax ID optional"). A host can opt into a required field through `requireTaxId`; no tenant setting exists yet.
- Additive schema and API contracts only; nothing published is renamed or removed.

## Overview

Status: implemented on branch `fix/company-tax-id` (PR open-mercato/open-mercato#8538), 2026-11-10. Read with the [Phase 1 decision record](2026-10-22-crm-field-model-phase-1.md) and the [company identifiers](2026-10-22-crm-company-identifiers.md) spec, which remains proposed and design-only. Address-level tax identifiers (`AddressValue.taxId`) are a separate concern covered by [address contact details and tax identifiers](2026-08-10-address-contact-and-tax-fields.md) and are not changed.

## Problem Statement

A B2B company record needs its tax identifier for invoices, lookups and deduplication. `CustomerCompanyProfile` had `legalName`, `brandName`, `domain`, `websiteUrl`, `industry`, `sizeBucket` and `annualRevenue` but no tax ID. The identifiers spec answers this fully (multiple country-qualified identifiers with normalization and duplicate warnings) but is not implemented, so every tenant keeps working around the gap with a custom field that no list column, API consumer or search index knows about.

## Proposed Solution

Add `customer_companies.tax_id text null`, map it to `CustomerCompanyProfile.taxId`, and carry it through the validator, the create/update/delete commands and their undo snapshots, the list (`tax_id`) and detail (`profile.taxId`) responses, the OpenAPI schemas and the company forms. Encrypt it through the existing company profile encryption map, with a backfill for tenants that already exist.

### Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Single column now vs. identifiers model first | Ship the single column as an interim, bridged contract | The identifiers model is design-only and much larger; tenants need the field now. The bridge below keeps the column meaningful after the model lands, so no deprecation of a shipped surface is required. |
| Required by default | No | `customers/AGENTS.md` keeps the tax ID optional; the API, inline person-form company create and edit form already allowed its absence, so a required UI default would have blocked legitimate companies without guaranteeing the value. |
| Per-tenant requirement setting | Out of scope | A requirement must be enforced identically on every create path (API, create page, Sales quick-create, person-form inline create). Until that exists, hosts opt in per form with `requireTaxId`. |
| Encryption | Encrypted, no hash field | A sole trader's tax ID is personal data. Exact-match search already hashes `tax_id` in `customers/search.ts`; no equality lookup on the column exists, so no `hashField` sibling is declared. |

## Data Model

`CustomerCompanyProfile` (table `customer_companies`), additive column:

| Field | Contract |
|---|---|
| `tax_id` / `taxId` | `text null`; trimmed on write; `null` clears it. Not unique: branches may share a legal identity, and no duplicate detection exists before the identifiers model. |

Migration `Migration20261030195138_customers`: `alter table "customer_companies" add "tax_id" text null` plus `buildEncryptionMapBackfillSql({ entityId: 'customers:customer_company_profile', fields: [{ field: 'tax_id' }] })`. `down()` drops the column only; the encryption rule is forward-only (see `migration-backfill.ts`), because deleting by entity id would also remove rules seeded at tenant creation or edited by admins.

## API Contracts

Additive fields on existing routes; no route, method, status or existing field changes.

| Route | Change |
|---|---|
| `POST /api/customers/companies` | Body accepts optional `taxId` (top-level or nested `profile.taxId`). |
| `PUT /api/customers/companies` | Body accepts optional `taxId`; `null` clears the value. |
| `GET /api/customers/companies` | Each list item carries `tax_id: string \| null`, declared in `companyListItemSchema`. |
| `GET /api/customers/companies/{id}` | `profile.taxId: string \| null`. |

Undo of `customers.company.update` and `customers.company.delete` restores `taxId` from the `before.profile` snapshot (regression: `commands/__tests__/companyTaxId.undo.test.ts`).

## UI/UX

- Company create page and the Sales document quick-create dialog render "VAT ID" as an optional text field next to "Legal name", with the placeholder `e.g. PL1234567890` and no helper copy.
- The edit form prefills the stored value and transmits an explicit clear when the field is blanked.
- The companies list shows a "VAT ID" column.
- All labels come from `customers.companies.detail.fields.taxId*` locale keys (en/pl/de/es/ko).

## Migration & Backward Compatibility

Contract surfaces touched (per `BACKWARD_COMPATIBILITY.md`): database schema (additive nullable column), API responses (additive fields), encryption map (additive rule), form field options (`CustomerFormFieldOptions.requireTaxId`, additive, default `false`). Nothing is removed or renamed; no deprecation protocol applies. Existing clients that ignore unknown fields are unaffected; clients that already sent `taxId` as a custom field keep working.

Existing data: the migration adds the column as `null` for every row and appends the encryption rule to every pre-existing company profile map exactly once, seeds the map for scopes that encrypt other entities but had no company profile map, and skips scopes with encryption disabled, soft-deleted maps and maps that already carry the rule. Values written after the upgrade are encrypted; rows never get a plaintext `tax_id`. Rollback drops the column (values written in between are lost, as with any dropped column) and keeps company rows and maps intact. Evidence: `migrations/__tests__/Migration20261030195138_customers.integration.test.ts` runs the real `up`/`down` against a disposable PostgreSQL (`yarn workspace @open-mercato/core test:pg-integration`, wired into the CI pg-integration step).

Bridge to the identifiers model: when [company identifiers](2026-10-22-crm-company-identifiers.md) ships, `customer_companies.tax_id` becomes the read-mirror of the company's primary `tax`-category identifier, the same way the Phase 1 contact-points design keeps legacy primary email/phone mirrors. Its backfill creates one `customer_company_identifiers` row per non-null `tax_id` with `type = 'generic_tax'` (or the descriptor the tenant chooses in a previewed import), `country` null and `raw_value = value = tax_id`; writes to `taxId` through the companies API then create or update that primary identifier and the column keeps the normalized value. The column, `taxId` on the detail response and `tax_id` on the list stay readable for at least one minor release after the identifiers UI replaces the single field, then follow the deprecation protocol (JSDoc `@deprecated`, `UPGRADE_NOTES.md`, migration note in the identifiers spec). That spec's "no second VAT column" rule therefore holds for new work: the lead-funnel duplicate detection it names must read identifiers, not this column.

## Integration Coverage

| Scenario | Spec |
|---|---|
| Company create page saves a company without a VAT ID | `TC-CRM-company-tax-id` (1), `TC-CRM-001`, `TC-CRM-CRUDFORM-HOST-001` |
| Sales document quick-create saves a company without a VAT ID | `TC-CRM-company-tax-id` (2) |
| Detail edit form prefills a stored VAT ID; list column shows it | `TC-CRM-company-tax-id` (3) |
| API accepts, returns and updates `taxId` | `TC-CRM-company-tax-id` (4) |
| Update and delete undo restore `taxId` | `commands/__tests__/companyTaxId.undo.test.ts` |
| List OpenAPI item schema declares `tax_id` | `api/__tests__/companies-list-openapi.test.ts` |
| Form payload, prefill, clear, optional/required flag | `components/__tests__/formConfig.test.ts` |
| Migration up/down against pre-existing data and maps | `migrations/__tests__/Migration20261030195138_customers.integration.test.ts` |

## Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---|---|
| Existing tenants write `tax_id` in plaintext because their encryption map predates the rule | High | Idempotent map backfill in the same migration; verified against a real database. |
| Undo of an edit or delete drops the VAT ID | Medium | `before.profile.taxId` restored on both undo branches; unit regression. |
| Identifiers model later has to deprecate the column | Medium | Bridge above makes the column a mirror of the primary tax identifier instead of a parallel source of truth. |
| A required default blocks legitimate companies on two UI paths while the API stays optional | Medium | Optional everywhere by default; `requireTaxId` is an explicit per-form opt-in. |
| List consumers cannot discover `tax_id` | Low | Declared in `companyListItemSchema`; schema regression test. |

## Final Compliance Report — 2026-11-10

AGENTS.md reviewed: root, `packages/core`, `packages/core/src/modules/customers`, `packages/ui`, `.ai/specs`.

| Rule | Status |
|---|---|
| Tenant/organization scoping on every read and write | Compliant (profile reads go through the scoped company commands and `findWithDecryption`). |
| Encryption map for PII column, reads via `findWithDecryption` | Compliant (`customers/encryption.ts`, backfill migration). |
| Zod validation, types from `z.infer` | Compliant (`data/validators.ts`, form schemas). |
| Undoable commands | Compliant (update/delete undo restore `taxId`). |
| Additive API contract, OpenAPI declared | Compliant (`companyListItemSchema`, detail/request schemas). |
| i18n, no hardcoded strings, no helper copy under fields | Compliant. |
| Module constraint "tax ID optional" | Compliant (default `requireTaxId = false`). |
| Spec with Migration & Backward Compatibility section referenced from the PR | Compliant (this document). |

Verdict: compliant.

## Changelog

- 2026-11-10: Spec written after review of PR #8538. VAT ID made optional by default on every create path; list OpenAPI schema declares `tax_id`; migration up/down covered against a disposable PostgreSQL; bridge to the company identifiers model defined.
