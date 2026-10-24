# CRM classification and safe field consolidation

**Date:** 2026-10-22 · **Status:** Draft — migration decisions require confirmation · **Issue:** [#7700](https://github.com/open-mercato/open-mercato/issues/7700)

## 📝 TLDR

Give CRM operators distinct lifecycle, health, and renewal fields without losing classifications already stored by tenants. Promote relationship health into the customer aggregate and make the existing renewal-quarter column the preferred write surface. Company relationship types, hierarchy, contact consent, lead intake, and deal closure ship under separate specifications.

## Resolved assumptions (autonomous defaults)

| ID | Question | Default and rationale | Confirmation |
|---|---|---|---|
| C1 | What lifecycle vocabulary ships? | Seed `lead`, `prospect`, `customer`, `former_customer`, `disqualified`; preserve tenant-defined values and the existing lenient API. A dropdown default is not a new closed enum. | ⚠ NEEDS HUMAN CONFIRMATION — issue calls the mapping blocking. |
| C2 | May migration infer consent or discard classifications? | Preserve `subscriber`, `other`, unknown values and contradictory legacy facts for review. Never create consent from a lifecycle label. | ⚠ NEEDS HUMAN CONFIRMATION — intentionally safer than destructive proposal rows. |
| C3 | How does `Q1` become year-qualified? | Preserve it as unresolved until an operator supplies a year. Never use migration year, current year, or record creation year as invented evidence. | ⚠ NEEDS HUMAN CONFIRMATION |
| C4 | One document for classification and hierarchy? | Split hierarchy into its own spec because either capability works alone. | Reversible scope split; coverage retained. |
| C5 | How long do old writes work? | Keep old fields/custom-field keys readable and writable through bridges for at least one minor release. UI stops offering new legacy choices; it does not delete the underlying API contract. | Compatibility default. |
| C6 | Are company relationship types part of this consolidation? | No. Independent review identified a separate data model/UI/filter capability; split into [Company relationship types](2026-10-22-crm-company-relationship-types.md). | Reversible scope split; coverage retained. |

## 📝 Overview

This is legacy customer-classification consolidation: migration, compatibility bridges, and editing surfaces share the same preservation and precedence rules. New company relationship types are specified separately. This does not change a customer into the separate Lead staging object described in [Customers Lead Funnel](2026-04-03-customers-lead-funnel.md).

The audit baseline is `main` at `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`. `CustomerEntity` already owns `status`, `lifecycleStage`, `temperature`, and `renewalQuarter`; `customFieldDefaults.ts` seeds company `relationship_health` and `renewal_quarter`. Person health is new. Company `annual_revenue_currency` already appears as a custom field in the detail page and remains untouched, consistent with the issue's exclusion of revenue-currency work.

## 📝 Problem Statement

Different classifications answer different questions: lifecycle describes commercial progression, relationship types describe why the company is in the CRM, health describes the relationship assessment, and renewal quarter describes a dated expectation. Collapsing all four into status makes reporting ambiguous; merely deleting overlapping fields loses tenant-specific meaning. Yearless renewal data and `subscriber` cannot safely supply missing facts about a year or marketing permission.

HubSpot documents lifecycle separately from lead status and activity dates ([default contact properties](https://knowledge.hubspot.com/properties/hubspots-default-contact-properties)). A [HubSpot community report](https://community.hubspot.com/t/improvements-to-leads-sales-workspace/126943) describes operator confusion across lead and lifecycle terminology. This is qualitative evidence, not a prevalence claim. The design implication is explicit field purposes and one authoritative lifecycle input, not copying another CRM's vocabulary wholesale.

## 📝 Proposed Solution

Use the existing customers dictionary and aggregate command patterns. Prefer a single editable lifecycle in first-party forms, retain deprecated fields under a read-only legacy-details section, and preserve custom dictionary options on display. Person buying-role custom fields and company-link roles remain unchanged; company relationship types are handled by their separate specification.

Alternatives rejected: hard enum replacement would reject existing integration payloads; copying all legacy values into the new field would create conflicts; using relationship types as roles or permissions would change authorization semantics; silently translating `Q1` into this year's first quarter would invent data.

## 📝 Architecture

Changes remain under `packages/core/src/modules/customers/`: `data/entities.ts`, `data/validators.ts`, `commands/{people,companies}.ts`, API projections, dictionary configuration, `customFieldDefaults.ts`/`ce.ts`, and existing person/company forms. No shared-package domain helper, new production dependency, or cross-module business import is needed.

`customers.people.*` and `customers.companies.*` commands own all writes and snapshots. Extend `runCrudCommandWrite`/atomic flush phases so native values and retained custom-field mirrors commit together. Capture immutable before/after values from that exact transaction for audit/replay; command-bus log persistence retains its existing post-domain-write lifecycle rather than pretending it commits in the domain transaction. An absent key preserves a value; explicit `null` clears a nullable scalar. New fields take precedence when both new and legacy keys are present. Snapshot both representations, and undo restores both atomically; redo reapplies the same normalizer. Publish existing customer CRUD/index/cache side effects after commit, including custom-field reset snapshots. No new lifecycle events are needed for this slice.

## 📝 Data Models

| Owner | Property / column | Type and rule |
|---|---|---|
| `CustomerEntity` | `relationshipHealth` / `relationship_health` | Nullable text, single customers dictionary value, seeded `healthy`, `monitor`, `at_risk`; people and companies. |
| `CustomerEntity` | `relationshipHealthHash` / `relationship_health_hash` | Nullable text blind-index sibling for exact matching; internal, absent from APIs. |
| `CustomerEntity` | `lifecycleStage` / existing `lifecycle_stage` | Existing nullable text retained; seed C1 vocabulary, keep existing tenant-defined options and historical values. |
| `CustomerEntity` | `status`, `temperature` | Existing columns and values retained; deprecated in first-party editing, still API-compatible. |
| `CustomerEntity` | `renewalQuarter` / existing `renewal_quarter` | Preferred company renewal source. New first-party choices use `YYYY_q[1-4]`; legacy yearless text stays readable and API-accepted during the bridge. Existing person values are preserved. |

Relationship health uses custom kind and route `relationship-health` with identity mapping; do not map an existing custom slug to `relationship_health`. Renewal reuses the existing `renewal-quarters` route and its existing `renewal_quarter` kind mapping. Preserve existing entries/settings, including intentionally empty dictionaries; seed only a previously absent kind under a scoped mutation lock. Newly seeded renewal choices are explicit year-qualified values for 2026–2028; later years can be added normally, never by rewriting existing options. Add `GET /api/customers/classification-options?entityKind=person|company&field=relationshipHealth` returning `{items:[{value,label,icon?,color?}]}` under the corresponding people/company view ACL and scoped dictionary query. This avoids broadening the generic dictionary GET guard, which currently requires people-view. Deleting an option must not erase record values; unresolved values render as retained legacy options.

Relationship health is an assessment about a person as well as a company. Add `relationship_health` with `hashField: 'relationship_health_hash'` to the `customers:customer_entity` default encryption map; use existing encrypted-query equality support and a scoped hash index, never direct plaintext comparisons or hand-rolled hashing. Lifecycle/status storage remains unchanged. Reads use decryption helpers. No free-text migration diagnostic enters search/logs/telemetry; old CF values stay in existing protected snapshots.

### Migration and Backward Compatibility

Create an additive schema migration and matching customers snapshot; no old table, column, index, custom-field definition, or API key is dropped. `status` and `temperature` remain readable, writable, and filterable for at least one minor version with deprecation documentation and `UPGRADE_NOTES.md`. The proposal's later removal is a separate change requiring the full deprecation protocol, not a scheduled deletion in this implementation.

Run a resumable, tenant/org-scoped reconciliation through customers commands in the standard queue/progress framework. A dry run reports counts and conflicts before a maintainer-authorized apply; it never logs names or contact data. Persist its immutable preview items in internal `customer_classification_migrations`: UUID `id`, `tenant_id`, `organization_id`, `entity_id`, `preview_job_id`; text `migration_version`, `input_fingerprint`, `decision_code`, `state` (`preview`, `applied`, `skipped`); bounded JSONB `applied_fields` (field names only); timestamp `expected_updated_at`, nullable `applied_updated_at`; and `created_at`/`updated_at`. Unique `(preview_job_id, entity_id)` identifies the reviewed items; a partial unique `(tenant_id, organization_id, entity_id, migration_version) WHERE state='applied'` makes retries converge. Items contain no raw values. Fingerprints cover all classification inputs, including relevant CF values, with existing canonical serialization; they are internal and never returned. The preview ProgressJob pins scope/mapping version and expiry (24 hours). Apply must reference that successfully completed, unexpired preview job; it cannot recalculate a new record set from current data. Under each record's command transaction, re-read and compare both original fingerprint and expected version, skip/report differences, recompute the deterministic approved action only for an exact match, then mark applied in the same transaction. Existing command snapshots retain reversible values. Reruns skip applied items; new/edited records require a new preview.

| Legacy input | Safe migration result |
|---|---|
| `status=archived` | Preserve an already-false `isActive`; if currently true, report a contradictory-state conflict for explicit operator decision. Never silently deactivate it. |
| `status=inactive` | If lifecycle is empty, `lead`, or `prospect`, propose `disqualified`; preserve `customer`, `former_customer`, and custom/unknown values and report conflicts. |
| `status=active` or `pending` | No lifecycle mutation. |
| `lifecycleStage=churned` | Map to `former_customer`, retain original in the undo snapshot/journal decision. |
| `lifecycleStage=subscriber`, `other`, or unknown | Preserve; present review-needed classification. No consent write and no clearing. |
| Company `cf_relationship_health` with empty native value | Copy the nonempty value; keep the CF definition/value during bridge. Preserve custom tokens. |
| Both health representations differ | Native wins for display; retain CF, report conflict, do not overwrite either during reconciliation. |
| Native renewal empty and CF already `YYYY_q[1-4]` | Copy to column, keep CF bridge. |
| Yearless CF/native renewal or competing values | Retain original(s); require explicit operator selection of year and winning value. |

After reconciliation, all first-party paths write native fields. A legacy CF write carried by the customers company API/command maps into the native field and updates the legacy mirror, unless an explicitly supplied native key wins. Normalize both supported `cf_` and `cf:` prefixes and customValues forms before splitting fields. The generic `/api/entities/records` route currently rejects table-backed system entities with `SYSTEM_ENTITY_RECORDS_BLOCKED_CODE`; preserve and test that boundary rather than inventing a new cross-module writer. Audit any additional supported import/data-engine writer before activation and ensure its customers command path applies the same normalization; direct database mutation is unsupported. A legacy renewal value remains yearless; the bridge cannot invent a year. Custom-field keys/definitions stay installed and addressable; first-party layouts hide duplicates without removing frozen field/group IDs or injection spots.

## 📝 API Contracts

Existing `POST/PUT /api/customers/people` and company create/update gain optional nullable `relationshipHealth`. Existing `lifecycleStage` and `renewalQuarter` requests stay lenient and clearable through additive normalized inputs. Health remains bounded lenient text (maximum 150 characters), matching dictionary value bounds and preserving previously accepted legacy CF tokens; dictionaries supply choices rather than a new closed validation boundary. Historical-token recognition considers both native and CF representations, so copying or round-tripping an unknown token is valid. Native UI offers scoped dictionary options plus the record's retained historical option. Unknown legacy options need not be silently added to every tenant's dictionary.

`GET /api/customers/people`, `GET /api/customers/companies`, and their `[id]` detail routes add health using existing list snake_case/detail camelCase conventions. `relationshipHealth` belongs to the top-level `person`/`company` record, not the nested profile; `normalizeProfilePayload` remains unchanged. Health equality filters use QueryEngine encrypted-field equality support and the hash sibling before pagination; counts and exports share that predicate. No health text-search/order on ciphertext is offered. Existing status filters retain their meaning, not aliases for lifecycle.

Use existing view/manage features per resource, `makeCrudRoute` indexing, and updated `openApi` schemas. Unauthorized/missing parents follow existing 403/404 behavior, malformed values produce translated 400 field errors, and stale versions produce the standard 409 conflict bar. Return fresh `updatedAt` after inline edits. No client-supplied tenant or organization wins over authenticated scope.

`POST /api/customers/classification-reconcile` is the sole new action route. Discriminated input is `{ mode: 'preview', mappingVersion: 'crm-classification-v1' }` or `{ mode: 'apply', previewJobId: UUID }`. It operates only in the selected tenant/org and requires `customers.settings.manage`, `customers.people.manage` and `customers.companies.manage` through wildcard-aware guards. Apply verifies the preview's exact scope, completion, mapping version and expiry; a missing/inaccessible preview is 404 and an expired/incomplete one is 409. Return `202 { ok: true, progressJobId }`; use existing progress reads for counts (`eligible`, `applied`, `unchanged`, `conflicts`, `failed`), never raw personal values. Wire mutation guards, trusted scope, modified-payload revalidation and after-success callbacks. The worker executes an internal per-record `customers.classification.reconcile` command with the preview item, bounded batches of 100 and the journal/version checks above. Preview changes only progress/journal metadata. Cancellation stops between records, every job reaches terminal state, and retries skip applied entries. Settings offers Preview and explicit Apply confirmation bound to its completed preview job and confirmed mapping version. This design PR does not run Apply.

## 📝 UI/UX and Frontend Architecture Contract

Person/company create and detail forms show Lifecycle and Relationship health; companies also show a year-qualified Renewal quarter. An unresolved historical value stays visible with an explanatory `Alert` and a deliberate replacement action. Deprecated fields are discoverable in Legacy details; clearing one never clears a different field. Dictionary settings gains health and renewal kinds. Existing `CrudForm` groups, injection spots, and `DataTable` extension IDs stay stable.

Use shared `Select`, multi-select field, `StatusBadge`, `Alert`, `LoadingMessage`, `EmptyState`, and i18n in all five locales. Preserve semantic tokens; touched lines follow the Boy Scout rule. Dialogs support Escape and Cmd/Ctrl+Enter. Forms carry aggregate `updatedAt`; non-form inline writes use `useGuardedMutation`, scoped optimistic headers, and `surfaceRecordConflict`.

| Surface / client ledger | Boundary and justification |
|---|---|
| Existing person/company create and detail pages | Existing client roots remain temporary legacy exceptions; add no root directive or provider. Reuse their stateful form hosts, extract `CustomerClassificationFields` as a small client leaf for selection/dirty state. |
| Existing dictionary settings client | Existing stateful dictionary form; add data definitions, no new global state. |
| Existing list clients | Existing filter state; add column/filter metadata only. |

New client leaves stay below 300 LOC, add no heavy browser dependency, and introduce zero global providers. Before implementation merge, require client-boundary check, hydration/form smoke tests for every changed route, and a production bundle comparison showing no new shared chunk dependency and at most 10 KiB gzip route growth; investigate any larger delta. Existing oversized roots are an explicit exception; this change must not increase their orchestration complexity.

## 📝 Edge Cases & Failure Scenarios

An unrecognized legacy option is preserved, not replaced with a default. Classifications never propagate to linked people or child companies. Deleted dictionary options render retained text until deliberately changed. Migration abort/retry preserves already-applied records and reports conflict counts. Partial record failure cannot commit half of a native/CF pair; the atomic command rolls back. Migration undo checks the currently applied version and refuses to erase a subsequent edit.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Lifecycle migration changes sales meaning | High | C1–C3 draft gate, dry-run conflict report, restricted deterministic mappings, versioned undo. | Product owner must confirm semantics. |
| Custom-field writes bypass promoted-field bridge | High | Inventory supported import/API writers, normalize all customers CF payload forms, and preserve generic system-entity rejection. | Third-party direct SQL is outside supported writes. |
| Yearless renewal becomes fabricated date | High | Never infer year; retain legacy value until chosen. | Some records need operator review. |
| New classifications leak into permissions | Medium | No ACL derivation; ordinary customer feature guards remain. | None introduced. |

Rollback deploys the previous code while retaining additive schema and mirrors. Do not reverse migrated values blindly; command undo or journal-selected compensating writes use version checks. No production migration is applied by this design PR.

## 🧪 Integration and Test Coverage

Ship self-contained fixtures and cleanup for every changed path: people/company POST/PUT/GET/list/detail; explicit null, omitted values, tenant/org isolation, unauthorized writes, stale 409, undo/redo, and compound native+CF conflicts. Test all customers CF payload forms, generic system-entity rejection, dictionary GET/POST/PATCH/DELETE, encrypted health equality before pagination and export parity. Test the new classification-options route for both entity kinds, company-only viewers, 150-character/unknown tokens and preserved pre-existing dictionaries, plus the existing renewal route mapping. Test classification-reconcile preview/apply, guards, 202 progress ID, preview binding/expiry/scope, edits after preview, worker failure/retry/cancellation, and conflict counts under local and async queue strategies. Migration tests cover all rows above, rerun, concurrent edit, failure rollback, and custom tokens absent from dictionaries. Browser tests cover person create/detail, company create/detail, their lists, and customer dictionary settings, including legacy replacement, Preview/Apply confirmation, progress and conflict recovery. Do not rely on seeded examples.

## Final Compliance Report — 2026-10-22

Reviewed root, core, customers, shared, UI/backend, events/cache/queue/progress, QA and specs guides, `BACKWARD_COMPATIBILITY.md`, and the spec-writing override. Independent review identified relationship types as separately deployable and they were split out. Its preview-binding, legacy-token and contradictory archived-state findings are resolved above. Aggregate commands, scoping, encrypted health/hash equality, CF snapshots, additive contracts, standard UI and integration coverage are specified. Data/API/UI/undo share one precedence rule. Lifecycle/year reconciliation still needs C1–C3 confirmation before implementation. Verdict: design ready for review; draft gate remains.

## Changelog

- 2026-10-22 — Initial autonomous draft; corrected destructive migration assumptions and split independent hierarchy and relationship types. Independent review hardened preview binding, legacy token handling and archived conflicts.

## 📋 Phasing and Implementation Plan

1. **Additive contracts.** Add encrypted health/hash fields, preview journal, scoped indexes, dictionaries and schema snapshot. Unit-test bounds and seeds; old application behavior remains valid.
2. **Bridge before promotion.** Implement native/CF normalization, aggregate snapshots and all supported writer seams. Prove atomicity, 409 and undo/redo before exposing new controls.
3. **Reconcile safely.** Ship dry-run/apply worker with ProgressJob, bounded batches, idempotency journal and conflict report. Obtain C1–C3 confirmation; run only in explicitly authorized environments.
4. **Expose classification.** Update API projections/OpenAPI, filters/export and forms/settings in one working slice; add API/browser tests and i18n.
5. **Verify and publish compatibility.** Run scoped tests plus configured gates using the selected runner, client/bundle checks, upgrade notes and deprecation annotations. Keep all legacy surfaces functional through at least one minor release; removal requires a later spec.
