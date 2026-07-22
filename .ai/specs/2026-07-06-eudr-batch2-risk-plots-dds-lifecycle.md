# EUDR Compliance Batch 2 — Risk Assessment, Plot Registry, DDS Lifecycle & Ecosystem Integration

## TLDR
**Key Points:**
- Batch 2 of the `eudr` core module (batch 1: product mappings, evidence submissions, DDS registry + export — `.ai/specs/2026-07-06-eudr-compliance-module.md`, commit 9c3dd840a, same unmerged branch). This batch makes the module current with the regulation as applied in July 2026 and with competitor table-stakes (LiveEO TradeAware, osapiens HUB, Meridia Verify, IntegrityNext, Prewave), while deepening Open Mercato ecosystem integration so users select existing records instead of typing UUIDs.
- **Regulation-driven**: country risk benchmarking (Implementing Regulation tiers low/standard/high; Art. 13 simplified due diligence), Art. 10 risk assessments with criteria checklist + negligible/non-negligible conclusion + annual review tracking, Art. 11 mitigation actions, DDS lifecycle with guarded status transitions and the **72-hour amend/withdraw window**, upstream DDS reference chaining (SME-trader flow), plot geolocation rules (point <4 ha / polygon ≥4 ha, 6-decimal precision, WGS84 GeoJSON).
- **Competitor-driven**: first-class plot registry per supplier (reusable across submissions), GeoJSON file import with per-row validation report, Leaflet map preview (dependency already in `packages/core`), compliance-readiness dashboard widget with deadline countdown, mitigation "action tool".
- **Ecosystem/UX-driven**: order picker on statements (replaces raw uuid input), `AttachmentInput` uploads on submission edit (replaces uuid textarea), searchable country selects with names localized via `Intl.DisplayNames`, catalog products response enricher + injected EUDR column, HS-code scope suggestions ("these products look in-scope but unmapped"), read-only AI tool pack + `eudr.compliance_assistant` agent on the platform's ai-assistant surface.

**Scope (batch 2 — this spec):**
- 3 new entities: `EudrPlot`, `EudrRiskAssessment`, `EudrMitigationAction` (+ additive columns on submissions & statements).
- Reference data lib: country risk tiers, Annex-I HS prefixes, supplementary-unit HS list, application dates, Art. 10 criteria catalog, ISO country codes.
- Statement lifecycle: transition map + submission gate (readiness + risk conclusion / simplified DD / SME-trader referenced statements) + 72h amend/withdraw guard + retention display.
- New APIs: plots CRUD + import, risk assessments CRUD, mitigation actions CRUD, dashboard widget data, mapping suggestions + apply, export v2 (risk/plots/lifecycle blocks + `?format=geojson`).
- UI: plots pages with map preview + import dialog, risk assessment pages + statement risk section, lifecycle action bar with countdown, order picker, country/plot pickers, attachments upload, dashboard widget, injected catalog column, suggestions dialog.
- AI: read-only tools + agent per `om-create-ai-agent` conventions.
- i18n ×4 locales for every new enum/label/error; integration tests TC-EUDR-005…009 + unit tests.

**Concerns:**
- The EUDR-IS (TRACES) API remains SOAP-based and its June-2026 relaunch specs are still moving — batch 2 stays export-shaped (JSON packet + GeoJSON file) and defers live filing to the roadmap integration provider.
- Country benchmarking and Annex-I HS mappings are law-versioned reference data; they live in ONE maintained lib file with source/effective-date doc headers so a delegated-act change is a one-file PR.
- Batch 1 is unreleased (same branch); tightening its write semantics (transition guards) breaks no external consumer.

## Batch Analysis (why these features, why now)

Research pass 2026-07-06 (regulation + 12 competitor/benchmark products) found:
- **Application dates hold**: 2026-12-30 (large/medium + timber-sector micro/small), 2027-06-30 (other micro/small). The May-2026 simplification package (guidance 5th ed., draft Annex-I delegated act, updated IS implementing act) reduces cost but does not reopen the text. A compliance module must now implement the *operating* mechanics: benchmarking tiers (checks 1%/3%/9%), Art. 13 simplified DD, the 72h amend/withdraw lock, and reference-number chaining.
- **Country benchmarking is consumable** (the batch-1 blocker "until the Commission's benchmarking is consumable" is gone): high = BY, MM, KP, RU (+ sanctioned states); low = 140 countries (all EU MS, UK, US, CA, CN, JP, AU, ZA, …); standard = default bucket (~50 incl. BR, ID, MY).
- **Competitor table-stakes** we lack: plot-level registry with map view (Meridia, Satelligence, TradeAware), readiness dashboards per SKU/supplier (TradeAware, osapiens), mitigation action tracking (IntegrityNext "Action Tool"), bulk geo import with per-row validation, document-evidence UX, AI assistants.
- **Differentiator**: none of the studied products surface the 72-hour amend/withdraw state machine explicitly — a hard regulatory constraint (statement locked once the window passes or the reference is used downstream) that we can encode as guarded transitions + countdown UI.

> **Market Reference**: Adopted — plot registry reusable across submissions (Meridia/Koltiva farm-plot model), Art. 10 four-bucket criteria checklist (country / supply-chain / plot-supplier / documentation, per Commission guidance synthesis), mitigation actions with status + due date (IntegrityNext), readiness rollups (TradeAware), GeoJSON as the interchange format (EUDR-IS `geometryGeojson`). Rejected — satellite deforestation overlays (needs imagery vendor; roadmap), blockchain traceability (SAP Green Token model — wrong weight class for the SMB wedge), live SOAP submission (unstable pre-relaunch API; roadmap provider package), per-hectare pricing mechanics (commercial, not product).

