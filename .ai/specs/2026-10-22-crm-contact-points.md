# CRM contact points

## 📝 TLDR

Add multiple email addresses and phone numbers to CRM people and companies while preserving `primary_email` and `primary_phone` for existing consumers. A scoped child entity owns each value, its classification, delivery health and version; one transaction maintains primary selection and the legacy projection. This independently deployable capability supports [issue #7700](https://github.com/open-mercato/open-mercato/issues/7700) and the [Phase 1 umbrella](2026-10-22-crm-field-model-phase-1.md).

## Resolved assumptions (autonomous defaults)

| Question | Default | Rationale |
|---|---|---|
| Q1. One specification for all CRM field changes? | Separate contact points from permissions, identifiers and deal changes. | Multiple addresses are useful without a consent engine. |
| Q2. What happens to existing primary fields? | Keep reads and writes for at least one minor version; adapt writes through the child command. | Existing integrations and filters remain compatible. |
| Q3. Infer a country for malformed or local legacy phone numbers? | Preserve the original as `legacy_unparsed`; require an explicit international replacement to normalize. | No guessed country, discarded values or invented routing destination. |
| Q4. Clear or delete a primary? | Leave that kind without a primary; never silently promote another value. | Prevents messages going to an unintended address. |
| Q5. Is person-level bounce status authoritative? | The companion permission spec exposes the primary email's bounce state as a compatibility projection. | Changing primary cannot transfer an old address's delivery failure. |

## 📝 Overview

This is a design-only proposal against the repository baseline recorded in the umbrella. Existing `customers/data/entities.ts` stores one primary email and phone on `CustomerEntity`; `encryption.ts` protects both. Existing people/company commands, `api/people/route.ts`, `api/companies/route.ts`, `api/people/check-phone/route.ts`, `lib/findPeopleByAddresses.ts`, CRM email linking, search and CSV consumers must be examined as explicit bridge call sites. Existing email privacy and conversation-sharing permissions remain intact.

Non-goals are address verification, number ownership verification, automated merging, phone-number geolocation, external enrichment and removal of any existing column. Postal addresses retain their existing entity.

## 📝 Problem Statement

Overwriting a personal email with a work email loses useful identity history; making a new CRM person creates duplicate relationship histories. Multiple values also need clear primary and delivery semantics. [HubSpot documents](https://knowledge.hubspot.com/records/add-multiple-email-addresses-to-a-contact) multiple emails with primary-only behavior in several tools and per-address bounce/unsubscribe state; [EspoCRM](https://docs.espocrm.com/administration/fields/) separates primary, invalid and opted-out flags. Those are useful patterns, not grounds to copy their implementation.

Two dated user reports describe [fragmented history while managing multiple addresses](https://community.hubspot.com/t/managing-one-contact-with-multiple-email-addresses/135691) and [automation selecting the wrong primary address](https://community.hubspot.com/t/email-automation-sending-to-the-wrong-email/135493). They are qualitative evidence from individual users. The resulting design requirement is explicit destination selection with stable contact-point identity; it is not a claim about how common those failures are.

## 📝 Proposed Solution

Represent email and phone values in `customer_contact_points`. Keep contact information in a compact section on existing person/company detail pages. A row can be added, edited, made primary or archived; each action reports which primary projection changes. New creation does not implicitly choose a primary unless `isPrimary: true` was submitted. Initial person/company forms may explicitly submit their first value as primary.

A duplicate within one record is rejected; a value shared by separate records produces a scoped warning rather than a global uniqueness rule. Shared switchboards and role inboxes are legitimate. Classification uses custom kinds `person-contact-types` and `company-contact-types` with identity route/storage mapping; preserve existing entries/settings and seed only absent kinds. Never remap another slug or overwrite an intentionally empty dictionary. The person defaults are `work`, `mobile`, `private` and company defaults `general`, `billing`, `switchboard`; type changes cannot change kind.

## 📝 Architecture

All domain code remains in `packages/core/src/modules/customers/`: entities/validators, `commands/contact-points.ts`, CRUD `api/contact-points/route.ts`, dictionary definitions, encryption maps and `components/detail/ContactPointsSection.tsx`. Reuse the customers reference patterns, `makeCrudRoute` with `indexer: { entityType: 'customers:customer_contact_point' }`, custom-field normalization/snapshots and OpenAPI exports. Commands are `customers.contact_points.create|update|delete`; primary transitions are part of the same commands, not a second best-effort request.

Each mutation locks the scoped parent, checks its expected version and every affected existing child's version, then writes children and the parent projection atomically with `withAtomicFlush(..., { transaction: true })` or a fitting `runCrudCommandWrite` composition. Query before mutating; do not interleave pending scalar updates and ORM reads. A partial unique index enforces at most one live primary per `(tenant_id, organization_id, entity_id, kind)`. Demote and flush the old primary inside the transaction before promoting the new one. Parent and changed children receive fresh `updated_at` values. Constraint races return conflict, never silent retry using a newer version.

After commit, emit typed `customers.contact_point.created|updated|deleted` events with IDs/scope/version only; update parent and child indexes and invalidate their scoped cache tags, including undo. Permission observers may react to changed identity but cannot rewrite contact values. Core contact points do not depend on the permission service.

## 📝 Data Model

`CustomerContactPoint` uses UUID IDs, scoped foreign-key IDs and standard MikroORM decorators. All timestamps are UTC.

| Column | Type / constraint |
|---|---|
| `id`, `tenant_id`, `organization_id`, `entity_id` | UUID; required; parent must exist in the same tenant and organization and be person/company |
| `kind` | `email` or `phone`; immutable after create |
| `type` | Nullable dictionary value, maximum 150 characters; validated for parent kind |
| `value` | Required encrypted text, maximum 320 characters; original display spelling for email or legacy phone, canonical E.164 for new/normalized phone |
| `normalized_value` | Encrypted text, nullable only for legacy unparsed rows |
| `value_hash` | Nullable keyed lookup digest; absent for unparsed legacy values; never returned by APIs |
| `normalization_state` | `valid` or `legacy_unparsed`; client cannot manufacture the legacy state |
| `is_primary` | Boolean, default false |
| `delivery_status` | `unknown`, `deliverable`, `bounced`, `invalid`; default unknown; phone cannot be bounced |
| `delivery_status_at`, `delivery_source` | Nullable timestamp and encrypted bounded provenance text |
| `created_at`, `updated_at`, `deleted_at` | Required create/version times; nullable soft-delete time |

Besides the primary index, index scope/parent/kind/deleted state. A scoped live unique key on `(tenant_id, organization_id, entity_id, kind, value_hash)` prevents same-record canonical duplicates; hash-null legacy rows remain distinguishable. No cross-record or cross-organization uniqueness constraint exists.

Email canonicalization trims surrounding whitespace and folds case for matching while preserving display spelling; it never removes plus tags or provider-specific dots. A new phone must match `+` followed by 2–15 digits with a nonzero first digit; this validates E.164 storage shape, not allocation or ownership. Separate extensions and national-number inference are deferred. Archived dictionary values remain readable, but new assignments require active values.

Add `value`, `normalized_value` and delivery provenance to `defaultEncryptionMaps`, with the corresponding encryption-map backfill migration for deployed tenants. Reuse the framework's `hashForLookup`/`lookupHashCandidates` convention and configured lookup pepper; scope every lookup by tenant, organization and kind. Never introduce a new key or crypto scheme. Because the helper currently permits an unkeyed fallback, persist only keyed `v2:` output in this new PII index. Without a configured pepper, keep `value_hash` null and compare decrypted same-parent values under the parent lock; this preserves existing primary writes without creating low-entropy unkeyed hashes. Preflight reports the absent index optimization; enabling it later uses an idempotent backfill. Cross-record matching reuses the existing bounded decryption/search-token path and reports incomplete duplicate warnings explicitly. Reads use `findWithDecryption`/`findOneWithDecryption`, never plaintext SQL against ciphertext. Do not create raw-value audit logs, unencrypted caches or vector embeddings for contact points.


For these new keyed-only lookup columns, leave `hashField` unset on the encrypted-field map. The command calls the canonical hash helper and stores only keyed `v2:` output or null in the separate digest column. The existing encryption service would otherwise overwrite a null digest with its unkeyed fallback during encryption. Verify the persisted result after actual encrypt/flush with and without a lookup secret, not only the pre-persistence command object.
## 📝 API Contracts

Add `GET /api/customers/contact-points/type-options?entityId=UUID`, returning `{items:[{value,label,icon?,color?}]}` after authorizing the parent and choosing its corresponding dictionary kind server-side. This avoids the generic dictionary GET requirement for people-view on company-only readers. Settings retain existing dictionary management routes/guards. Test each parent kind, tenant isolation, empty/custom dictionaries, removed retained values and 150-character boundary tokens. All new routes require authentication, one resolved organization and strict Zod schemas. Read ACL is `customers.people.view` for a person or `customers.companies.view` for a company; mutations require the corresponding `.manage`. Resolve the scoped parent before deciding the feature, including child-ID calls. Cross-scope/missing/deleted parents return indistinguishable 404. No new broad permission bypasses parent ACLs.

| Route | Input | Success |
|---|---|---|
| `GET /api/customers/contact-points` | `entityId` required; optional `id`, `kind`; `page=1`, `pageSize=20` up to 100 | `{ items, total, page, pageSize, totalPages, entityUpdatedAt }`; `id` narrows to the requested scoped child |
| `POST /api/customers/contact-points` | `{ entityId, kind, type?, value, isPrimary?, entityUpdatedAt, previousPrimary? }` | 201 `{ item, entityUpdatedAt, changedPoints }` |
| `PUT /api/customers/contact-points` | `{ id, type?, value?, isPrimary?, entityUpdatedAt, previousPrimary? }` | 200 same mutation envelope |
| `DELETE /api/customers/contact-points` | `{ id, entityUpdatedAt }` | 200 `{ id, deletedAt, updatedAt, entityUpdatedAt }` |

`item` and each `changedPoints` element are `{ id, entityId, kind, type, value, normalizedValue, normalizationState, isPrimary, deliveryStatus, deliveryStatusAt, createdAt, updatedAt }`; nullable fields are explicit null. `changedPoints` includes a demoted former primary, never unrelated children. `previousPrimary` is `{ id, updatedAt }` or explicit null; it is mandatory when promoting a row. The server verifies it against the actual primary under the parent lock. No `organizationId` or `tenantId` body field is accepted.

`PUT` and `DELETE` require the child's `updatedAt` via `x-om-ext-optimistic-lock-expected-updated-at`, using the shared helpers and command guard. Missing required version returns 428; mismatch returns the existing 409 conflict shape. Parent and previous-primary mismatches use the same conflict mechanism with the affected resource identified. Invalid value/dictionary yields 422; same-record duplicate yields 409 with code `CONTACT_POINT_DUPLICATE`. GET responses include versions for edit and delete. Custom routes retain the mutation registry, modified-payload validation and after-success callbacks.

Editing a value compares the old and new decrypted canonical identities under the same parent/child locks. If canonical identity is unchanged, preserve `delivery_status`, `delivery_status_at` and `delivery_source` exactly; email case or surrounding-whitespace edits change display spelling, not destination health or address-bound permission. Still record the display edit in encrypted undo/audit evidence and advance affected versions. Only a genuinely different destination resets delivery status to `unknown` and clears its delivery timestamp/provenance; its permission is unknown rather than transferred from the old destination. An unchanged unparsed legacy value preserves its state; repairing it into a new valid canonical destination follows the new-destination rule. Deliberately changing health for the same destination requires the guarded, audited delivery-status action defined by the permission capability; ordinary value edits cannot substitute for it.

Setting `isPrimary: false`, deleting a primary, or explicitly clearing a legacy primary field sets its parent projection to null. No other row is chosen. Deleting a non-primary leaves the projection unchanged.

## 📝 Migration & Backward Compatibility

Add schema and snapshot first; keep the old columns. A resumable, dry-run-capable customers upgrade command reads decrypted primaries in bounded scoped batches and upserts children under the same parent lock used for live writes, matching the parent's canonical value (or exact decrypted legacy value) and recording a contact-point migration receipt. Repeat runs compare source and existing children without overwriting operator changes. Record counts, IDs and dispositions without raw PII. Do not apply local migrations without the repository-required approval.


The internal `customer_contact_point_migrations` receipt stores UUID ID, tenant/org/parent IDs, `migration_version`, input fingerprint, decision code, created/updated times and the resulting primary child IDs. Unique `(tenant_id, organization_id, entity_id, migration_version)` enforces one receipt per source version; a changed input is recorded as a conflict for explicit reconciliation, not overwritten. It contains no raw PII; encrypted command snapshots preserve exact source values. Receipt and domain changes commit atomically. It has no ordinary public CRUD surface and does not depend on classification's separate journal. Backfill runs through a customers upgrade command under the existing queue/progress framework, with an explicit dry-run/apply option and 500-row scoped keyset batches.

Preserve every nonempty legacy value, including malformed email and local phone strings, as an explicit `legacy_unparsed` primary when canonicalization fails. Leave its legacy projection byte-for-byte unchanged and exclude it from automatic routing. Empty/null values create no child. Report repair counts and scoped review links. No destructive column/custom-field removal occurs in this capability.

Existing person/company `primaryEmail` and `primaryPhone` writes remain accepted. Before backfill completes, the bridge first materializes any existing nonempty primary lacking a child, preserving its encrypted before-snapshot. It then updates the currently primary child, makes an existing matching child primary, or creates one; null clears primary without deleting stored contacts. Legacy request versions retain their established parent-header contract. The bridge acquires the parent lock and reads current child versions inside that same transaction; because old clients never observed those children, it must not claim a child edit based on a caller-supplied stale snapshot. New child UIs use explicit child/parent versions. A mixed payload that expresses contradictory legacy and child choices is rejected.

The bridge uses the same canonical-identity transition rule as child writes. A case-only `primaryEmail` update preserves the matching point's delivery status, timestamp and source; selecting an existing matching destination retains that destination's own health. Neither bridge nor backfill upsert resets an existing point's health just because display spelling differs. A fresh canonical destination starts unknown, and primary selection never copies another destination's health.

Responses, list columns, filters and exports retain legacy primary fields for at least one minor version. Email linking and exact phone duplicate checks add all valid contact points, dedupe person IDs and maintain existing privacy and organization filters; legacy-primary fallback remains during backfill. General list filtering stays primary-based unless a new explicit `contactPoint` filter is requested. Document the bridge/deprecation in `UPGRADE_NOTES.md`. Rollback disables child editing and retains children plus primaries; it never drops data or overwrites a newer primary. Reconciliation is required before resuming after an old binary wrote legacy columns.

## 📝 UI/UX

Embed the contact table in existing person/company detail pages with stable `entityId` and `extensionTableId` `customers.contact_points`. Show kind, type, value, primary marker and delivery/repair status with text, not color alone. Use `DataTable`, `RowActions` IDs `edit`, `make-primary`, `delete`, `CrudForm` dialogs, `FormHeader`/`FormFooter`, `StatusBadge`, `SectionHeader`, `Alert`, `EmptyState`, `LoadingMessage` and `ErrorMessage`; missing parents render the existing not-found state. All copy uses locale keys and DS semantic tokens; icon buttons have accessible names; dialogs support Ctrl/Cmd+Enter and Escape.

The primary-change confirmation names old and new destinations; deleting/clearing a primary explains that no default destination remains. A repair state preserves and displays the old value until the user explicitly supplies a valid replacement. Conflicts retain unsaved form values and call `surfaceRecordConflict`; reload before retry. `CrudForm` derives the child header from `initialValues.updatedAt`; custom row actions use `useGuardedMutation`, scoped child headers and `retryLastMutation`, overriding any enclosing parent header.

Frontend contract: existing person/company page roots remain at their current boundaries; no new page-level client directive. New client leaves are `ContactPointsSection` (paged data/selection) and `ContactPointDialog` (form state/focus), each at most 300 lines, with effects cancelled on unmount. No global provider, new browser library or bootstrap import. Load the section with the detail tab; fetch one page, not every contact. Record baseline and changed route bundle/RSS evidence; target no more than 10 KiB gzip route delta, 5% measured steady-state dev RSS delta, and zero hydration errors. Exceptions need review. Route-load and keyboard interaction tests cover both parent kinds.

## 📝 Edge Cases & Failure Scenarios

Concurrent promotions yield one primary and one conflict. Parent deletion blocks child mutation. Existing people/company deletion and create-undo physically remove parents, so extend those commands to lock the aggregate, snapshot all active/deleted contact rows and migration receipts, remove children before parent, and restore parent then original children during undo. Permission history, if installed, keeps scalar contact IDs/destination snapshots and must not cascade-delete with these rows. Restore revalidates parent/child versions and uniqueness; a concurrent mutation serializes or conflicts rather than disappearing from the snapshot. Test physical delete/create-undo, delete-undo restoration and duplicate/primary restoration conflicts for both parent kinds. Duplicate-value restore or primary undo after a newer promotion returns conflict, preserving the newer state. Execute/undo snapshots include custom fields, all changed children and prior parent projections; undo runs the same guards and after-commit side effects. A failed index update never rolls back committed domain state; display refreshed authoritative data and queue supported repair.

Cross-record duplicate warnings disclose only records the caller may view. Empty primary, legacy-unparsed and bounced addresses never become an implicit send fallback. Decryption/KMS failure fails the read/write closed and retains ciphertext. Backfill interruption resumes from committed progress; configuration failure produces no partial child/projection pair.

## 📝 Risks & Impact Review

The main risks are lost primaries during migration, alternate-address privacy leakage, and a stale UI using a parent's version for a child. Transactional bridges, encryption-on tests and explicit versions address them. Canonical matching may classify case variants as duplicates; display values and audit evidence remain intact. A number-shaped value is not proof of reachability. No new production dependency is required.

## 📋 Phasing

1. Add the child schema and transactional compatibility bridge, keeping existing pages operable.
2. Backfill and reconcile, then release child APIs and contact editing together.
3. Extend address matching and verify compatibility/rollback with the companion permission capability independently gated.

## Integration Coverage

Standalone contact-point tests cover case/whitespace-equivalent email edits through child PUT and both person/company legacy primary-field bridges, preserving all three health/provenance fields with encryption on/off and keyed/no-pepper matching. A genuinely different destination resets those fields; selecting an existing matching point preserves its own state. Cross-spec permission/sender tests create an evidenced grant for `sales@example.com`, mark it bounced through the delivery-status action, edit it to `Sales@example.com`, and require fresh evaluation and both actual sender paths to remain denied as `DESTINATION_BOUNCED` with zero provider calls. Repeat through the person's legacy `primaryEmail` update, and verify its `emailBounced` projection stays true. These are required future implementation tests, not executed runtime tests in this design PR.


## Final Compliance Report — 2026-10-22

| Rule source | Design result |
|---|---|
| Root, core, customers, shared AGENTS | Scoped child ownership; no cross-module ORM; commands, guards, child/aggregate versions and reversible writes specified. |
| Core encryption and cache/events guides | Explicit PII maps/keyed hashes/decrypted reads; scoped after-commit effects; no plaintext cache. |
| UI/backend guides and DS rules | Canonical forms/tables, guarded HTTP, i18n/accessibility and bounded client leaves specified. |
| BACKWARD_COMPATIBILITY.md | Additive schema and APIs; primary read/write bridges and retained columns. |
| QA and spec guides | Every API/key UI path has required same-change integration coverage; data/API/undo/cache contracts agree. |

Design review passes these rules; implementation and runtime validation remain future work. Market evidence is directional and does not establish prevalence. The umbrella owns independent scope-cohesion review.

## Changelog

- 2026-10-22: Initial autonomous design for issue #7700; separated contact points from contact-permission policy.
- 2026-10-25: Preserve delivery health/provenance for canonical-equivalent child and legacy-primary edits; require cross-spec bounce/grant/sender regression coverage.

## 📋 Implementation Plan

1. Add entities, validators, encryption maps/backfill and snapshot; unit-test canonicalization, keyed-hash and no-pepper paths, and primary uniqueness. Run migration generation again as a no-op check.
2. Implement commands/undo and legacy bridges; test simultaneous promotions, clear/delete, secondary edits, invalid imports, rollback reconciliation and failure between demotion/promotion.
3. Add CRUD/OpenAPI and same-change integration tests for every GET filter/pagination, POST, PUT and DELETE path for both parent kinds, including 401/403/404/409/422/428, wildcard ACLs, tenant/org isolation and encryption enabled/disabled.
4. Add the two detail client leaves and API-fixture-based Playwright coverage for add/edit/primary/delete, keyboard use, loading/empty/error/not-found, stale child conflict and deleting a primary without fallback. Fixtures clean up in `finally` and never require demo data.
5. Extend existing matching consumers and test secondary emails/phones, shared inbox duplicates, permissions/privacy and idempotent migration retry. Run the umbrella's generation, build, typecheck, unit/integration and frontend-boundary gate before implementation PR completion.
