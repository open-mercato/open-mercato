# CRM classification and safe field consolidation

**Date:** 2026-10-22 · **Status:** Draft — lifecycle and renewal decisions require separate confirmation; each slice needs its own approval · **Issue:** [#7700](https://github.com/open-mercato/open-mercato/issues/7700)

## 📝 TLDR

Give CRM operators distinct lifecycle, health, and renewal fields without losing classifications already stored by tenants. This document defines three independently approved and deployed slices: lifecycle reconciliation, relationship-health promotion, and renewal consolidation. Each has its own mapping version, preview/apply job and cutover; health can ship while lifecycle/renewal decisions remain unresolved. Company relationship types, hierarchy, contact consent, lead intake, and deal closure ship under separate specifications.

## Resolved assumptions (autonomous defaults)

| ID | Question | Default and rationale | Confirmation |
|---|---|---|---|
| C1 | What lifecycle vocabulary ships? | Seed `lead`, `prospect`, `customer`, `former_customer`, `disqualified`; preserve tenant-defined values and the existing lenient API. A dropdown default is not a new closed enum. | ⚠ NEEDS HUMAN CONFIRMATION — issue calls the mapping blocking. |
| C2 | May migration infer consent or discard classifications? | Preserve `subscriber`, `other`, unknown values and contradictory legacy facts for review. Never create consent from a lifecycle label. | ⚠ NEEDS HUMAN CONFIRMATION — intentionally safer than destructive proposal rows. |
| C3 | How does `Q1` become year-qualified? | Preserve it as unresolved until an operator supplies a year. Never use migration year, current year, or record creation year as invented evidence. | ⚠ NEEDS HUMAN CONFIRMATION |
| C4 | One document for classification and hierarchy? | Split hierarchy into its own spec because either capability works alone. | Reversible scope split; coverage retained. |
| C5 | How long do old writes work? | Keep old fields/custom-field keys readable and writable through bridges for at least one minor release. UI stops offering new legacy choices; it does not delete the underlying API contract. | Compatibility default. |
| C6 | Are company relationship types part of this consolidation? | No. Independent review identified a separate data model/UI/filter capability; split into [Company relationship types](2026-10-22-crm-company-relationship-types.md). | Reversible scope split; coverage retained. |
| C7 | Must lifecycle, health and renewal ship together? | No. Use the independent slice/version/gate table below; share only normalization and journal conventions from the umbrella. | Review-requested boundary; no C1–C3 approval is inferred for health. |

## 📝 Overview

This is legacy customer-classification consolidation: each slice's migration, compatibility bridge, and editing surfaces use the same preservation and precedence conventions without sharing a release gate. New company relationship types are specified separately. This does not change a customer into the separate Lead staging object described in [Customers Lead Funnel](2026-04-03-customers-lead-funnel.md).

The audit baseline is `main` at `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`. `CustomerEntity` already owns `status`, `lifecycleStage`, `temperature`, and `renewalQuarter`; `customFieldDefaults.ts` seeds company `relationship_health` and `renewal_quarter`. Person health is new. Company `annual_revenue_currency` already appears as a custom field in the detail page and remains untouched, consistent with the issue's exclusion of revenue-currency work.

## 📝 Problem Statement

Different classifications answer different questions: lifecycle describes commercial progression, relationship types describe why the company is in the CRM, health describes the relationship assessment, and renewal quarter describes a dated expectation. Collapsing all four into status makes reporting ambiguous; merely deleting overlapping fields loses tenant-specific meaning. Yearless renewal data and `subscriber` cannot safely supply missing facts about a year or marketing permission.

HubSpot documents lifecycle separately from lead status and activity dates ([default contact properties](https://knowledge.hubspot.com/properties/hubspots-default-contact-properties)). A [HubSpot community report](https://community.hubspot.com/t/improvements-to-leads-sales-workspace/126943) describes operator confusion across lead and lifecycle terminology. This is qualitative evidence, not a prevalence claim. The design implication is explicit field purposes and one authoritative lifecycle input, not copying another CRM's vocabulary wholesale.

## 📝 Proposed Solution

Use the existing customers dictionary and aggregate command patterns. Prefer a single editable lifecycle in first-party forms, retain deprecated fields under a read-only legacy-details section, and preserve custom dictionary options on display. Person buying-role custom fields and company-link roles remain unchanged; company relationship types are handled by their separate specification.

### Independent approval and deployment slices

| Slice / mapping version | Approved scope and activation gate | Independent deployment result |
|---|---|---|
| `lifecycle` / `crm-lifecycle-v1` | Confirm C1–C2 / umbrella A2 for vocabulary and legacy mappings; review only lifecycle/status/temperature migration. | Seed approved lifecycle defaults, reconcile lifecycle, and retire first-party status/temperature editing while preserving APIs. No health or renewal change. |
| `health` / `crm-relationship-health-v1` | Approve health fields, dictionary and native/CF precedence in its implementation PR; preview/reconcile only health. C1–C3 / A2–A3 are not prerequisites and are not implicitly approved. | Add health schema/encryption/hash, APIs/filter/export and UI; bridge/hide only the health CF duplicate. Existing lifecycle/status/temperature and renewal behavior remains available. |
| `renewal` / `crm-renewal-quarter-v1` | Confirm C3 / umbrella A3 for yearless-source handling and any authorized year mapping; preview/reconcile only renewal. | Promote the existing renewal column and its CF bridge, year-qualified selector and unresolved-value UI. No lifecycle or health change. |

Each slice ships as a complete working migration/API/UI/test PR and records its own approval, mapping version, reconciliation report and rollback evidence. There is no all-fields apply or shared classification cutover. Any slice may be delayed or rolled back without disabling another approved slice. The umbrella's A4 consent/sender gate remains separate. Shared conventions are documented in the [umbrella](2026-10-22-crm-field-model-phase-1.md); reuse code only where needed, not a new generic migration platform or a prerequisite implementation of the other slices.

Alternatives rejected: hard enum replacement would reject existing integration payloads; copying all legacy values into the new field would create conflicts; using relationship types as roles or permissions would change authorization semantics; silently translating `Q1` into this year's first quarter would invent data.

## 📝 Architecture

Changes remain under `packages/core/src/modules/customers/`: `data/entities.ts`, `data/validators.ts`, `commands/{people,companies}.ts`, API projections, dictionary configuration, `customFieldDefaults.ts`/`ce.ts`, and existing person/company forms. No shared-package domain helper, new production dependency, or cross-module business import is needed.

`customers.people.*` and `customers.companies.*` commands own all writes and snapshots. Extend `runCrudCommandWrite`/atomic flush phases for the deployed slice so its native values and retained custom-field mirrors commit together; the undeployed slices retain current behavior. Capture immutable before/after values from that exact transaction for audit/replay; command-bus log persistence retains its existing post-domain-write lifecycle rather than pretending it commits in the domain transaction. An absent key preserves a value; explicit `null` clears a nullable scalar. New fields take precedence when both new and legacy keys are present. Snapshot both representations, and undo restores both atomically; redo reapplies the same normalizer without restoring unrelated slice fields. Publish existing customer CRUD/index/cache side effects after commit, including custom-field reset snapshots. No new lifecycle events are needed for this design.

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

Run a resumable, tenant/org-scoped reconciliation for exactly one approved slice/version through customers commands in the standard queue/progress framework. A dry run reports counts and conflicts before a maintainer-authorized apply; it never logs names or contact data. Persist its immutable preview items in internal `customer_classification_migrations`: UUID `id`, `tenant_id`, `organization_id`, `entity_id`, `preview_job_id`; text `slice` (`lifecycle`, `health`, `renewal`), `migration_version`, `input_fingerprint`, `decision_code`, `state` (`preview`, `applied`, `skipped`); bounded JSONB `applied_fields` (field names only, restricted to that slice); timestamp `expected_updated_at`, nullable `applied_updated_at`; and `created_at`/`updated_at`. Unique `(preview_job_id, entity_id)` identifies the reviewed items; a partial unique `(tenant_id, organization_id, entity_id, slice, migration_version) WHERE state='applied'` makes retries converge independently. Items contain no raw values. Fingerprints cover only that slice's inputs, including its relevant CF values, using existing canonical serialization; they are internal and never returned. The preview ProgressJob pins scope, slice, exact mapping version and expiry (24 hours). Apply must reference that successfully completed, unexpired preview job; it cannot substitute a slice/version or recalculate a new record set from current data. Under each record's command transaction, re-read and compare both original fingerprint and expected aggregate version, skip/report differences, recompute the deterministic approved action only for an exact match, then mark applied in the same transaction. Even an unrelated edit can invalidate the aggregate version and require a fresh preview; never bypass optimistic locking to run two slices together. Existing command snapshots retain reversible values. Reruns skip applied items only for their own slice/version; new/edited records require a new preview.

| Slice | Legacy input | Safe migration result |
|---|---|---|
| lifecycle | `status=archived` | Preserve an already-false `isActive`; if currently true, report a contradictory-state conflict for explicit operator decision. Never silently deactivate it. |
| lifecycle | `status=inactive` | If lifecycle is empty, `lead`, or `prospect`, propose `disqualified`; preserve `customer`, `former_customer`, and custom/unknown values and report conflicts. |
| lifecycle | `status=active` or `pending` | No lifecycle mutation. |
| lifecycle | `lifecycleStage=churned` | Map to `former_customer`, retain original in the undo snapshot/journal decision. |
| lifecycle | `lifecycleStage=subscriber`, `other`, or unknown | Preserve; present review-needed classification. No consent write and no clearing. |
| health | Company `cf_relationship_health` with empty native value | Copy the nonempty value; keep the CF definition/value during bridge. Preserve custom tokens. |
| health | Both health representations differ | Native wins for display; retain CF, report conflict, do not overwrite either during reconciliation. |
| renewal | Native renewal empty and CF already `YYYY_q[1-4]` | Copy to column, keep CF bridge. |
| renewal | Yearless CF/native renewal or competing values | Retain original(s); require explicit operator selection of year and winning value. |

After a slice's reconciliation and approval, its first-party paths write its native fields. A legacy CF write for that deployed slice carried by the customers company API/command maps into the native field and updates the legacy mirror, unless an explicitly supplied native key wins. Normalize both supported `cf_` and `cf:` prefixes and customValues forms before splitting fields. The generic `/api/entities/records` route currently rejects table-backed system entities with `SYSTEM_ENTITY_RECORDS_BLOCKED_CODE`; preserve and test that boundary rather than inventing a new cross-module writer. Audit any additional supported import/data-engine writer before each slice's activation and ensure its customers command path applies the same normalization; direct database mutation is unsupported. A legacy renewal value remains yearless; the bridge cannot invent a year. Custom-field keys/definitions stay installed and addressable; first-party layouts hide only the deployed slice's duplicates without removing frozen field/group IDs or injection spots. Health deployment never hides status/temperature or renewal inputs and never clears `subscriber`.

## 📝 API Contracts

Existing `POST/PUT /api/customers/people` and company create/update gain optional nullable `relationshipHealth`. Existing `lifecycleStage` and `renewalQuarter` requests stay lenient and clearable through additive normalized inputs. Health remains bounded lenient text (maximum 150 characters), matching dictionary value bounds and preserving previously accepted legacy CF tokens; dictionaries supply choices rather than a new closed validation boundary. Historical-token recognition considers both native and CF representations, so copying or round-tripping an unknown token is valid. Native UI offers scoped dictionary options plus the record's retained historical option. Unknown legacy options need not be silently added to every tenant's dictionary.

`GET /api/customers/people`, `GET /api/customers/companies`, and their `[id]` detail routes add health using existing list snake_case/detail camelCase conventions. `relationshipHealth` belongs to the top-level `person`/`company` record, not the nested profile; `normalizeProfilePayload` remains unchanged. Health equality filters use QueryEngine encrypted-field equality support and the hash sibling before pagination; counts and exports share that predicate. No health text-search/order on ciphertext is offered. Existing status filters retain their meaning, not aliases for lifecycle.

Use existing view/manage features per resource, `makeCrudRoute` indexing, and updated `openApi` schemas. Unauthorized/missing parents follow existing 403/404 behavior, malformed values produce translated 400 field errors, and stale versions produce the standard 409 conflict bar. Return fresh `updatedAt` after inline edits. No client-supplied tenant or organization wins over authenticated scope.

`POST /api/customers/classification-reconcile` is the sole new action route. Preview input is a strict discriminated union `{ mode: 'preview', slice: 'lifecycle', mappingVersion: 'crm-lifecycle-v1' }`, `{ mode: 'preview', slice: 'health', mappingVersion: 'crm-relationship-health-v1' }`, or `{ mode: 'preview', slice: 'renewal', mappingVersion: 'crm-renewal-quarter-v1' }`. Apply is `{ mode: 'apply', previewJobId: UUID }` and inherits exactly that preview's slice/version. Reject wrong slice/version pairs, undeployed slices and all-fields requests with translated 400 field errors and no job/domain mutation. A deployment registers only its approved implemented slices; registering health neither registers nor activates lifecycle/renewal. No global classification mapping version remains.

The action operates only in the selected tenant/org and requires `customers.settings.manage`, `customers.people.manage` and `customers.companies.manage` through wildcard-aware guards. Apply verifies the preview's exact scope, slice, enabled mapping version, completion and expiry; a missing/inaccessible preview is 404 and an expired/incomplete or no-longer-enabled one is 409. Return `202 { ok: true, progressJobId }`; use existing progress reads for counts (`eligible`, `applied`, `unchanged`, `conflicts`, `failed`), never raw personal values. Wire mutation guards, trusted scope, modified-payload revalidation and after-success callbacks. The worker executes an internal per-record `customers.classification.reconcile` command with the preview's slice/version, bounded batches of 100 and the journal/version checks above. It may change only that slice's approved field set. Preview changes only progress/journal metadata. Cancellation stops between records, every job reaches terminal state, and retries skip applied entries for that slice/version. Settings offers separate Preview and explicit Apply confirmations showing slice and mapping version; there is no combined Apply. This design PR does not run Apply or approve a slice.

## 📝 UI/UX and Frontend Architecture Contract

After each respective slice deploys, person/company create and detail forms show its Lifecycle or Relationship health controls; companies show the year-qualified Renewal quarter when renewal deploys. An unresolved historical value stays visible with an explanatory `Alert` and a deliberate replacement action. Only the lifecycle cutover moves deprecated status/temperature fields to Legacy details; clearing one never clears a different field. Dictionary settings gains health and renewal kinds with their respective slices. Existing `CrudForm` groups, injection spots, and `DataTable` extension IDs stay stable.

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
| Lifecycle migration changes sales meaning | High | Lifecycle-only C1–C2 gate, dry-run conflict report, restricted deterministic mappings, versioned undo. | Product owner must confirm semantics. |
| Custom-field writes bypass promoted-field bridge | High | Inventory supported import/API writers, normalize all customers CF payload forms, and preserve generic system-entity rejection. | Third-party direct SQL is outside supported writes. |
| Yearless renewal becomes fabricated date | High | Never infer year; retain legacy value until chosen. | Some records need operator review. |
| New classifications leak into permissions | Medium | No ACL derivation; ordinary customer feature guards remain. | None introduced. |

Rollback disables only the affected slice's editor/worker registration while retaining additive schema, mirrors and other deployed slices. Do not reverse migrated values blindly; command undo or journal-selected compensating writes use aggregate version checks and restore only the selected slice's fields. Never overwrite later health edits while compensating a lifecycle migration, or vice versa. No production migration is applied by this design PR.

## 🧪 Integration and Test Coverage

Ship self-contained fixtures and cleanup for every changed path: people/company POST/PUT/GET/list/detail; explicit null, omitted values, tenant/org isolation, unauthorized writes, stale 409, undo/redo, and compound native+CF conflicts. Test all customers CF payload forms, generic system-entity rejection, dictionary GET/POST/PATCH/DELETE, encrypted health equality before pagination and export parity. Test the new classification-options route for both entity kinds, company-only viewers, 150-character/unknown tokens and preserved pre-existing dictionaries, plus the existing renewal route mapping. Test classification-reconcile preview/apply, guards, 202 progress ID, preview binding/expiry/scope, edits after preview, worker failure/retry/cancellation, and conflict counts under local and async queue strategies. Migration tests cover all rows above, rerun, concurrent edit, failure rollback, and custom tokens absent from dictionaries. Browser tests cover person create/detail, company create/detail, their lists, and customer dictionary settings, including legacy replacement, Preview/Apply confirmation, progress and conflict recovery. Do not rely on seeded examples.

Each slice's implementation includes its affected subset of that matrix. Add a health-only deployment fixture with lifecycle and renewal unimplemented/unapproved: health CRUD/filter/export, encrypted equality, CF bridge, preview/apply, UI and undo work; lifecycle/status/temperature/renewal values, choices, editors and CF mirrors are unchanged. Exercise each valid slice/version pair, wrong pairs, undeployed slices and rejected all-fields requests. Assert previews/apply/receipts for one slice cannot select, write, mark applied or hide inputs for another, including separate reruns on the same record. When multiple slices are installed, concurrent applies serialize/conflict on aggregate versions, and undo/rollback of one cannot erase another slice's later edit. Browser confirmations identify the slice/version; health approval and deployment never imply C1–C3 confirmation. Test lifecycle-only and renewal-only deployments analogously, and scope yearless-value cases solely to renewal.

## Final Compliance Report — 2026-10-22

Reviewed root, core, customers, shared, UI/backend, events/cache/queue/progress, QA and specs guides, `BACKWARD_COMPATIBILITY.md`, and the spec-writing override. Independent review identified relationship types as separately deployable and they were split out. Its preview-binding, legacy-token and contradictory archived-state findings are resolved above. Aggregate commands, scoping, encrypted health/hash equality, CF snapshots, additive contracts, standard UI and integration coverage are specified. Data/API/UI/undo use consistent slice-specific precedence. Lifecycle needs C1–C2 confirmation; renewal needs C3; health needs its own contract approval with neither decision as a prerequisite. Verdict: design ready for review; the umbrella's A2–A4 draft gate remains and no slice is approved by this report.

## Changelog

- 2026-10-22 — Initial autonomous draft; corrected destructive migration assumptions and split independent hierarchy and relationship types. Independent review hardened preview binding, legacy token handling and archived conflicts.
- 2026-10-25 — Define independently approved/deployed lifecycle, health and renewal slices with separate mapping versions, journals, Preview/Apply jobs, field-limited undo and release gates; health does not imply C1–C3 approval.

## 📋 Phasing and Implementation Plan

1. **Choose and approve one slice.** Select health, lifecycle or renewal and its exact mapping version. Obtain only its approval from the gate table; do not combine their implementation PRs or wait for unrelated decisions. Shared journal/normalization conventions may be implemented by the first slice without enabling the others.
2. **Ship that slice end to end.** Add only its required schema/encryption/indexes/dictionaries and journal fields, its native/CF bridge and snapshots, its slice-bound preview/apply worker, APIs/OpenAPI and forms/settings. Ship its unit/API/browser tests together; prove 409, undo/redo, idempotency and independent rollback before cutover. Health adds no lifecycle rewrite or year mapping; lifecycle/renewal follow their approved mappings only.
3. **Verify and publish that slice's compatibility.** Run scoped tests plus configured gates using the selected runner, client/bundle checks, upgrade notes and deprecation annotations. Keep legacy surfaces functional through at least one minor release. Apply only in explicitly authorized environments and retain its reconciliation report.
4. **Repeat independently for another approved slice.** Reuse established conventions and existing journal schema without treating an applied receipt, UI deployment or approval from one slice as evidence for another. Removal still requires a later spec.