## Problem Statement
Batch 1 records evidence but cannot answer the questions that decide whether a DDS may lawfully be filed: *Which origin countries are low/standard/high risk? Was an Art. 10 risk assessment performed and documented, with what conclusion? What mitigation is pending? Which plots exactly, and do their geometries satisfy the point/polygon and precision rules? Can this statement still be amended or withdrawn?* Compliance staff also still type UUIDs (orders, attachments) and free-text country codes, and the module is invisible from the rest of the backoffice (no dashboard, no catalog surface, no AI assistant).

## Proposed Solution
Extend the `eudr` module in place (same architecture: MikroORM entities + zod validators + undoable commands + `makeCrudRoute` + DataTable/CrudForm pages), adding the risk layer, the plot registry, lifecycle enforcement, and UMES/AI ecosystem surfaces. All changes additive; cross-module references stay FK-id + snapshot.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Country risk tiers as **code-level reference data** (`lib/reference-data.ts`) | Fixed by Implementing Regulation like the commodity enum; single maintained file with effective-date header. Helper `getCountryRiskTier(iso2) → 'low'|'standard'|'high'|'unknown'` — only exceptions stored (4 high + 140 low), standard is the default bucket, unknown for unrecognized codes (treated as standard-with-warning in UI, never blocks). |
| **Plot registry** (`eudr_plots`) with `plot_ids` uuid[] on submissions (like `attachment_ids`) | Farms don't move; competitors model plots first-class and reuse them across deliveries. Junction table deferred until per-link metadata is needed. Legacy `geolocation` jsonb on submissions stays (BC) as "direct GeoJSON" fallback; completeness `geolocation` dimension = valid legacy GeoJSON **or** ≥1 active linked plot. |
| Geometry validation is a **pure lib** (`lib/geometry.ts`), no new dependency | No @turf/* in repo. Implements: GeoJSON parse/normalize to Feature, WGS84 bounds, ring closure, decimal-precision warning (<6 decimals), geodesic area (spherical excess, WGS84 mean radius — adequate for a 4-ha threshold), point-with-area>4ha → error `eudr.errors.polygonRequired`. Leaflet (already `packages/core` dep ^1.9.4) used for **read-only preview only** — drawing/editing deferred (leaflet-draw would be a new dep). |
| **Risk assessment per statement** (not per submission), latest-wins, with stored country-tier snapshot | The DDS is the legal unit that needs a documented negligible-risk conclusion (Art. 4(1)); statement aggregates submissions. `countryRisks` jsonb snapshots tiers at assessment time (law-versioned data → assessments stay historically true). Re-assessment = new record (audit history for the Art. 12 annual review). `reviewDueAt` defaults to assessedAt + 1 year. |
| **Criteria checklist as jsonb** `{criterionKey: {answer, note?}}` against a code-level catalog (~14 criteria in 4 groups) | Art. 10(2) criteria are fixed by law → catalog like commodities; answers are tenant data. `answer ∈ no_concern|concern|not_applicable`. Conclusion is the assessor's explicit choice; server enforces: `negligible` + any `concern` answer requires ≥1 **completed** mitigation action (Art. 11 documentation duty) else 400 `eudr.errors.mitigationRequired`. |
| **Mitigation actions** as child entity of risk assessment | IntegrityNext Action-Tool precedent; Art. 11 requires documented measures with revisit. Fields: type enum, title, status enum, dueDate, completedAt (auto on completion). |
| **Statement transitions as a const map enforced in BOTH create and update commands** (no state-machine framework) | Matches repo precedent (inline command validation via `createCrudFormError`); map: `draft→[submitted,archived]`, `submitted→[draft,available,archived]`, `available→[withdrawn,archived]`, `withdrawn→[archived]`, `archived→[]`. **Create accepts only `status='draft'` (or omitted)** — any other status on POST → 400 `eudr.errors.invalidTransition` (otherwise a direct POST as `submitted`/`available` would bypass every gate). UI renders allowed next statuses as confirmed actions. Invalid → 400 `eudr.errors.invalidTransition`. |
| **Submission gate** on draft→submitted, with **assessment freshness** | `actorRole='sme_trader'` → requires ≥1 `referencedStatements` entry (SME traders only pass upstream references). Otherwise requires batch-1 export-readiness (`ready === true`: every linked submission verified + 100%) **and** risk cleared: **fresh** latest assessment with conclusion `negligible`, or **simplified DD** (every linked submission has an origin country and all tiers are `low` — Art. 13, evaluated live at gate time). **Freshness (gate-time recheck)**: the assessment's `country_risks` snapshot must cover exactly the *current* distinct origin countries of linked submissions (set mismatch → `eudr.gate.riskAssessmentStale`), its `reviewDueAt` must not be in the past (→ `eudr.gate.riskReviewOverdue`), and its concern-criteria/mitigation rule is re-verified (→ `eudr.gate.mitigationIncomplete`). The gate response enumerates machine-readable reasons. |
| **72-hour window**: `referenceIssuedAt` is settable **only during the submitted→available transition** (≤ now enforced; defaults to now), then **immutable** | Users record when the EU IS actually issued the reference (may differ from data-entry time) — correct UX and makes the guard testable — but the field must not be able to *reopen* the window: any change to `referenceIssuedAt` outside that single transition → 400 `eudr.errors.referenceIssuedAtImmutable`; a future value → 400. (Residual: recording a later-than-actual past time extends the advisory window — the change is command-audited; documented.) When `status='available'` and now > referenceIssuedAt+72h: block edits to AMEND-guarded fields (commodity, quantityKg, supplementaryUnit/Qty, referencedStatements, orderId) and block →withdrawn → 400 `eudr.errors.amendWindowElapsed`. Withdraw additionally blocked if another active statement in the org references this statement's referenceNumber → 400 `eudr.errors.referencedDownstream`. Archived is read-only → 400 `eudr.errors.archivedReadOnly`. (EU-IS-side locks like customs use are outside our system — UI copy says the window is also subject to EU IS state.) |
| `referencedStatements` jsonb `[{referenceNumber, verificationNumber?}]` on statement | Upstream DDS chaining per Annex II — the SME-trader/downstream mechanic. Loose format validation (non-empty, ≤32 alnum chars, uppercased) — official formats observed (`25NLSN6LX69730`, 8-char verification) but not guaranteed; never hard-block on pattern, warn only. |
| **Attachment uploads** via existing `AttachmentInput` (attachments module owns linkage) + event-driven completeness recompute | `AttachmentInput` requires a saved record (fail-closed create flow) → embed on submission **edit** page; create page keeps hint. Since uploads bypass submission writes: (1) **additive released-module touch** — `packages/core/src/modules/attachments/lib/crud.ts` `buildPayload` gains `entityId`/`recordId` fields on `attachments.attachment.*` event payloads (event-payload **additions** are BC-permitted; today the payload is only `{id, organizationId, tenantId}`, and DELETE hard-deletes so the payload must carry the linkage — load-by-id is impossible on `deleted`); (2) **two** eudr subscriber files (subscriber `metadata.event` is a single event id): `recompute-completeness-on-attachment-created.ts` + `…-deleted.ts`, filtering payload `entityId === 'eudr:eudr_evidence_submission'`, recomputing the `documents` dimension (projection-style update + `query_index.upsert_one`, per the repo lesson — not a user mutation, no command/audit entry). Attachments events are **ephemeral inline emits** (no retry) — recompute is best-effort/fail-open; the score self-heals on the next submission write. `documents` dimension = `attachment_ids.length ≥ 1` **or** live linked-attachment count ≥ 1 (count via query engine, soft try/catch). Legacy `attachment_ids` textarea stays (BC, collapsed as advanced). |
| **Country selects via the platform's existing helpers + `ComboboxInput`** | The platform already ships `@open-mercato/shared/lib/location/countries` (`ISO_COUNTRIES`, `resolveCountryName`, `buildCountryOptions` — consumed by `ui/backend/detail/AddressEditor.tsx`) and a searchable `packages/ui/src/backend/inputs/ComboboxInput.tsx`. `CountrySelectField` composes those two — **no new countries lib, no new combobox** (retrieval-first). Localized names via the shared resolver with `useLocale()`; fallback = raw ISO code. Replaces free-text origin-country inputs (validator unchanged: uppercase ISO2). |
| **Order picker** reusing batch-1 `AsyncSelectField` against `GET /api/sales/orders` | Label `${orderNumber} — ${customer}` from the route's items (`buildDocumentCrudOptions({kind:'order', numberField:'orderNumber'})`); snapshot `{ orderNumber }` stored in new `order_snapshot` jsonb. Soft-degrades when sales module absent (loadError message, id passthrough) like batch-1 pickers. |
| **Catalog enricher + injected column**, feature-gated | `data/enrichers.ts` targeting the catalog product entity, namespace `_eudr` `{ commodity, isInScope }`, `enrichMany` batch (no N+1), `features: ['eudr.mappings.view']`, timeout + fallback null (fail-open). **Enrichers only run when the target route opts in** — second additive released-module touch: `catalog/api/products/route.ts` gains `enrichers: { entityId: <catalog product entity id> }` in its `makeCrudRoute` options (mirroring `customers/api/deals/route.ts` which already opts in). Injected DataTable column registered in eudr's `widgets/injection-table.ts` against the spot **`data-table:catalog.products.list:columns`** — DataTable resolves column widgets from `data-table:${extensionTableId}:columns` and the catalog products table's perspective table id is `catalog.products.list` (verified `ProductsDataTable.tsx` + `DataTable.tsx`), paired with the enricher per §31-F; TC-EUDR-009 asserts the column header renders. |
| **HS scope suggestions** — deterministic, not AI | `GET /api/eudr/product-mappings/suggestions` scans catalog products via query engine (fields sku/name/hs code) for Annex-I HS prefixes without an active mapping; `POST …/suggestions/apply {items}` loops the existing create command server-side (each row independently undoable; per-row result list). Annex-I prefix map is reference data marked non-authoritative (delegated-act churn) — suggestions only, never auto-writes. |
| **AI = read-only tool pack + agent** (`om-create-ai-agent` conventions) | 5 tools (`eudr.get_compliance_overview`, `eudr.list_statement_readiness`, `eudr.list_evidence_gaps`, `eudr.check_product_scope`, `eudr.get_country_risk`), zod input schemas, `requiredFeatures` per resource `.view`, handlers scope by ctx tenant/org via container; agent `eudr.compliance_assistant` `mutationPolicy: 'read-only'` whitelisting the pack. No mutation tools in batch 2 (approval-flow surface deferred). |
| Dashboard widget with own data route | Mirrors customers `new-customers` widget: `widgets/dashboard/compliance-overview/widget.ts` (metadata `{id:'eudr.compliance-overview', features:['eudr.statements.view'], defaultSize:'md'}` + `lazyDashboardWidget` loader) + `widget.client.tsx` component + `GET /api/eudr/dashboard/widgets/compliance-overview`. **Auto-discovered by `yarn generate`** (the generator populates `Module.dashboardWidgets` — no hand-written `index.ts` entries). |
| Export packet v2 stays **additive JSON** + new `?format=geojson` | New top-level keys only (`riskAssessment`, `mitigationActions`, `plots`, `lifecycle`); `format=geojson` returns a FeatureCollection of all plot geometries + legacy submission geolocations (properties: plotName, supplierName, producerName decrypted — same feature gate as the packet). EU-IS SOAP schema fidelity remains rejected (unstable; roadmap provider). |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Supplier self-service portal in batch 2 | Still the batch-1 "Phase 2" — doubles auth/UI surface (portal RBAC, customer-account scoping); the user's batch-2 asks are operator-facing. Roadmap. |
| Risk assessment per submission | The legal conclusion attaches to the DDS (statement); per-submission risk would fragment the Art. 12 annual-review trail. Statement-level with country-tier snapshot covers mixed-origin statements via `countryRisks[]` + `overallTier: 'mixed'`. |
| DB-stored benchmarking list (admin-editable) | Law-versioned data as tenant data invites drift and wrong legal claims; code-level with doc header = reviewable, versioned, one-file update (same rationale as the commodity enum). |
| Leaflet drawing/editing of polygons | leaflet-draw = new production dependency + heavy UX surface; paste/upload + validate + preview covers the collection reality (suppliers send files). Roadmap. |
| @turf/turf for area/validation | New dependency for ~60 lines of pure math; spherical-excess area is sufficient for a 4-ha threshold check (error <0.5% at plot scale). |
| Live TRACES SOAP submission | June-2026 IS relaunch still stabilizing; SME wedge files manually/via broker today. Roadmap: `sync-eudr-is` provider package per the integrations lesson. |
| AI document extraction (OCR → fields) | OCR stack exists (`attachments` OcrService) but extraction-to-schema + human-review UX is its own spec. Roadmap; noted surface. |

### Resolved Questions (from repo context; recorded for transparency)
- **Portal now?** No — roadmap (above).
- **Map editing?** Preview only (above).
- **Country names i18n?** `Intl.DisplayNames` (above) — no key explosion.
- **Suggestions auto-apply?** Never — user selects rows; server loops the normal undoable create command.
- **`om-implement-spec` phases?** Yes — Implementation Plan below is phased for coordinated implementation.

## User Stories
- **Compliance staff** records supplier plots once (upload the GeoJSON the co-op sent, see them on a map, get told which fail the 4-ha/precision rules) and reuses them on every submission.
- **Compliance lead** runs a documented Art. 10 risk assessment per statement: sees each origin country's benchmark tier, answers the criteria checklist, logs mitigation actions, and records the negligible-risk conclusion — with the annual review date tracked.
- **Compliance staff** cannot mark a DDS "submitted" until evidence is verified/complete and risk is cleared (or Art. 13 simplified DD / SME-trader referencing applies) — the gate lists exactly what's missing.
- **Compliance staff** sees a countdown while an available DDS can still be amended/withdrawn, and the module blocks edits after the 72-hour window.
- **COO** sees a dashboard card: days to 2026-12-30, statements not ready, evidence gaps, risk reviews due.
- **Procurement** sees an EUDR badge on catalog products and one-click-creates mappings from HS-code suggestions.
- **Anyone** asks the AI assistant "which statements aren't ready and why?" and gets a grounded answer via the read-only tool pack.

## Architecture (additions to `packages/core/src/modules/eudr/`)
```
eudr/
├── index.ts                    # + dashboardWidgets entries
├── acl.ts                      # + eudr.plots.view|manage, eudr.risk.view|manage
├── setup.ts                    # + defaults (admin eudr.* already wildcard; employee +view)
├── events.ts                   # + plot / risk_assessment / mitigation_action crud events
├── encryption.ts               # + plots.producer_name, risk notes, mitigation notes
├── ai-tools.ts                 # NEW (aggregates ai-tools/compliance-pack)
├── ai-tools/compliance-pack.ts # NEW 5 read-only tools
├── ai-agents.ts                # NEW eudr.compliance_assistant (read-only)
├── data/
│   ├── entities.ts             # + EudrPlot, EudrRiskAssessment, EudrMitigationAction; + columns
│   ├── validators.ts           # + schemas, enums, transition map, referenced-statement schema
│   └── enrichers.ts            # NEW catalog product enricher (_eudr)
├── lib/
│   ├── completeness.ts         # v2: geolocation-via-plots, documents-via-live-count param
│   ├── geometry.ts             # NEW pure GeoJSON validation + geodesic area
│   ├── reference-data.ts       # NEW country tiers, HS prefixes, supplementary-unit HS list,
│   │                           #     application dates, risk criteria catalog
│   └── statement-lifecycle.ts  # NEW transition map helpers + gate evaluation
├── subscribers/
│   ├── recompute-completeness-on-attachment-created.ts  # NEW projection recompute
│   └── recompute-completeness-on-attachment-deleted.ts  # NEW (metadata.event = single id)
├── commands/                   # + plots.ts, risk-assessments.ts, mitigation-actions.ts;
│                               #   statements.ts update gains transition guard; submissions plots
├── api/
│   ├── plots/route.ts + plots/import/route.ts            # NEW
│   ├── risk-assessments/route.ts                          # NEW
│   ├── mitigation-actions/route.ts                        # NEW
│   ├── product-mappings/suggestions/route.ts (+/apply)    # NEW
│   ├── dashboard/widgets/compliance-overview/route.ts     # NEW
│   └── statements/[id]/export/route.ts                    # v2 additive + format=geojson
├── widgets/
│   ├── dashboard/compliance-overview/widget.client.tsx    # NEW
│   ├── injection/eudr-product-column/                     # NEW injected catalog column
│   └── injection-table.ts                                 # NEW
├── components/                 # + PlotMapPreview.tsx (dynamic leaflet), CountrySelectField,
│                               #   PlotMultiSelectField, OrderSelectField, plot import dialog,
│                               #   lifecycle action bar, risk section components
├── backend/eudr/
│   ├── plots/{page,create/page,[id]/page}.tsx             # NEW
│   └── risk-assessments/{page,create/page,[id]/page}.tsx  # NEW (+ statement detail sections)
├── i18n/{en,de,es,pl}.json     # all new keys ×4
├── migrations/                 # one additive migration + snapshot update
└── __integration__/TC-EUDR-005…009.spec.ts
```
Registration: entities → optimistic-lock + record-locks guard-test maps AND `ce.ts` entries for the 3 new entities; new manage features declare `dependsOn` their view feature in `acl.ts`; `yarn generate` regenerates registries (ai tools/agents, enrichers, widgets, subscribers discovered by convention).

**Additive released-module touches (the only files outside `eudr/` + guard tests):**
- `packages/core/src/modules/attachments/lib/crud.ts` — `buildPayload` adds `entityId`/`recordId` to attachment event payloads (additive event-payload fields, BC-permitted).
- `packages/core/src/modules/catalog/api/products/route.ts` — `enrichers: { entityId: … }` opt-in added to the `makeCrudRoute` options (additive; mirrors customers deals route).
- Custom mutating routes in this batch (`plots/import`, `product-mappings/suggestions/apply`) call the mutation-guard registry (`runMutationGuards` + `bridgeLegacyGuard`, precedent `sales/api/quotes/send/route.ts`) before executing.
- Boy-Scout (touched file): `eudr/api/statements/[id]/export/route.ts` — replace the role-name superadmin fallback with the wildcard-aware feature check per the repo lesson.

## Data Models (common columns as batch 1: id, tenant_id, organization_id, created_at, updated_at, deleted_at)

### EudrPlot (`eudr_plots`)
- `supplier_entity_id` uuid required (customers company FK-id) + `supplier_snapshot` jsonb null `{displayName}`
- `name` text required; `external_id` text null (parcel/farm id); `description` text null
- `origin_country` text required (ISO2 upper)
- `plot_type` text enum `point|polygon` (server-derived from geometry)
- `geometry` jsonb required (normalized GeoJSON Feature, geometry ∈ Point|Polygon|MultiPolygon, ≤256 KB)
- `area_ha` numeric(12,4) — server-computed for polygons; **required manual input for points** (a point with unknown area could silently bypass the 4-ha rule): point without positive area_ha → 400 `eudr.errors.pointAreaRequired`; **point with area_ha > 4 → 400 `eudr.errors.polygonRequired`**
- `validation_warnings` jsonb string[] default [] (server-computed, e.g. `low_precision`)
- `producer_name` text null — **encrypted**
- `is_active` bool default true

### EudrRiskAssessment (`eudr_risk_assessments`)
- `statement_id` uuid required (intra-module FK)
- `country_risks` jsonb default [] `[{country, tier}]` (snapshot at assessment)
- `overall_tier` text enum `low|standard|high|mixed|unknown`
- `criteria` jsonb default {} `{key: {answer: no_concern|concern|not_applicable, note?}}` (keys from the reference catalog)
- `conclusion` text enum `negligible|non_negligible` default `non_negligible`
- `is_simplified` bool default false (Art. 13 path applied)
- `assessed_at` timestamptz default now; `assessed_by_name` text null (auth snapshot); `review_due_at` date null (default assessed_at + 1y)
- `notes` text null — **encrypted**

### EudrMitigationAction (`eudr_mitigation_actions`)
- `risk_assessment_id` uuid required (intra-module FK)
- `action_type` text enum `request_documents|supplier_audit|satellite_verification|certification_check|switch_sourcing|other`
- `title` text required; `description` text null
- `status` text enum `planned|in_progress|completed|cancelled` default `planned`
- `due_date` date null; `completed_at` timestamptz null (auto-set on completed)
- `notes` text null — **encrypted**

### EudrEvidenceSubmission — additive
- `plot_ids` jsonb uuid[] default [] (plots picker; active plots of the selected supplier)

### EudrDueDiligenceStatement — additive
- `activity_type` text null enum `import|export|domestic_production|trade`
- `actor_role` text null enum `operator|non_sme_trader|sme_trader`
- `referenced_statements` jsonb default [] `[{referenceNumber, verificationNumber?}]`
- `supplementary_unit` text null; `supplementary_quantity` numeric(14,3) null (readiness *warns* when linked mapping HS is on the supplementary-unit list and these are empty — never hard-blocks)
- `submitted_at` timestamptz null (auto on draft→submitted); `reference_issued_at` timestamptz null (user-editable; default now on submitted→available)
- `order_snapshot` jsonb null `{orderNumber}`

## Commands & Events
Commands (undoable, batch-1 pattern): `eudr.plots.create|update|delete`, `eudr.risk_assessments.create|update|delete`, `eudr.mitigation_actions.create|update|delete`; `eudr.statements.update` gains transition/amend guards + gate; `eudr.evidence_submissions.*` gain plot validation (plots must exist, be active, belong to org + same supplier) and completeness v2. Plot import route loops `eudr.plots.create` per valid feature (each undoable).
Events: `eudr.plot.created|updated|deleted`, `eudr.risk_assessment.created|updated|deleted`, `eudr.mitigation_action.created|updated|deleted` (category crud, singular, past tense).
Subscriber: `recompute-completeness-on-attachment` (idempotent; only touches `completeness_score`/`missing_fields`; emits `query_index.upsert_one`).

## API Contracts (all `makeCrudRoute` unless noted; org/tenant scoping; `updatedAt` in items; OpenAPI exported)
- `/api/eudr/plots` — `eudr.plots.view|manage`; filters `supplierEntityId,plotType,isActive,originCountry,ids,search`; POST validates geometry server-side (parse → normalize → warnings → area).
- `POST /api/eudr/plots/import` (custom, `eudr.plots.manage`): `{supplierEntityId, defaultCountry?, featureCollection}` (≤1 MB, ≤500 features) → `{created: n, failed: [{index, name?, errorKey}]}` (207-style partial success in a 200 body).
- `/api/eudr/risk-assessments` — `eudr.risk.view|manage`; filters `statementId,conclusion,overallTier,reviewDueBefore,ids`; create computes `country_risks`/`overall_tier`/`is_simplified` server-side from the statement's linked submissions (client-sent values rejected 400 like batch-1 server-computed fields).
- `/api/eudr/mitigation-actions` — `eudr.risk.view|manage`; filters `riskAssessmentId,status,actionType,ids`.
- `/api/eudr/statements` — unchanged URL/fields + new optional fields; POST restricted to `status='draft'`/omitted; `afterList` merges `latestRisk {conclusion, overallTier, reviewDueAt}`; PUT enforces transitions/gate/amend-window/`referenceIssuedAt` immutability (400 with machine-readable `details.reasons[]` of i18n keys: `eudr.gate.submissionsNotReady`, `eudr.gate.riskConclusionMissing`, `eudr.gate.riskAssessmentStale`, `eudr.gate.riskReviewOverdue`, `eudr.gate.mitigationIncomplete`, `eudr.gate.referencedStatementsRequired`).
- `/api/eudr/product-mappings/suggestions` GET (`eudr.mappings.view`) → `{items: [{productId, name, sku, hsCode, suggestedCommodity}]}` (≤200); `POST …/apply` (`eudr.mappings.manage`) `{items:[{productId, commodity, hsCode?}]}` → per-row `{created|failed}`.
- `GET /api/eudr/dashboard/widgets/compliance-overview` (`eudr.statements.view`): `{deadline:{date,daysLeft}, mappingsInScope, submissions:{total,byStatus,avgCompleteness,incomplete}, statements:{total,byStatus,notReady,missingReference}, riskReviewsDueSoon}`.
- `GET /api/eudr/statements/[id]/export` — v2 additive keys `riskAssessment`, `mitigationActions`, `plots`, `lifecycle:{activityType,actorRole,submittedAt,referenceIssuedAt,amendWindowEndsAt,retainUntil}`; `?format=geojson` → FeatureCollection (batch-1 scope pattern: `resolveOrganizationScopeForRequest`, decrypted reads).

## UI/UX (backend, Compliance sidebar group; DS tokens; dialogs Cmd/Ctrl+Enter / Escape; every icon button aria-labeled)
- **Plots**: list (columns supplier, name, country w/ localized name, type badge, area, active, warnings count, updatedAt; filters supplier/type/country/active) + **Import GeoJSON** dialog (file or paste → per-row result table) ; create/edit form (supplier picker → country combobox → geometry upload/paste with live validation panel → `PlotMapPreview` read-only Leaflet, dynamic import, tile env `NEXT_PUBLIC_OM_DEALS_MAP_TILE_URL` fallback OSM like deals map → producer, external id, active).
- **Submissions**: origin-country → searchable localized combobox; **plot multi-select** (active plots of chosen supplier; inline "new plot" link); legacy GeoJSON textarea collapsed under "Advanced"; edit page embeds `AttachmentInput` (entityId `eudr:eudr_evidence_submission`) with the uuid textarea collapsed as advanced/BC; risk-tier badge next to origin country.
- **Statements**: detail gains (1) **lifecycle action bar** — allowed transitions as buttons with confirm dialogs, gate failures listed with i18n reasons, 72h **countdown badge** while amendable, retention line (`retainUntil = submittedAt + 5y`); (2) **risk section** — latest assessment card (tier badges per country, conclusion badge, review-due) + assessments history + "Assess risk" ; (3) **referenced statements editor** (ref + verification pairs, add/remove rows); (4) **order picker** (AsyncSelectField on `/api/sales/orders`, snapshot orderNumber, absent-peer degradation); (5) map preview of all plots across linked submissions.
- **Risk assessment form**: statement picker (prefilled from statement detail), auto-computed country tier chips, criteria checklist grouped in the 4 buckets (radio no_concern/concern/n_a + note), conclusion select, review-due date (popover picker), notes; mitigation actions inline table + add/edit dialog (CrudForm embedded).
- **Dashboard widget**: compliance overview card (deadline countdown, not-ready statements, incomplete submissions, reviews due) — links into module pages.
- **Catalog products list**: injected "EUDR" column (commodity badge / in-scope) fed by the `_eudr` enricher (feature-gated, fail-open).
- **Mappings list**: "Suggestions" button → dialog with suggested products (checkbox rows) → apply → per-row results; empty state when none.
- **AI**: `eudr.compliance_assistant` available via the assistant surface (page-level `<AiChat>` mount on statements list if the platform mount is a one-liner; otherwise agent-only).
All dropdown enum values (commodity, statuses, tiers, conclusions, action types, activity types, actor roles, plot types) rendered via `t('eudr.…')` keys in **all four locales**; country names via the shared `resolveCountryName`/`buildCountryOptions` helpers per active locale (no per-country i18n keys).

## i18n
New key groups (en/de/es/pl, codepoint-sorted, no hardcoded strings): `eudr.plots.*`, `eudr.plotType.*`, `eudr.risk.*` (incl. `eudr.risk.criteria.<key>` labels + group labels), `eudr.riskTier.*`, `eudr.conclusion.*`, `eudr.mitigation.*` (+ `eudr.mitigationStatus.*`, `eudr.mitigationType.*`), `eudr.lifecycle.*` (transitions, countdown, retention), `eudr.activityType.*`, `eudr.actorRole.*`, `eudr.gate.*` (reason keys), `eudr.dashboard.*`, `eudr.suggestions.*`, `eudr.ai.*` (agent/tool display strings), `eudr.errors.*` additions (`polygonRequired`, `invalidTransition`, `amendWindowElapsed`, `referencedDownstream`, `archivedReadOnly`, `mitigationRequired`, `plotNotFound`, `plotSupplierMismatch`, `importTooLarge`, `importInvalidFeature`). Internal-only messages prefixed `[internal]`.

## Migration & Compatibility
- Additive only: 3 new tables, new nullable/defaulted columns on 2 existing tables, new routes/features/events/widgets/tools. No renames/removals. Batch-1 surfaces are unreleased (same branch) — the new PUT-time transition guards tighten semantics with zero external consumers; batch-1 integration tests are updated in-change where they previously set statuses freely (documented, not weakened: they now assert the guard).
- Migration: one module-scoped migration + snapshot via `yarn db:generate`; duplicate-DDL check against batch-1 migration per lessons.
- Guard tests: optimistic-lock + record-locks maps gain the 3 new entities; `ce.ts` gains the 3 entity declarations.
- New ACL features via `defaultRoleFeatures` with `dependsOn` (+ `yarn mercato auth sync-role-acls` and `yarn mercato configs cache structural --all-tenants` documented in PR ops notes).
- Attachment event payload gains `entityId`/`recordId` (additive fields on `attachments.attachment.*` payloads — additions permitted, removals frozen).

## Implementation Plan (phases = dispatch packets; A → B∥C → D → E∥F∥G → H → I)
- **A — Foundation**: reference-data/countries/geometry libs + unit tests; entities + validators (enums, transition map, schemas); encryption/events/acl/setup; guard-test maps; `yarn generate` + `yarn db:generate` migration.
- **B — Commands & subscribers**: plots/risk/mitigation commands; statement update guards + gate (uses `lib/statement-lifecycle.ts`); submission plot validation + completeness v2; the two attachment subscribers + the additive attachments `buildPayload` fields.
- **C — APIs**: plots (+import w/ mutation guards), risk, mitigation routes; statements afterList + PUT wiring; suggestions (+apply w/ mutation guards); dashboard data route; export v2 (+geojson) incl. the Boy-Scout scope fix; catalog products route enricher opt-in. OpenAPI on all.
- **D — Submissions & plots UI**: formConfig additions (CountrySelectField, PlotMultiSelectField, geometry input w/ validation panel), PlotMapPreview (dynamic leaflet), plots pages + import dialog, submission form/edit updates (AttachmentInput embed).
- **E — Statements UI**: lifecycle action bar + countdown + retention, risk section + assessment/mitigation pages & dialogs, referenced-statements editor, OrderSelectField, statement plot-map preview.
- **F — Ecosystem**: dashboard widget (client + registration), catalog enricher + injected column, suggestions dialog on mappings list.
- **G — AI**: ai-tools pack + ai-agents + ACL wiring per `om-create-ai-agent` (§1–7.5), generator run.
- **H — i18n**: consolidate every new key ×4 locales; `yarn i18n:check-sync` + `i18n:check-hardcoded` green.
- **I — Integration tests**: TC-EUDR-005…009 below (batch-1 TC-003 updated for the gate).

## Integration Test Coverage (module-local Playwright; self-contained fixtures; policy-compliant users; cleanup in finally)
- **TC-EUDR-005 plots API**: CRUD round-trip incl. server-derived plotType/areaHa; polygon area computed; point >4 ha → 400 `polygonRequired`; invalid geometry/country → 400; import happy path + partial-failure report; supplier-mismatch plot on submission → 400; feature gates (view vs manage) + 401.
- **TC-EUDR-006 risk & mitigation API**: assessment create computes country_risks/overall_tier/is_simplified server-side (client-sent → 400); conclusion `negligible` with `concern` answers and no completed mitigation → 400 `mitigationRequired`; passes with a completed action; reviewDueAt defaulting; mitigation CRUD + completedAt auto-set; filters.
- **TC-EUDR-007 statement lifecycle**: POST with status ≠ draft → 400 `invalidTransition`; draft→submitted blocked with reasons (not-ready evidence / missing risk); passes after verified+complete submissions + negligible assessment; **stale-assessment recheck** — after a passing assessment, adding a submission with a new origin country makes the gate fail `riskAssessmentStale`; overdue `reviewDueAt` fails `riskReviewOverdue`; simplified path (all-low-risk origins, no assessment needed); sme_trader path (referencedStatements suffice); submitted→available requires reference+verification, stamps `referenceIssuedAt` (backdated value ≤ now accepted **during this transition only**); editing `referenceIssuedAt` while available → 400 `referenceIssuedAtImmutable`; amend of guarded field when issued >72h ago → 400 `amendWindowElapsed`; withdraw within window OK; withdraw blocked when another statement references the number; archived read-only; invalid transition → 400.
- **TC-EUDR-008 ecosystem surfaces**: dashboard widget route shape (counts consistent with fixtures); suggestions GET finds fixture product by HS prefix, apply creates mapping + reports duplicate row as failed; catalog products list response contains `_eudr` namespace for mapped product when feature granted (enricher); export v2 keys + `format=geojson` FeatureCollection with plot features.
- **TC-EUDR-009 UI smoke**: plots list + create page render (map preview container present via `data-crud-field-id`); submission edit shows AttachmentInput block + plot multi-select + country combobox; statement detail shows lifecycle bar + risk section; `domcontentloaded` + explicit readiness assertions (no `networkidle`).
Unit tests: geometry (fixtures: valid/unclosed/out-of-range/low-precision polygon area vs known hectares; point rules), country-tier helper, transition helper + gate evaluation matrix, suggestions matcher, completeness v2 (plots/attachment-count paths), criteria→mitigation rule.

## Risks & Impact Review
### Data integrity
- Plot deletion leaves dangling `plot_ids` on submissions → by FK-id convention: readiness/geometry resolution skips missing/inactive plots and reports the gap (`eudr.gate.plotMissing` warning); no cascade.
- Subscriber recompute is projection-only (two server-computed fields), idempotent, org/tenant-scoped by the attachment payload's record lookup; failure fails-open (score refreshes on next submission write).
- Statement gate reads submissions + latest assessment in the command (single em, forked for after-snapshots per lessons); no cross-entity transaction needed (one entity written).
### Tenant isolation
- All new routes via CRUD factory scoping; custom routes (import, suggestions, dashboard, export) resolve `resolveOrganizationScopeForRequest` and filter both tenant + org (batch-1 export pattern). Enricher and AI tools scope via ctx tenant/org; AI handlers use container-resolved query engine only.
### Cascading
- Catalog enricher: fail-open (`critical: false`, fallback null) — catalog list unaffected by eudr errors; feature-gated so unauthorized tenants see nothing.
- No new cross-module writes anywhere; peers absent → pickers degrade like batch 1.
### Migration/deploy
- Additive DDL only; jsonb defaults `[]`/`{}`; no backfill (null activity/actor on old rows = "unspecified", UI shows em-dash).
### Specific risks
- **Reference-data drift** (benchmarking/Annex-I changes): Medium — single lib file with source+effective-date header; suggestions marked non-authoritative; PR checklist note. Residual: manual update on law change; acceptable.
- **Geodesic area approximation**: Low — spherical excess error ≪ the 4-ha decision margin at plot scale; documented in lib header.
- **72h window vs EU-IS truth**: Medium — our lock is advisory bookkeeping of an external system's state; `referenceIssuedAt` is user-editable, UI copy states EU IS state governs. Residual: user backdates to bypass — their record, their audit trail (changes are audited via commands).
- **Leaflet in a form page**: Low — dynamic import + read-only preview mirrors the shipped deals-map pattern; tile URL env-overridable for production.
- **`Intl.DisplayNames` locale coverage**: Low — supported in Node ≥14 & evergreen browsers; fallback to ISO code string.

## Final Compliance Check (self-review against §31 / AGENTS rules)
- Singular naming (`eudr.plot.created`, features `eudr.plots.view` matching batch-1 plural-resource feature style `eudr.mappings.view` — consistent with the module's shipped convention), FK-ids + snapshots only, org+tenant scoping everywhere, zod validation + `z.infer`, undoable commands, optimistic locking on all 3 new entities (guard maps updated), encryption maps for producer/notes fields, `makeCrudRoute` + OpenAPI on every route, DataTable/CrudForm/Button/IconButton primitives, semantic status tokens, i18n ×4 with `[internal]` rule, enricher `enrichMany` + namespace `_eudr` + feature gate + fail-open, events singular past-tense, subscribers idempotent single-side-effect, no generated-file hand-edits, migrations additive module-scoped.

## Changelog
### 2026-07-06
- Initial batch-2 specification (risk assessment + benchmarking, plot registry + geometry validation + map preview + import, DDS lifecycle with 72h window + reference chaining + gate, order/attachment/country/plot pickers, dashboard widget, catalog enricher + suggestions, AI tool pack + agent, i18n ×4, TC-EUDR-005…009).
- Pre-implement audit corrections (see `.ai/specs/analysis/ANALYSIS-2026-07-06-eudr-batch2-risk-plots-dds-lifecycle.md`): attachments `buildPayload` gains `entityId`/`recordId` (payload lacked them; DELETE hard-deletes) + two single-event subscribers with ephemeral/fail-open semantics; catalog products route must opt into enrichers (`enrichers:` option); dashboard widget auto-discovery via `widgets/dashboard/<key>/widget.ts` (not index.ts entries); reuse shared `location/countries` helpers + `ComboboxInput` (no new countries lib); mutation guards on `plots/import` + `suggestions/apply`; `ce.ts` entries + feature `dependsOn`; Boy-Scout export-route scope check; PR ops notes (sync-role-acls, configs cache structural).
- Spec-stage cross-model jury corrections (codex fail → 5 confirmed blockers; deepseek pass; kimi skipped): statement **create** restricted to draft (POST bypass closed); `referenceIssuedAt` set-once at submitted→available, ≤ now, immutable after (window cannot be reopened); gate-time assessment **freshness** (origin-set match + review-due + mitigation recheck → `riskAssessmentStale`/`riskReviewOverdue`/`mitigationIncomplete`); point plots **require** positive `area_ha` (`pointAreaRequired`); injection spot corrected to `data-table:catalog.products.list:columns` (DataTable resolves by perspective table id).
