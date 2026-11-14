# CRM company enrichment

## 📝 TLDR

Let a company manager fetch provider suggestions for a saved identifier, inspect a field-by-field diff and explicitly apply selected changes. This optional capability of [issue #7700](https://github.com/open-mercato/open-mercato/issues/7700) builds on [company identifiers](2026-10-22-crm-company-identifiers.md), while manual identifiers remain usable without it. Core owns the provider seam and transactional preview/apply flow; provider packages own external services.

## Overview

Status: proposed, design only, 2026-10-22. Baseline: `main` at `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`. Read with the [Phase 1 shared contract](2026-10-22-crm-field-model-phase-1.md). Prerequisite identifier records expose category/type/country/value and versions; the company and `CustomerAddress` remain data owners. No provider implementation is included. Research and product-pattern sources were read on 2026-10-22; source dates, citations and limitations remain in the [research evidence](assets/crm-field-model-phase-1/research.md).

## Resolved assumptions (autonomous defaults)

| Question | Default | Reason |
|---|---|---|
| Is enrichment part of manual identifier delivery? | Separate optional capability after identifier CRUD. | Manual structured identity works without network services. |
| Where do provider rules and credentials live? | Optional packages; no provider installed automatically. | Keep core country-neutral and avoid provider-specific preconfiguration. |
| Does a successful lookup mean legally valid? | Record provider-reported verification and timestamp separately from lookup success. | A found company does not establish current tax validity. |
| Can enrichment overwrite fields? | Only explicit selected changes from a version-bound preview. | Preserve local knowledge and concurrent edits. |

## 📝 Problem Statement

Company lookup reduces entry effort but can replace correct local data if suggestions apply silently. The [Odoo corporate autocomplete pattern and dated HubSpot overwrite report](assets/crm-field-model-phase-1/research.md) motivate a preview that separates found data, identifier verification and accepted writes; the reports do not establish prevalence or provider accuracy.

## 📝 Proposed Solution

For a saved company identifier supported by an enabled provider, Fetch data opens a side-by-side preview. No customer data changes until the user selects paths and confirms Apply. A timeout does not mark an identifier invalid. No polling, enrichment on keystrokes, bulk company enrichment, automatic merge, hierarchy propagation or country-specific package activation is included. The disabled/absent-provider state leaves manual identifiers editable.

## 📝 Architecture

Implementation lives in `packages/core/src/modules/customers/`: `commands/companyEnrichment.ts`, API routes, `lib/companyDataProviders.ts`, DI registration, preview entity/encryption maps and the company-detail client leaf. Proposed public token `customersCompanyDataProviderRegistry` registers provider descriptors through optional packages' own `di.ts`; this is an additive contract, not a new discovery convention. Identifier normalization/type validation stays in the prerequisite's pure descriptor layer.

Provider descriptor contract: `{ id, labelKey, supportedIdentifierTypes, lookup(input, context) }`. Normalization and validation use the independently installed identifier type descriptors; providers do not replace their comparison rules. `input` is `{ category, type, country, value }`; `context` is server-only authenticated tenant/organization/user scope, cancellation signal and integration services. `lookup` returns a schema-validated `{ providerId, fetchedAt, verification: { status: 'verified'|'unverified'|'invalid', verifiedAt?, reference? }, company: { legalName?, displayName?, industry? }, addresses: [...], identifiers: [...] }`. Optional properties are suggestions, never patch instructions or arbitrary field names. Provider IDs/type IDs are bounded namespaced tokens. Returned `country` is ISO alpha-2; registry definitions declare the category and allowed countries. All output strings have length limits and are rendered as text.

The registry is a host extension: customers never imports a provider. A package contributes registrations, credentials UI and its own `integration.ts`/health checks. Resolve optional infrastructure gracefully; no provider produces an empty capability list and a disabled Fetch action. Credentials use the integrations credential service, never provider settings in core or browser payloads. No hard dependency on catalog, sales, auth consent, or external official-module pointers.

## 📝 Data Model

Operational `CustomerCompanyLookupPreview`, table `customer_company_lookup_previews`: UUID `id`, scope, `user_id`, `company_entity_id`, `provider_id`, `created_at`, `expires_at`, nullable `applied_at`, encrypted `suggestions`, encrypted `base_snapshot`, `company_updated_at`, identifier/address version map, and nullable encrypted `applied_result`. It is an expiring server-owned receipt, not ordinary editable CRUD. TTL is ten minutes for unused previews; delete expired raw previews on the existing queue worker path. An applied receipt retains minimal operation ID/result for 24-hour retry recovery, then is purged; durable accepted changes remain in the normal command audit. Never retain full external responses.

The prerequisite identifier row supplies same-scope `company_entity_id`, category/type/country, encrypted normalized/entered value, nullable keyed `v2:` blind digest, normalization version, `updated_at`, and nullable `verified_at`/`verification_source`. Apply may set verification metadata only for an accepted successful verification of that exact normalized identity; invalid/unverified lookup results never fabricate a positive verification timestamp. A user edit invalidates verification through identifier commands. Identifier equality and same-company uniqueness remain owned by identifier CRUD: reuse its parent-locked decrypted comparison when no keyed lookup secret exists, and never persist `hashForLookup`'s unkeyed fallback.

Preview suggestions contain allowlisted company fields, address candidates and identifiers. All free text, snapshots and applied results use framework encryption maps; no full external response or credentials persist. Add the operational table/indexes and existing-tenant encryption-map backfill during implementation. Cleanup uses existing queue infrastructure; it is scoped and cannot delete durable accepted customer records.

## 📝 API Contracts

All routes export `metadata` and `openApi`, validate Zod shapes and use customer commands. Existing company/address/identifier APIs retain their names and envelopes; this capability composes their writes.

| Route | Input / output | Authorization |
|---|---|---|
| `GET /api/customers/company-data-providers?type=...&country=...` | `{items:[{id,labelKey,available,unavailableReason?}]}`; no credentials/network URLs. | Company view. |
| `POST /api/customers/companies/:id/lookup` | `{providerId, identifierId, identifierUpdatedAt}` → `{previewId,expiresAt,companyUpdatedAt,changes:[{path,before,after,source}],verification,warnings}`. | Company manage plus new `customers.companies.enrich`. |
| `POST /api/customers/companies/:id/apply-lookup` | `{previewId,selectedPaths:string[]}` with company-version header → `{ok:true,operationId,updatedAt,identifiersUpdatedAt}`. Values come exclusively from server preview. | Same dual feature; recheck all permissions/scope. |

The new enrich feature is granted deliberately through setup role defaults to admin; employees need an explicit grant. Standard error statuses: 400 invalid/schema/unknown selected path, 401 unauthenticated, 403 insufficient features, 404 inaccessible parent/child, 409 stale parent/child/expired preview or duplicate row, 422 known invalid identifier, 429 rate limited, 503 provider unavailable, 504 timeout. Providers get a ten-second total deadline, bounded 256 KiB decoded response, no automatic retry of user-visible lookup. Only allow configured server-side provider endpoints; reject caller-supplied URLs and redirects outside the provider allowlist, private network destinations and unexpected content types. External identifiers are sent only after the user's Fetch action.

Apply locks preview receipt, company, and affected children in stable order, verifies every stored version, executes the composite customer command transaction, records receipt, then emits post-commit effects. Two applies of the same preview return the recorded outcome; they cannot create duplicate addresses. If network response is lost after commit, the same caller may retry within receipt retention. Stale data preserves the user's selections but requires a fresh preview; never retry writes automatically with a new version. Existing child values not selected remain untouched; addresses use explicit existing-address mapping or create-new selection, not fuzzy replacement. Duplicate identifiers produce a warning before acceptance and are rechecked inside apply.

Every browser write uses mutation guards. Apply uses the company-version header and the receipt's expected child versions; child commands must receive their own versions, never the parent header. Preview creation is server-owned operational state and does not increment a customer entity version.

## 📝 UI/UX

Reuse company detail's identifier section, `SectionHeader`, address controls, `CrudForm` and `DataTable` patterns. `CompanyLookupDialog` owns async preview and selected-path state. Show provider/source/fetched time and badges distinguishing Verified, Unverified, Unavailable and Stale. Diff rows default selected only for empty fields; non-empty replacements require explicit selection and final Apply confirmation. Empty/provider-disabled, loading, no-result, partial-result, rate-limit and error states are distinct. A company list row is not enriched in bulk.

Use `Alert`'s current `status/style/size` API, semantic tokens and localized messages. Keyboard submission/cancel and accessible row controls follow the shared frontend contract. Import client leaves only from company route composition, keep each ≤300 LOC and split preview rendering if needed. No new page-root client directive, provider SDK, global provider or extra list-render calls. Preserve selections after a conflict while requiring a new preview before applying.

## Migration & Backward Compatibility

The preview table, registry contract, enrichment feature and routes are additive. No speculative extraction from existing notes/custom fields, automatic provider activation or existing company edits occur. Identifier validation/normalization remains available without this capability; disabling a provider does not remove identifiers or accepted data. Document contracts in framework docs and `UPGRADE_NOTES.md`; run `yarn generate` for discovered files and never edit generated files manually. Rollback disables lookup UI/routes while preserving accepted customer data; operational receipts can expire under their retention policy.

Undo enrichment restores exactly selected fields and created children under their post-operation versions. Any changed child causes a conflict and no partial rollback. Undo does not undo the external read or pretend to revoke provider verification. Re-index/invalidate company detail/list and identifier caches after execute and undo; duplicate/lookup responses are private, uncached. Cached company documents follow the existing encrypted DI cache policy and tenant/org tags.

## 📝 Risks & Impact Review

| Failure / severity | Mitigation | Residual risk |
|---|---|---|
| Enrichment overwrites curated/concurrent values / high | Explicit preview paths, parent/child versions, atomic apply and guarded undo. | Provider data can be stale; source/time shown. |
| Provider timeout, malformed or malicious output / high | Deadline, size/schema limits, server allowlist and text rendering; no customer writes before Apply. | Provider downtime leaves manual entry usable. |
| Cross-organization lookup/apply / critical | Parent/identifier authorization before outbound request; receipt bound to scope/user; permission recheck. | Authorized users intentionally disclose the chosen identifier to the provider. |
| Retried apply creates duplicate children / high | Lock receipt and stable child order; transaction plus stored outcome. | Recovery ends after receipt retention; do not silently create another operation. |
| Source normalization diverges / high | Reuse versioned identifier descriptors and duplicate checks; no provider-specific comparison on read. | Unknown types still use generic validation. |

## Integration Coverage

`customers/__integration__/TC-CRM-ENRICHMENT-001.spec.ts`: provider listing, lookup and apply with fixtures in two tenants/two organizations; viewer/enricher and wildcard grants, parent/identifier mismatch, absent/unknown provider, malformed payload, unexpected content type, timeout, response bounds, denied endpoint, expired/stale preview, receipt replay and concurrent apply. Use a deterministic fake provider registered only in the test environment; no live registry or secrets. Assert no customer write during preview, selected-path validation, unchecked-field preservation, duplicate recheck, address mapping/create behavior, child-conflict rollback, verification assignment/invalidation and remove-provider degradation. Verify accepted changes/undo invalidate warm caches/indexes and later edits prevent partial undo. UI: company detail, Fetch selection/cancel/Apply at desktop/mobile with keyboard and hydration checks. Clean fixtures/receipts in finally; test cleanup retention without removing durable changes.

## Final Compliance Report — 2026-10-22

Design review specifies optional provider-owned glue, bounded external reads, encrypted expiring receipts, tenant/org and actor isolation, composite command/undo, optimistic versions, mutation guards, ACL/OpenAPI and DS components. No provider dependency or migration is applied in this PR. No executed runtime tests are claimed; implementation must satisfy the integration matrix and shared validation gate.

## Changelog

- 2026-10-22: Extracted researched provider registry, preview/apply receipt, security, UI and tests from the combined identifier design after scope review; retained all enrichment behavior and made identifier CRUD the explicit prerequisite.

## 📋 Implementation Plan

### Phase 1 — Optional lookup and preview

1. Add provider host contract/DI registration, bounded lookup, expiring encrypted receipt, ACL/OpenAPI and fake-provider/security tests. Keep Fetch disabled when no provider exists; manual identifiers remain fully usable.
2. Add read-only diff dialog and cleanup/replay retention tests without changing customer data during preview.

### Phase 2 — Atomic application and undo

1. Add selected-path composite apply/undo with parent/child versions, duplicate/address checks and outcome receipt; verify stale/replay/concurrent/failure paths before enabling Apply.
2. Complete UI states/accessibility, cache/index effects and extension documentation without bundling a real provider. Ship API and UI integration coverage in the same implementation change.
