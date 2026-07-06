# EUDR Compliance Module — Commodity Evidence & Due Diligence Statements

## TLDR
**Key Points:**
- New core module `eudr` (packages/core) turning Open Mercato into a system of record for EU Deforestation Regulation (EUDR) compliance: map catalog products to regulated commodities, collect supplier origin evidence (geolocation, quantities, producer data, documents), score evidence completeness, and track Due Diligence Statements (DDS) with an exportable evidence packet.
- Buyer: EU importers/traders of coffee, cocoa, cattle, palm oil, rubber, soy, wood and derived products, facing the 2026-12-30 (large/medium) and 2027-06-30 (micro/small) application dates.
- v1 is the backend compliance workspace (compliance staff manage evidence). Supplier self-service portal and EU IS (TRACES) API integration are explicitly staged as later phases.

**Scope (v1 — this spec's implementation):**
- Product→commodity mappings referencing catalog products by FK-id (+ denormalized snapshot).
- Evidence submissions per supplier (customers company FK-id) with GeoJSON geolocation, quantity, harvest window, producer name (encrypted), attachment references, status workflow, and server-computed completeness score + missing-field list.
- DDS records (reference/verification numbers, status lifecycle) linking submissions; JSON export packet endpoint with readiness summary.
- Full platform integration: `makeCrudRoute` APIs + OpenAPI, undoable commands, typed events, ACL features + default role grants, optimistic locking, i18n (en/de/es/pl), migrations, guard-test registrations, backend UI (DataTable lists + CrudForm pages), integration tests.

**Concerns:**
- Regulatory interpretation risk: the EU IS data model may evolve before the application dates; v1 keeps the evidence model additive and export-shaped rather than claiming submission-format fidelity.
- Supplier data quality is the product's core risk — completeness scoring is the mitigation, not a legal guarantee (surfaced in UI copy as readiness, not legal advice).

## Idea Analysis (why this module, why now)

Input idea: "EUDR Commodity Evidence Portal" (scored 43/50, strong candidate). Assessment against the platform:

- **Regulatory trigger is real and dated**: EUDR application dates are 2026-12-30 for large/medium operators, 2027-06-30 for micro/small ones. The EU Information System already supports DDS workflows, GeoJSON origin uploads and bulk APIs — meaning buyers must assemble exactly the data this module manages.
- **Broken workflow matches OM's shape**: importers already run catalog (products with `hs_code`, `country_of_origin_code` — shipped via `.ai/specs/2026-06-11-catalog-compliance-and-commercial-product-fields.md`), suppliers as CRM companies, orders in sales, files in attachments, and audit trails. Today the EUDR evidence lives in spreadsheets/questionnaires (GS1 EUDR questionnaire) disconnected from those records. The gap is *linking evidence to actual products, suppliers, and orders* — precisely OM's data graph.
- **SMB/mid-market wedge**: enterprise sustainability suites over-serve; spreadsheets under-serve. A compliance workspace embedded in the commerce backoffice is the differentiator.
- **Platform leverage** (verified in repo): catalog products (FK target + HS code source), customers companies (supplier FK target), attachments (evidence documents), audit_logs + undoable commands (audit trail for free), workflows/notifications (future automation), customer_accounts portal (future supplier self-service).
- **Kill criteria awareness**: if buyers delegate EUDR wholly to brokers, the module still functions as the evidence archive brokers demand (retention duty stays with the operator — DDS data must be retained; the export packet is the hand-off artifact).

**Verdict: build.** MVP wedge = evidence model + completeness + DDS registry + export packet. The supplier-facing portal upload flow is deliberately Phase 2: it doubles the auth/UI surface (customer-account scoping, portal RBAC, portal event bridge) and is not required for the first paid compliance-sprint experiment, which compliance staff can run back-office.

## Overview

The `eudr` module gives compliance/procurement teams:
1. **Product mappings** — declare which catalog products fall under EUDR (commodity, HS code, in-scope flag).
2. **Evidence submissions** — one record per supplier evidence package: origin country, plot geolocation (GeoJSON), quantity, harvest window, producer, documents (attachment ids), free-text notes. The server computes `completenessScore` (0–100) and `missingFields` on every write.
3. **Due diligence statements** — the DDS registry: internal title, commodity, EU IS reference/verification numbers, status lifecycle, optional sales-order linkage; submissions attach to a statement. An **export packet** endpoint assembles statement + submissions + mappings + readiness summary as JSON for hand-off (broker, auditor, or manual EU IS entry).

> **Market Reference**: Studied the EU Information System for EUDR (DDS fields: commodity/HS code, quantity, geolocation GeoJSON, producer info, reference + verification numbers, statuses incl. submitted/available/withdrawn/archived) and the GS1 EUDR questionnaire (the spreadsheet workaround: supplier, origin, plot, batch fields). Adopted: their field vocabulary (so export maps 1:1 mentally), GeoJSON as the geolocation format, DDS reference/verification number pair. Rejected: modelling the full EU IS API schema in v1 (unstable before the application dates; kept additive instead), and building risk-assessment logic (country benchmarking) — out of scope until the Commission's benchmarking is consumable.

## Problem Statement

Compliance staff at EU importers must prove, per shipment of in-scope goods, that commodities are deforestation-free and legally produced — backed by plot-level geolocation and supplier documentation, referenced in a DDS filed in the EU IS. Their current tooling:
- Supplier questionnaires and shared drives → evidence disconnected from the products/orders it covers.
- No completeness view → missing origin/evidence discovered at shipment time, blocking imports or forcing risky assumptions.
- DDS references retained in spreadsheets → no durable link between statement, evidence, product, supplier, and order for the multi-year retention duty.

Open Mercato holds the product, supplier, and order records already — but has no EUDR evidence model.

## Proposed Solution

A self-contained core module `eudr` following the `customers` reference architecture: MikroORM entities + zod validators + undoable commands + `makeCrudRoute` APIs + DataTable/CrudForm backend pages, wired into ACL, events, encryption, optimistic locking, i18n, and the query index. Cross-module references are FK-ids + snapshots only (products, supplier companies, orders, attachments) — no ORM relations, no hard imports of other modules' business logic.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Module id `eudr` (core package) | The regulation acronym is the domain name (like `auth`); precedent for non-plural ids: `catalog`, `search`, `checkout`, `data_sync`. User explicitly requested a core module. Tables prefixed `eudr_`, features `eudr.*`, routes `/api/eudr/*`. |
| Commodity is a **code enum**, not a dictionary | EUDR Annex I commodities (`cattle, cocoa, coffee, oil_palm, rubber, soya, wood`) are fixed by law; validation and scoring logic depend on them. Dictionaries are for tenant-customizable lists — this isn't one. Additive enum growth if the Annex expands. |
| Completeness scoring is a **pure function** run server-side on every submission write | Deterministic, unit-testable, no DI service surface in v1. Persisted (`completeness_score`, `missing_fields`) so lists/filters/exports don't recompute. |
| Evidence documents = `attachment_ids` (uuid[]) on the submission | FK-id convention; uploads go through the existing attachments module. v1 stores references; the export packet lists them. No junction table until sharing-across-submissions is needed. |
| Statement↔submission link = nullable `statement_id` **on the submission** (intra-module FK) | One-to-many is the real workflow (evidence gathered, then bundled into a DDS); simplest undo story. Many-to-many deferred until evidence reuse across statements is demanded. |
| `producer_name` and submission `notes` encrypted | Producer names identify natural persons (smallholders); notes are free text about suppliers/producers. Declared in `encryption.ts` `defaultEncryptionMaps`; reads via `findWithDecryption`. Geolocation stays plaintext jsonb in v1 (needed for future map/area validation; risk documented). |
| Statuses are enums with **manual transitions** (no state machine in v1) | Compliance staff drive the workflow; guard rails are enum validation + audit trail. Workflow automation is a later phase via the workflows module. |
| Export packet = custom **GET** route returning JSON | Read-only (no mutation guard needed), feature-gated by `eudr.statements.view`. CSV/PDF renderings deferred. |
| Snapshots (`product_snapshot`, `supplier_snapshot`) captured at write time, supplied by the UI picker (validated shape, display-only) | FK-id + snapshot convention: names survive peer-module absence/deletion. v1 keeps commands free of cross-module reads — the picker already holds the record; server-side re-resolution (enricher or command-side lookup) is a Phase-2 hardening item. Absent snapshot degrades to raw id in UI, never blocks the write. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| App-level module (`apps/mercato/src/modules/`) or official-modules submodule | User explicitly asked for a core module; EUDR compliance is a platform capability aligned with the shipped catalog-compliance direction. |
| Generic `trade_compliance` module hosting EUDR as one regime | Speculative generality; EUDR's evidence model (plots, commodities, DDS) is regime-specific. A future CBAM/other-regime module can share patterns, not tables. |
| Extending `catalog` with EUDR fields via custom fields/extensions | Evidence submissions and DDS are supplier/shipment-scoped aggregates, not product attributes; they need their own lifecycle, ACL, and UI. |
| Supplier portal upload in v1 | Doubles the surface (portal RBAC, customer-account↔company scoping, portal uploads) without being required for the first paid experiment. Phase 2. |

### Resolved Questions (decided from repo context; recorded for transparency)
- **Q: portal in v1?** No — Phase 2 (see Alternatives). The admin UI covers the paid-sprint workflow.
- **Q: order linkage?** Optional `order_id` uuid on the statement (FK-id, no snapshot in v1; plain input in UI with helper text). Order picker UX is Phase 2.
- **Q: seed data?** None in v1 (`setup.ts` only grants role features). Commodities are code-level constants.
- **Q: search.ts / notifications / AI tools?** Deferred (roadmap) — not required for the wedge.

## User Stories / Use Cases
- **Compliance lead** wants to **mark which products are EUDR in-scope with commodity + HS code** so that procurement knows which purchases need evidence.
- **Compliance staff** wants to **record a supplier's origin evidence (plots, quantity, harvest window, documents) and see what's missing** so that gaps are chased before shipment.
- **Compliance staff** wants to **bundle verified evidence into a DDS record with the EU IS reference/verification numbers** so that the trader's retention duty is met.
- **COO/auditor** wants to **export a single JSON packet per DDS** so that brokers/auditors/manual EU IS entry get everything in one artifact.
- **Admin** wants to **grant view-only vs manage access per team** so that procurement can see readiness without editing evidence.

## Architecture

Standard self-contained core module at `packages/core/src/modules/eudr/`:

```
eudr/
├── index.ts            # module metadata (id: 'eudr', title, i18n ns)
├── acl.ts              # features (view/manage per entity)
├── setup.ts            # defaultRoleFeatures (admin: eudr.*, employee: *.view)
├── events.ts           # createModuleEvents — crud events, singular entities
├── ce.ts               # entity declarations (custom-field capable, no default fields)
├── encryption.ts       # defaultEncryptionMaps: eudr:evidence_submission producer_name, notes
├── data/
│   ├── entities.ts     # 3 MikroORM v7 entities (below)
│   └── validators.ts   # zod schemas + commodity/status const arrays (types via z.infer)
├── lib/
│   └── completeness.ts # pure scoring function + REQUIRED_DIMENSIONS
├── commands/           # undoable commands (customers pattern), index.ts imports all
│   ├── index.ts
│   ├── product-mappings.ts
│   ├── evidence-submissions.ts
│   └── statements.ts
├── api/
│   ├── openapi.ts      # createCrudOpenApiFactory({ defaultTag: 'EUDR' })
│   ├── product-mappings/route.ts        # /api/eudr/product-mappings (CRUD)
│   ├── evidence-submissions/route.ts    # /api/eudr/evidence-submissions (CRUD)
│   ├── statements/route.ts              # /api/eudr/statements (CRUD)
│   └── statements/[id]/export/route.ts  # GET /api/eudr/statements/:id/export
├── backend/eudr/
│   ├── product-mappings/{page,create/page,[id]/page}.tsx
│   ├── evidence-submissions/{page,create/page,[id]/page}.tsx
│   └── statements/{page,create/page,[id]/page}.tsx   # detail: linked submissions + export button
├── i18n/{en,de,es,pl}.json
├── migrations/         # generated for this module only + .snapshot-open-mercato.json
└── __integration__/    # TC-EUDR-*.spec.ts (see Integration Test Coverage)
```

**Registration surfaces** (all additive):
- `apps/mercato/src/modules.ts` entry `{ id: 'eudr', from: '@open-mercato/core' }` — MUST land **before** `yarn generate` (generation silently skips unregistered modules).
- Guard tests (lockstep pair): `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts` `moduleEntities` map gets `eudr: ['EudrProductMapping', 'EudrEvidenceSubmission', 'EudrDueDiligenceStatement']`; `packages/core/src/__tests__/record-locks-coverage.test.ts` `RECORD_LOCKS_DECISIONS` gets a matching entry per entity.
- `acl.ts` and `encryption.ts` export BOTH named and `default` (generated runtime imports `.default`).
- `yarn generate` regenerates module registries + entity-id map. Generated slugs are snake_cased class names: `E.eudr.eudr_product_mapping` = `'eudr:eudr_product_mapping'`, `E.eudr.eudr_evidence_submission`, `E.eudr.eudr_due_diligence_statement`.

### Cross-Module Coupling (all soft)
| Peer | Mechanism | Absent-peer behavior |
|------|-----------|----------------------|
| catalog | `product_id` FK-id + `product_snapshot` (picker-supplied `{ name, sku }`, zod-validated) | snapshot null; mapping still saves; UI shows raw id |
| customers | `supplier_entity_id` FK-id + `supplier_snapshot` (picker-supplied `{ displayName }`) | same degradation |
| sales | `order_id` FK-id (optional, no snapshot) | inert uuid field |
| attachments | `attachment_ids` uuid[] references; uploads via attachments' own API/UI | ids retained; export lists ids only |
| audit_logs | automatic — writes go through undoable commands | n/a |

### Commands & Events
Commands (undoable, customers pattern, snapshot-based undo; plural-resource ids mirroring `customers.people.*`):
- `eudr.product_mappings.create|update|delete`
- `eudr.evidence_submissions.create|update|delete` (create/update recompute completeness inside the command; undo restores prior snapshot incl. score)
- `eudr.statements.create|update|delete`

Events (`events.ts`, category `crud`, singular entity, past tense):
- `eudr.product_mapping.created|updated|deleted`
- `eudr.evidence_submission.created|updated|deleted`
- `eudr.due_diligence_statement.created|updated|deleted`

## Data Models

Common columns on all three: `id` uuid PK, `tenant_id` uuid, `organization_id` uuid, `created_at`, `updated_at` (onCreate+onUpdate — optimistic locking default ON), `deleted_at` (soft delete). Tables snake_case, `eudr_` prefix.

### EudrProductMapping (`eudr_product_mappings`)
- `product_id`: uuid (required; catalog product FK-id)
- `product_snapshot`: jsonb null `{ name, sku }`
- `commodity`: text enum `cattle|cocoa|coffee|oil_palm|rubber|soya|wood` (required)
- `hs_code`: text null
- `is_in_scope`: bool default true
- `notes`: text null
- Partial unique index `(organization_id, product_id, commodity)` WHERE `deleted_at IS NULL`

### EudrEvidenceSubmission (`eudr_evidence_submissions`)
- `supplier_entity_id`: uuid (required; customers company FK-id)
- `supplier_snapshot`: jsonb null `{ displayName }`
- `commodity`: text enum (required)
- `product_mapping_id`: uuid null (intra-module ref → mapping)
- `statement_id`: uuid null (intra-module ref → statement)
- `origin_country`: text null (ISO 3166-1 alpha-2, uppercased by validator)
- `geolocation`: jsonb null (GeoJSON; zod checks `type` ∈ Feature/FeatureCollection/Point/Polygon/MultiPolygon + payload ≤ 1 MB)
- `quantity_kg`: numeric null (string in TS)
- `batch_number`: text null
- `harvest_from` / `harvest_to`: date null
- `producer_name`: text null — **encrypted**
- `attachment_ids`: jsonb uuid[] default `[]`
- `status`: text enum `draft|submitted|verified|rejected` default `draft`
- `completeness_score`: int default 0 (server-computed)
- `missing_fields`: jsonb string[] default all dimensions (server-computed)
- `notes`: text null — **encrypted**

**Completeness dimensions** (equal weight, `lib/completeness.ts`): `origin_country` set · valid `geolocation` present · `quantity_kg` > 0 · both harvest dates set and `from ≤ to` · `producer_name` set · ≥1 `attachment_ids`. Score = round(met/6×100); `missing_fields` = unmet keys.

### EudrDueDiligenceStatement (`eudr_due_diligence_statements`)
- `title`: text (required; internal label)
- `commodity`: text enum (required)
- `reference_number`: text null (EU IS DDS reference)
- `verification_number`: text null
- `status`: text enum `draft|submitted|available|withdrawn|archived` default `draft`
- `quantity_kg`: numeric null
- `order_id`: uuid null (sales order FK-id)
- `notes`: text null

## API Contracts

All CRUD routes: `makeCrudRoute` with `list.entityId`/`indexer.entityType` = `E.eudr.eudr_<entity>`, zod-validated bodies, org/tenant scoping via `withScopedPayload` (`@open-mercato/shared` `lib/api/scoped`), `updatedAt` returned in list+detail items, writes delegated to the module commands via `actions.{create,update,delete}.commandId`, OpenAPI exported via module `api/openapi.ts` factory. Feature gates per method (view for GET, manage for writes).

**Encrypted fields path**: grid list projections exclude `producer_name`/`notes`; detail reads (`?id=` on the list route) merge decrypted values via `findOneWithDecryption` in an `afterList` hook; the export route reads submissions via `findWithDecryption`. Writes encrypt transparently through the flush subscriber (never `nativeUpdate`).

### `/api/eudr/product-mappings` — features `eudr.mappings.view|manage`
- GET list: `?page,pageSize(≤100),search,commodity,isInScope,ids`; sortable `created_at,commodity`; response `{ items: [{ id, productId, productSnapshot, commodity, hsCode, isInScope, notes, updatedAt, createdAt }], total, page, pageSize, totalPages }`
- POST `{ productId: uuid, commodity, hsCode?, isInScope?, notes? }` → 201 `{ id }`; duplicate active (product, commodity) → 400 crud error
- PUT `{ id, …partial }` → 200; DELETE `?id=` or body `{ id }` → 200 (soft)

### `/api/eudr/evidence-submissions` — features `eudr.submissions.view|manage`
- GET list: filters `commodity,status,supplierEntityId,statementId,ids,search`; items include `completenessScore`, `missingFields`, snapshots, `updatedAt`
- POST `{ supplierEntityId: uuid, commodity, productMappingId?, statementId?, originCountry?, geolocation?, quantityKg?, batchNumber?, harvestFrom?, harvestTo?, producerName?, attachmentIds?, status?, notes?, supplierSnapshot? }` → 201 `{ id }` (completeness computed server-side; client-sent `completenessScore`/`missingFields` are rejected with 400 `eudr.errors.serverComputedField`)
- PUT `{ id, …partial }` → 200 (recomputes completeness); DELETE → 200 (soft)

### `/api/eudr/statements` — features `eudr.statements.view|manage`
- GET list: filters `commodity,status,ids,search`; POST `{ title, commodity, referenceNumber?, verificationNumber?, status?, quantityKg?, orderId?, notes? }` → 201; PUT/DELETE as above

### `GET /api/eudr/statements/[id]/export` — feature `eudr.statements.view`
Response 200:
```json
{
  "generatedAt": "ISO",
  "statement": { …statement fields },
  "submissions": [ { …submission fields incl. completenessScore, missingFields, attachmentIds } ],
  "productMappings": [ { …mappings referenced by included submissions } ],
  "readiness": {
    "ready": false,
    "submissionCount": 2, "verifiedCount": 1, "completeCount": 1,
    "gaps": [ { "submissionId": "…", "status": "draft", "completenessScore": 67, "missingFields": ["producer_name","documents"] } ]
  }
}
```
`ready` = `submissionCount > 0` ∧ every submission `status === 'verified'` ∧ every `completenessScore === 100`. 404 for unknown/foreign-org id. Exports `openApi`.

## Internationalization (i18n)
Namespace `eudr.*` in module `i18n/{en,de,es,pl}.json` (flat dotted keys, codepoint-sorted): nav/menu labels, page titles, field labels, status + commodity labels, completeness/readiness labels, error keys (`eudr.errors.duplicateMapping`, …). No hardcoded user-facing strings; internal-only throws prefixed `[internal]`.

## UI/UX
Backend pages under `/backend/eudr/*`, sidebar group "Compliance" (i18n'd) with three entries gated by view features. Customers-pattern pages:
- **Lists**: `DataTable` (pageSize ≤ 100) with search + filters (commodity, status, in-scope), row actions (edit/delete), columns incl. snapshot names, status `StatusBadge`-style semantic tokens, completeness as `NN%` (+ readiness on statements detail). Sticky behavior per DataTable defaults.
- **Create/Edit**: `CrudForm` (auto optimistic-lock header from `initialValues.updatedAt`; `createCrud/updateCrud/deleteCrud`). Product/supplier/mapping/statement pickers use the platform's async select pattern from customers/catalog forms; `order_id` is a plain optional text input (uuid-validated) in v1. Geolocation = JSON textarea with client-side GeoJSON validation message; attachments = uuid list input in v1 (uploads happen in the attachments module UI).
- **Statement detail**: statement CrudForm + linked-submissions table (filtered by `statementId`) + "Export packet" button (apiCall GET → downloads JSON file). Dialogs: Cmd/Ctrl+Enter submit, Escape cancel. All statuses rendered with semantic status tokens — no hardcoded Tailwind colors.

## Migration & Compatibility
- Purely **additive**: new tables only (3), new module id, new routes/features/events. No existing table, route, type, or contract surface is modified. `BACKWARD_COMPATIBILITY.md` deprecation protocol not triggered.
- Migrations live in `packages/core/src/modules/eudr/migrations/` + module snapshot; generated via `yarn db:generate`, unrelated-module churn excluded per repo rule. Not applied locally (`yarn db:migrate` left to the user).
- New ACL features delivered to existing tenants via `defaultRoleFeatures` + `yarn mercato auth sync-role-acls` (documented in PR; not run by the implementation).
- Rollback = disable module entry in `modules.ts`; tables remain (soft data retention).

## Implementation Plan

### Phase A — Foundation (entities, validators, module wiring)
1. `data/entities.ts` (3 entities), `data/validators.ts` (zod + const enums), `lib/completeness.ts` + unit tests (`__tests__/completeness.test.ts`), `encryption.ts`, `acl.ts`, `setup.ts`, `events.ts`, `ce.ts`, `index.ts`.
2. Register module in `apps/mercato/src/modules.ts`; add entities to optimistic-lock guard maps; `yarn generate`; `yarn db:generate` → module-scoped migration + snapshot.

### Phase B — Commands (undoable writes)
3. `commands/{product-mappings,evidence-submissions,statements}.ts` + `commands/index.ts` mirroring `customers/commands/people.ts`: create/update/delete with before/after snapshots, undo, `emitCrudSideEffects`/`emitCrudUndoSideEffects` with indexer, snapshot resolution (product/supplier) in try/catch, completeness recompute inside submission writes.

### Phase C — APIs
4. `api/openapi.ts`; three `makeCrudRoute` routes wired to commands (customers `api/people/route.ts` pattern) with feature gates, filters, `updatedAt` in responses; `statements/[id]/export/route.ts` custom GET with openApi + feature gate + org scoping.

### Phase D — Backend UI
5. Nine pages + shared form components under `backend/eudr/`; sidebar registration; `i18n/{en,de,es,pl}.json`.

### Phase E — Integration tests + gate
6. `__integration__/TC-EUDR-*.spec.ts` per Integration Test Coverage; full verification gate; DS guard.

### Roadmap (post-v1, separate specs)
- **Phase 2 — Supplier portal**: portal pages (`frontend/[orgSlug]/portal/eudr/…`) for supplier contacts to submit evidence + upload documents against their own company's submissions; portal RBAC features; notification to compliance on submission.
- **Phase 3 — EU IS (TRACES) integration**: integrations-module provider for DDS filing/status sync; import verification numbers back.
- **Phase 4 — Risk & automation**: country benchmarking, workflows triggers (e.g. auto-flag incomplete evidence at order placement), search.ts, dashboards widget, CSV/PDF export renderings, order/product enrichers showing EUDR readiness.

## Integration Test Coverage (ships with this change)
Module-local Playwright specs (self-contained: API-created fixtures, cleanup in finally; policy-compliant test users; BASE_URL from env):
- **TC-EUDR-001 product-mappings API**: authenticated CRUD round-trip (POST→GET `?id=` readback→PUT→DELETE, `updatedAt` exposed for optimistic locking); 400 on invalid commodity; 400 on duplicate active (product, commodity); unauthenticated → 401 (asserted before any login on the shared request context); employee (view-only role) → GET 200, POST 403.
- **TC-EUDR-002 evidence-submissions API + scoring**: POST minimal → 201 with score 0 + all six `missingFields`; PUT filling all six dimensions → score 100, empty missing; client-sent `completenessScore` → 400 (`eudr.errors.serverComputedField`); invalid GeoJSON/originCountry → 400; DELETE soft-deletes (list excludes).
- **TC-EUDR-003 statements API + export**: CRUD round-trip; link submissions via `statementId`; GET export → packet shape (statement, submissions, productMappings, readiness with correct `ready`/gap math); export of foreign/unknown id → 404; view-only user can export (200), cannot PUT (403).
- **TC-EUDR-004 backend UI smoke**: login via form-encoded API, load `/backend/eudr/product-mappings`, `/backend/eudr/evidence-submissions`, `/backend/eudr/statements` — each renders its DataTable title (i18n en) without error state.

Unit tests (jest, same change): `lib/completeness.ts` dimension/edge cases (empty, partial, full, invalid dates order, empty attachment array).

## Risks & Impact Review

### Data Integrity Failures
- Submission write + completeness recompute happen in one command flush (single entity write; no cross-entity transaction needed). Snapshot resolution failures degrade to null and never abort the write.
- Concurrent edits: optimistic locking (default ON) on all three entities via `updated_at` + CrudForm auto-header → 409 conflict bar instead of lost updates.
- Dangling FK-ids (product/supplier/order deleted): by design (FK-id + snapshot convention); UI falls back to snapshot/raw id; export packet still complete.

### Cascading Failures & Side Effects
- Events are fire-after-commit crud events; no subscriber in v1 → no downstream blocking. Future subscribers must be idempotent per platform rules.
- No module depends on `eudr` in v1; peers are soft-referenced, so disabling catalog/customers degrades snapshots only.

### Tenant & Data Isolation Risks
- Every query/write scoped by `tenant_id` + `organization_id` through the CRUD factory + scoped payload helpers; export route resolves the statement with org scoping before assembling (404 on foreign org). Integration tests assert 403/404 paths.

### Migration & Deployment Risks
- Additive-only DDL (3 new tables + partial unique index) → zero-downtime; re-runnable via MikroORM migration tracking; no backfill.

### Operational Risks
- Geolocation payloads bounded by zod (≤1 MB) to cap row size; lists never select `geolocation` (detail-only projection via `list.fields` function form if needed).
- Blast radius: module-local; failure disables EUDR pages/APIs only.

#### Risk: EU IS schema drift before application dates
- **Scenario**: Commission changes DDS fields/API before 2026-12-30; export packet no longer matches expectations.
- **Severity**: Medium — **Affected area**: export consumers.
- **Mitigation**: additive schema, export versioned by shape (`generatedAt` + stable keys); Phase 3 integration isolates EU IS specifics in a provider package.
- **Residual risk**: manual re-mapping effort; acceptable pre-enforcement.

#### Risk: completeness score read as legal compliance
- **Scenario**: users treat 100% as regulatory clearance.
- **Severity**: Medium — **Affected area**: user trust/liability.
- **Mitigation**: UI copy says "evidence completeness", readiness wording avoids legal claims; scoring dimensions documented.
- **Residual risk**: user misinterpretation; acceptable with copy review.

#### Risk: unencrypted plot geolocation
- **Scenario**: plot coordinates of smallholder farms could identify persons.
- **Severity**: Low/Medium — **Affected area**: GDPR posture.
- **Mitigation**: producer_name + notes encrypted now; geolocation encryption evaluated in Phase 2 (needs `parseDecryptedFieldValue` jsonb normalization); documented.
- **Residual risk**: plaintext coordinates at rest in v1; accepted consciously.

## Final Compliance Report — 2026-07-06

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) · `packages/core/AGENTS.md` · `packages/core/src/modules/customers/AGENTS.md` · `packages/ui/AGENTS.md` (via DS/CrudForm rules) · `.ai/specs/AGENTS.md` · `ARCHITECTURE.md` (§11/§27/§31)

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No cross-module ORM relations | Compliant | FK-ids + snapshots only |
| root AGENTS.md | Tenant/org scoping everywhere | Compliant | CRUD factory + scoped export route |
| root AGENTS.md | Optimistic locking on new editable entities | Compliant | `updated_at` on all 3; CrudForm auto-header; guard maps updated |
| root AGENTS.md | Zod validators in `data/validators.ts`, types via `z.infer` | Compliant | |
| root AGENTS.md | i18n for all user-facing strings | Compliant | 4 locales; `[internal]` prefix rule honored |
| packages/core AGENTS.md | `makeCrudRoute` + `indexer.entityType`; openApi on every route | Compliant | incl. custom export route |
| packages/core AGENTS.md | Writes via command pattern (audit/undo) | Compliant | customers pattern, undo snapshots |
| packages/core AGENTS.md | New features in `acl.ts` + `setup.ts` defaultRoleFeatures | Compliant | admin `eudr.*`, employee view-only |
| packages/core AGENTS.md | Events declared in `events.ts` (`module.entity.action`, singular, past tense) | Compliant | |
| packages/core AGENTS.md | Encryption map for GDPR fields + `findWithDecryption` | Compliant | producer_name, submission notes |
| packages/core AGENTS.md | Migrations module-scoped, additive, snapshot updated | Compliant | |
| spec-writing skill | Singularity Law (commands/events/features singular entity) | Compliant | `eudr.product_mapping.*` |
| DS rules | Semantic status tokens; no arbitrary values; dialog key bindings | Compliant | UI section mandates |
| root AGENTS.md | Integration tests defined and shipped in-change | Compliant | TC-EUDR-001..004 + unit tests |

### Internal Consistency Check
| Check | Status |
|-------|--------|
| Data models match API contracts | Pass |
| API contracts match UI/UX section | Pass |
| Risks cover all write operations | Pass |
| Commands defined for all mutations | Pass |
| Cache strategy | N/A (no list cache opt-in in v1) |

### Non-Compliant Items
None.

### Verdict
**Fully compliant** — ready for implementation.

## Changelog
### 2026-07-06
- Initial specification (v1 scope: backend compliance workspace; portal + EU IS staged).
- Pre-implement audit corrections (see `.ai/specs/analysis/ANALYSIS-2026-07-06-eudr-compliance-module.md`): plural-resource command ids; exact generated entity-id slugs; `record-locks-coverage.test.ts` + default-export registration requirements; encrypted-field read path for detail/export.
- Review-gate fixes (four-reviewer jury): export route resolves the selected-organization scope via `resolveOrganizationScopeForRequest` (not token `auth.orgId`); command-layer submission reads decrypt with the record's tenant/org scope; list `sortField` accepts any string resolved through an exhaustive `sortFieldMap` (header-click sorting); duplicate-mapping guard additionally filters `tenant_id`; detail pages read the route id from the `params` prop (backend catch-all router contract).
