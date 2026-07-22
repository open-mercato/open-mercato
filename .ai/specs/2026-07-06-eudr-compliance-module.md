# EUDR Compliance Module — Evidence, Plots, Risk, Due Diligence Statements & Reporting

## TLDR

**Key Points:**
- New core module `eudr` (`packages/core/src/modules/eudr/`) turning Open Mercato into a system of record for EU Deforestation Regulation compliance: map catalog products to regulated commodities, register supplier plots with validated geometry, collect origin evidence, run Art. 10 risk assessments with mitigation tracking, and drive Due Diligence Statements (DDS) through a guarded lifecycle with an exportable evidence packet and an Art. 12(3) annual report.
- Buyer: EU importers/traders of coffee, cocoa, cattle, palm oil, rubber, soy, wood and derived products, facing the 2026-12-30 (large/medium) and 2027-06-30 (micro/small) application dates.
- Scope is the **backend compliance workspace**. Supplier self-service portal and live EU IS (TRACES) filing are explicitly roadmap.

**Delivered scope:**
- 6 entities: product mappings, evidence submissions, DDS statements, plots, risk assessments, mitigation actions.
- Reference data (country benchmarking tiers, Annex-I HS prefixes, supplementary-unit HS list, application dates, Art. 10 criteria catalog) as versioned code, not tenant data.
- Statement lifecycle with transition guards, a submission gate, and the 72-hour amend/withdraw window.
- Compliance cockpit, dashboard widget, catalog/order/supplier injection surfaces, global search, read-only AI tool pack, lifecycle notifications.
- Full platform integration: `makeCrudRoute` APIs + OpenAPI, undoable commands, typed events, ACL features + default role grants, optimistic locking, encryption, i18n ×4, migrations, guard-test registrations, DataTable/CrudForm backend UI, 16 integration specs + unit suites.

**Concerns:**
- Regulatory interpretation risk: the EU IS data model may evolve before the application dates; the evidence model stays additive and export-shaped rather than claiming submission-format fidelity.
- Supplier data quality is the core product risk — completeness scoring is the mitigation, not a legal guarantee (surfaced as readiness, never as legal advice).

## Idea Analysis (why this module, why now)

- **Regulatory trigger is real and dated**: application dates hold at 2026-12-30 and 2027-06-30. The May-2026 simplification package (guidance 5th ed., draft Annex-I delegated act, updated IS implementing act) reduces cost but does not reopen the text. A compliance module must implement the *operating* mechanics: benchmarking tiers, Art. 13 simplified due diligence, the 72h amend/withdraw lock, and reference-number chaining.
- **Broken workflow matches the platform's shape**: importers already run catalog (products with `hs_code`, `country_of_origin_code`), suppliers as CRM companies, orders in sales, files in attachments, and audit trails. Today EUDR evidence lives in spreadsheets and questionnaires disconnected from those records. The gap is *linking evidence to actual products, suppliers, and orders* — precisely Open Mercato's data graph.
- **SMB/mid-market wedge**: enterprise sustainability suites over-serve; spreadsheets under-serve. A compliance workspace embedded in the commerce backoffice is the differentiator.
- **Kill-criteria awareness**: if buyers delegate EUDR wholly to brokers, the module still functions as the evidence archive brokers demand — the retention duty stays with the operator, and the export packet is the hand-off artifact.

> **Market Reference**: Studied the EU Information System for EUDR (DDS fields, GeoJSON geolocation, reference + verification numbers, statuses), the GS1 EUDR questionnaire, and the commercial category (LiveEO TradeAware, osapiens HUB, Meridia Verify, IntegrityNext, Prewave, Coolset, Odoo/SprintIT, TrusTrace, Duveka). **Adopted** — their field vocabulary so the export maps 1:1 mentally, GeoJSON as the interchange format, the reference/verification number pair, plot registry reusable across submissions (Meridia/Koltiva), Art. 10 four-bucket criteria checklist, mitigation actions with status + due date (IntegrityNext "Action Tool"), readiness rollups (TradeAware), DDS references riding sales documents (Odoo/Duveka). **Rejected** — modelling the full EU IS SOAP schema (unstable pre-relaunch), satellite deforestation overlays (needs an imagery vendor), blockchain traceability (wrong weight class for the SMB wedge), per-hectare pricing mechanics (commercial, not product).
>
> **Differentiator**: none of the studied products surface the 72-hour amend/withdraw state machine explicitly — a hard regulatory constraint encoded here as guarded transitions plus a countdown UI.

## Problem Statement

Compliance staff at EU importers must prove, per shipment of in-scope goods, that commodities are deforestation-free and legally produced — backed by plot-level geolocation and supplier documentation, referenced in a DDS filed in the EU IS. Their current tooling leaves evidence disconnected from the products and orders it covers, gives no completeness view until shipment time, and retains DDS references in spreadsheets with no durable link between statement, evidence, product, supplier, and order for the multi-year retention duty.

Beyond recording evidence, the questions that decide whether a DDS may lawfully be filed have no home: which origin countries are low/standard/high risk, whether an Art. 10 assessment was performed and with what conclusion, what mitigation is pending, which plots exactly and whether their geometries satisfy the point/polygon and precision rules, and whether a statement can still be amended or withdrawn. Open Mercato holds the product, supplier, and order records already — but had no EUDR model at all.

## Proposed Solution

A self-contained core module following the `customers` reference architecture: MikroORM entities + zod validators + undoable commands + `makeCrudRoute` APIs + DataTable/CrudForm backend pages, wired into ACL, events, encryption, optimistic locking, i18n, notifications, search, and the query index. Cross-module references are FK-ids + snapshots only — no ORM relations, no hard imports of other modules' business logic.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Module id `eudr` (core package) | The regulation acronym is the domain name (like `auth`); precedent for non-plural ids: `catalog`, `search`, `checkout`. Tables prefixed `eudr_`, features `eudr.*`, routes `/api/eudr/*`. |
| Commodity is a **code enum**, not a dictionary | EUDR Annex I commodities (`cattle, cocoa, coffee, oil_palm, rubber, soya, wood`) are fixed by law; validation and scoring depend on them. Dictionaries are for tenant-customizable lists — this isn't one. |
| Country risk tiers, Annex-I HS prefixes, criteria catalog as **code-level reference data** (`lib/reference-data.ts`) | Fixed by Implementing Regulation like the commodity enum; one maintained file with source + effective-date headers, so a delegated-act change is a one-file PR. Only exceptions are stored (4 high + ~140 low); standard is the default bucket; `unknown` for unrecognized codes is treated as standard-with-warning and never blocks. Law-versioned data as tenant data would invite drift and wrong legal claims. |
| Completeness scoring is a **pure function** run server-side on every submission write | Deterministic, unit-testable, no DI service surface. Persisted (`completeness_score`, `missing_fields`) so lists, filters, and exports don't recompute. |
| **Plot registry** (`eudr_plots`) with `plot_ids` uuid[] on submissions | Farms don't move; competitors model plots first-class and reuse them across deliveries. Junction table deferred until per-link metadata is needed. Legacy `geolocation` jsonb on submissions stays as a direct-GeoJSON fallback; the completeness `geolocation` dimension is satisfied by valid legacy GeoJSON **or** ≥1 active linked plot. |
| Geometry validation is a **pure lib** (`lib/geometry.ts`), no new dependency | Implements GeoJSON parse/normalize, WGS84 bounds, ring closure, decimal-precision warning, geodesic area (spherical excess — error ≪ the 4-ha decision margin at plot scale), and the point-with-area>4ha rule. Leaflet (already a `packages/core` dep) is used for **read-only preview only**; drawing/editing would need `leaflet-draw` and is roadmap. `@turf/*` rejected: a new production dependency for ~60 lines of pure math. |
| Points **require** a positive manual `area_ha` | A point with unknown area could silently bypass the 4-ha polygon rule. Point without positive area → 400 `eudr.errors.pointAreaRequired`; point with area > 4 ha → 400 `eudr.errors.polygonRequired`. |
| **Risk assessment per statement** (not per submission), latest-wins, with a stored country-tier snapshot | The DDS is the legal unit needing a documented negligible-risk conclusion (Art. 4(1)). `country_risks` snapshots tiers at assessment time so assessments stay historically true as law-versioned data changes. Re-assessment creates a new record (audit history for the Art. 12 annual review); `review_due_at` defaults to assessed + 1 year. Per-submission risk would fragment the review trail. |
| **Criteria checklist as jsonb** against a code-level catalog (~14 criteria in 4 groups) | Art. 10(2) criteria are fixed by law → catalog like commodities; answers are tenant data. Conclusion is the assessor's explicit choice, but the server enforces Art. 11: `negligible` with any `concern` answer requires ≥1 **completed** mitigation action, else 400 `eudr.errors.mitigationRequired`. |
| **Statement transitions as a const map enforced in both create and update commands** | Matches repo precedent (inline command validation). Map: `draft→[submitted,archived]`, `submitted→[draft,available,archived]`, `available→[withdrawn,archived]`, `withdrawn→[archived]`, `archived→[]`. **Create accepts only `status='draft'`** — otherwise a direct POST as `submitted`/`available` would bypass every gate. |
| **Submission gate** on draft→submitted, with assessment freshness | `actorRole='sme_trader'` → requires ≥1 `referencedStatements` entry. Otherwise requires export-readiness (every linked submission verified + 100% complete) **and** risk cleared: a **fresh** latest assessment concluding `negligible`, or Art. 13 simplified DD (every linked submission has an origin country and all tiers are `low`, evaluated live). Freshness re-checks at gate time that the assessment's country snapshot covers exactly the current distinct origin countries, that `review_due_at` is not past, and that the concern/mitigation rule still holds. The response enumerates machine-readable reasons. |
| **72-hour window**: `reference_issued_at` is settable **only** during submitted→available, then immutable | Users record when the EU IS actually issued the reference (which may differ from data-entry time), but the field must not be able to *reopen* the window. Any later change → 400 `eudr.errors.referenceIssuedAtImmutable`; a future value → 400. Past the window, edits to amend-guarded fields and the withdraw transition are blocked (`eudr.errors.amendWindowElapsed`); withdrawal is also blocked while another active statement references this one's reference number (`eudr.errors.referencedDownstream`); archived is read-only. EU-IS-side locks are outside this system — UI copy says the window is also subject to EU IS state. |
| `referenced_statements` jsonb `[{referenceNumber, verificationNumber?}]` | Upstream DDS chaining per Annex II — the SME-trader/downstream mechanic. Loose format validation (non-empty, ≤32 alnum, uppercased); official formats are observed but not guaranteed, so never hard-block on pattern. |
| **Species on the product mapping**, warning-level only | Scientific + common name are mandatory DDS content for timber (Art. 9(1)(a)). Species is a product attribute, not a consignment property, so it lives on the mapping and submissions inherit it. Shown only when `commodity === 'wood'` (CrudForm `visibleWhen`), cleared server-side on a commodity flip. The submit gate is **not** extended — species is DDS content, not a lawfulness precondition, and blocking would contradict the no-blockers mandate; the export packet warns and the statement detail shows an advisory chip instead. |
| Evidence documents via the existing `AttachmentInput` + event-driven completeness recompute | `AttachmentInput` requires a saved record, so the create flow redirects to edit with a flash hint. Because uploads bypass submission writes, two subscribers recompute the `documents` dimension from `attachments.attachment.*` events (projection-style update + `query_index.upsert_one`, not a user mutation — no command/audit entry). Attachment events are ephemeral inline emits, so the recompute is best-effort and fail-open; the score self-heals on the next submission write. |
| **All record pickers are server-side typeaheads** (`LookupSelect`) | Client-side selects capped at 100 rows made tenants with more than 100 products/companies/orders unable to select anything beyond the first page. Mirrors the sales customer picker: debounced `fetchItems(query)` → `apiCall` with `search` + `pageSize: 20`, selected record resolved by `?id=` for edit seeding. Snapshot capture (`onSnapshot`) is preserved in every wrapper — silent snapshot loss would regress list columns to fallback labels. |
| **No raw ID renders anywhere** | Where a snapshot name is absent, render localized `eudr.common.recordUnavailable` — never the FK id. Country codes render as localized names via the shared `resolveCountryName`/`buildCountryOptions` helpers with `Intl.DisplayNames`, so there is no per-country key explosion. The risk-assessment `ce.ts` `labelField` is `conclusion`, not `statementId`, for the same reason. |
| **Create-page seeding via query params** (`?orderId=`, `?duplicateFrom=`), not a new API | The risk-assessments create page already prefills from `?statementId=` — a shipped house mechanism. Seeding reads source records through existing routes; nothing new server-side. `duplicateFrom` wins when both are present. Invalid, foreign-org, or missing sources render an empty form with an info flash — never an error page. Duplication copies structural fields only, never status, reference numbers, or linked submissions. |
| Commodity prefill resolves order lines through the real order-lines route | Two-step: order summary, then order lines paged with a 3-page cap; distinct product ids → mappings; exactly one distinct in-scope commodity preselects, otherwise empty. Quantity is **never** auto-filled — order line units are not net mass kg, and a wrong prefilled quantity is worse than an empty field. |
| **Annual report: SQL aggregation, per-block ACL, safe CSV** | All aggregates are computed in SQL (`GROUP BY` over statements/submissions/assessments/actions) — no row materialization regardless of tenant size; every query filters `deleted_at IS NULL`; raw SQL numerics are normalized before zod validation. CSV reuses the shared `serializeExport` from `packages/shared/src/lib/crud/exporters.ts`, which already performs quoting and spreadsheet-formula neutralization — the module writes no escaping of its own (`supplementary_unit` is free text and must never reach a spreadsheet interpretable). Aggregates only, zero PII. |
| **Notifications: idempotent subscribers with org-restricted fan-out** | Lifecycle events are emitted by the commands that already detect the transitions. Each subscriber builds a deterministic `groupKey = <eventId>:<entityId>:<occurredAt>` so at-least-once delivery cannot double-notify one occurrence while later occurrences still notify. Failure split: notifications module absent → no-op with a structured log; service resolved but create throws → rethrow so the persistent bus retries (groupKey makes that safe). |
| Export packet stays **additive JSON** + `?format=geojson` | Read-only, feature-gated. `format=geojson` returns a FeatureCollection of plot geometries and legacy submission geolocations. EU-IS SOAP fidelity remains rejected. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| App-level module or official-modules submodule | EUDR compliance is a platform capability aligned with the shipped catalog-compliance direction; a core module was the explicit ask. |
| Generic `trade_compliance` module hosting EUDR as one regime | Speculative generality; EUDR's evidence model (plots, commodities, DDS) is regime-specific. A future CBAM module can share patterns, not tables. |
| Extending `catalog` with EUDR fields via custom fields/extensions | Evidence submissions and DDS are supplier/shipment-scoped aggregates with their own lifecycle, ACL, and UI — not product attributes. |
| Supplier self-service portal | Doubles the surface (portal RBAC, customer-account↔company scoping, portal uploads) without being required for the operator-facing workflow. Roadmap. |
| DB-stored benchmarking list (admin-editable) | Law-versioned data as tenant data invites drift and wrong legal claims. |
| Server-side `duplicate` command/route | A new mutation surface plus undo semantics for something seeded create does with zero server change. |
| Auto-create a DDS when an order contains in-scope products (full Odoo parity) | Write-side coupling from the sales flow into eudr — over-automation with tenant-visible side effects. Prefill keeps the human in charge. |
| Annual report as a background job with a stored artifact | Aggregation is SQL-side and bounded; on-demand compute avoids storage, staleness, and a worker. |
| Supplier panel reading existing list routes client-side | Three fan-out requests per company page view, no single feature gate, duplicated aggregate logic. |
| Tenant-wide notification fan-out (unmodified `createForFeature`) | Would write notification rows carrying statement titles for users without access to the source organization — cross-org data at rest. |
| Time-based reminder notifications (review due, window expiring) | No cron/repeatable-job primitive in `@open-mercato/queue` today; the cockpit queues already surface both states on read. Roadmap with the scheduling primitive. |
| Server-side jsonb sort for the product column | Query-engine support for `product_snapshot->>'name'` is unproven, and a wrong mapping 400s every header click. Sorting is disabled on that column instead. |
| Live TRACES SOAP submission / AI document extraction | The IS relaunch is still stabilizing; OCR-to-schema plus human-review UX is its own spec. Both roadmap. |

## User Stories

- **Compliance lead** marks which products are EUDR in-scope with commodity, HS code, and (for timber) species names, so procurement knows which purchases need evidence.
- **Compliance staff** records supplier plots once — uploading the GeoJSON the co-op sent, seeing them on a map, being told which fail the 4-ha and precision rules — and reuses them on every submission.
- **Compliance staff** records a supplier's origin evidence and sees exactly what's missing, so gaps are chased before shipment.
- **Compliance lead** runs a documented Art. 10 risk assessment per statement: benchmark tier per origin country, criteria checklist, mitigation actions, negligible-risk conclusion, annual review date tracked.
- **Compliance staff** cannot mark a DDS submitted until evidence is verified and complete and risk is cleared (or simplified DD / SME-trader referencing applies) — the gate lists exactly what's missing.
- **Compliance staff** sees a countdown while an available DDS can still be amended or withdrawn, and the module blocks edits after the window.
- **Sales operator** opens an order, sees its EUDR statements with reference and verification numbers, and clicks through to a statement create form already carrying the order context.
- **Compliance officer** duplicates last month's statement for the next consignment and only updates quantity and evidence links.
- **COO** opens Compliance → Overview and sees what needs attention: incomplete evidence, reviews due, statements in the amend window, plots with warnings, and the enforcement countdown.
- **Compliance lead** downloads the Art. 12 annual report (JSON for the auditor, CSV for the website team), seeing only the blocks their role may see.
- **Account manager** opens a supplier company page and sees that supplier's EUDR posture with links into the filtered lists.
- **Compliance manager** is notified the moment a reference is issued, a risk conclusion comes back non-negligible, or mitigation completes — exactly once per occurrence, only within the right organization.
- **Auditor** exports a single JSON packet per DDS so brokers, auditors, or manual EU IS entry get everything in one artifact.

## Architecture

```
packages/core/src/modules/eudr/
├── index.ts                    # module metadata (id 'eudr', title, i18n ns)
├── acl.ts                      # features: mappings/submissions/statements/plots/risk × view|manage
├── setup.ts                    # defaultRoleFeatures (admin eudr.*, employee *.view)
├── events.ts                   # crud events + 5 lifecycle events
├── ce.ts                       # entity declarations (risk assessment labelField 'conclusion')
├── encryption.ts               # producer_name + notes fields across submissions/plots/risk/mitigation
├── search.ts                   # statements, plots, submissions — never encrypted fields
├── notifications.ts            # 5 NotificationTypeDefinition entries with per-type retention
├── ai-tools.ts / ai-tools/     # read-only compliance tool pack (5 tools) + types
├── ai-agents.ts                # eudr.compliance_assistant (mutationPolicy 'read-only')
├── data/
│   ├── entities.ts             # 6 MikroORM entities
│   ├── validators.ts           # zod schemas, enums, transition map (types via z.infer)
│   └── enrichers.ts            # catalog product enricher (_eudr namespace)
├── lib/
│   ├── completeness.ts         # scoring + harvest cut-off advisory
│   ├── geometry.ts             # GeoJSON validation + geodesic area
│   ├── reference-data.ts       # country tiers, HS prefixes, application dates, criteria catalog
│   ├── statement-lifecycle.ts  # transition map + gate evaluation
│   ├── statement-seeding.ts    # create-page prefill helpers
│   ├── species.ts              # wood species warning derivation
│   ├── annual-report.ts        # report shaping + PreparedExport rows
│   └── notifications.ts        # deliverEudrNotification helper
├── commands/                   # undoable: product-mappings, evidence-submissions, statements,
│                               #   plots, risk-assessments, mitigation-actions, lifecycle-events
├── subscribers/                # 2 completeness recompute + 5 notification subscribers
├── api/
│   ├── openapi.ts
│   ├── product-mappings/route.ts (+ suggestions, suggestions/apply)
│   ├── evidence-submissions/route.ts
│   ├── statements/route.ts (+ [id]/export)
│   ├── plots/route.ts (+ import)
│   ├── risk-assessments/route.ts
│   ├── mitigation-actions/route.ts
│   ├── reports/annual/route.ts
│   ├── suppliers/compliance/route.ts
│   └── dashboard/widgets/compliance-overview/route.ts
├── widgets/
│   ├── dashboard/compliance-overview/
│   ├── injection/{eudr-product-column,order-compliance,supplier-compliance}/
│   └── injection-table.ts
├── components/                 # pickers, geometry input, map preview, lifecycle bar,
│                               #   risk section, mitigation section, import + suggestions dialogs
├── backend/eudr/               # cockpit + mappings/submissions/statements/plots/risk pages
├── i18n/{en,de,es,pl}.json
├── migrations/                 # module-scoped additive migrations + snapshot
└── __integration__/            # TC-EUDR-001…016
```

**Registration surfaces** (all additive): `apps/mercato/src/modules.ts` entry — which MUST land before `yarn generate`, since generation silently skips unregistered modules; the lockstep guard-test pair `optimistic-lock-editable-entities.test.ts` and `record-locks-coverage.test.ts` gaining all six entities; `acl.ts` and `encryption.ts` exporting BOTH named and `default` (the generated runtime imports `.default`); `ce.ts` entries per entity; `dependsOn` from each manage feature to its view feature. `yarn generate` discovers events, subscribers, widgets, enrichers, search, notifications, AI tools, and dashboard widgets by convention.

### Cross-Module Coupling (all soft)

| Peer | Mechanism | Absent-peer behavior |
|------|-----------|----------------------|
| catalog | `product_id` FK-id + `product_snapshot`; response enricher; injected list column | snapshot null, mapping still saves, UI shows `recordUnavailable` |
| customers | `supplier_entity_id` FK-id + `supplier_snapshot`; injected company-detail panel | same degradation; panel renders nothing |
| sales | `order_id` FK-id + `order_snapshot`; injected order-detail panel; order→DDS prefill | picker soft-degrades, seeding yields an empty form |
| attachments | `attachment_ids` uuid[] + `AttachmentInput`; completeness recompute subscribers | ids retained; recompute fails open |
| notifications | `createForFeature` with org-restricted fan-out | service unresolvable → no-op with a structured log |
| audit_logs | automatic — writes go through undoable commands | n/a |

**Released-module touches** (the only files outside `eudr/` plus guard tests), each additive and BC-permitted:
- `attachments/lib/crud.ts` — `buildPayload` adds `entityId`/`recordId` to attachment event payloads. Event-payload *additions* are permitted, and DELETE hard-deletes so the payload must carry the linkage (load-by-id is impossible on `deleted`).
- `catalog/api/products/route.ts` — `enrichers: { entityId }` opt-in, mirroring the customers deals route. Enrichers only run when the target route opts in.
- `notifications/lib/notificationService.ts` — `createForFeature` input gains optional boolean `restrictRecipientsToOrganization`. When true the organization is taken from `ctx.organizationId` — the same value stamped on created rows, so the recipient filter and the row scope can never diverge. Candidates (capped at 200) are filtered through the platform RBAC service; if RBAC cannot run or the ctx org is null while the flag is set, the fan-out is skipped and logged. This is a deliberate fail-closed exception to the module's fail-open default: better no notification than a cross-org one. **The write-side filter is the isolation mechanism** — the notifications read path is not relied upon for org isolation, which is exactly why recipients must be authorized before a row is written.

## Data Models

Common columns on all six entities: `id` uuid PK, `tenant_id`, `organization_id`, `created_at`, `updated_at` (optimistic locking default ON), `deleted_at` (soft delete). Tables snake_case, `eudr_` prefix.

### EudrProductMapping (`eudr_product_mappings`)
`product_id` uuid required + `product_snapshot` jsonb `{name, sku}` · `commodity` enum required · `hs_code` text null · `is_in_scope` bool default true · `species_scientific_name` / `species_common_name` text null (wood only, cleared server-side on commodity flip) · `notes` text null · partial unique `(organization_id, product_id, commodity)` WHERE `deleted_at IS NULL`.

### EudrEvidenceSubmission (`eudr_evidence_submissions`)
`supplier_entity_id` uuid required + `supplier_snapshot` jsonb `{displayName}` · `commodity` enum required · `product_mapping_id` / `statement_id` uuid null (intra-module) · `origin_country` text null (ISO 3166-1 alpha-2, uppercased) · `geolocation` jsonb null (legacy direct GeoJSON, ≤1 MB) · `plot_ids` jsonb uuid[] default `[]` · `quantity_kg` numeric null · `batch_number` text null · `harvest_from` / `harvest_to` date null · `producer_name` text null **encrypted** · `attachment_ids` jsonb uuid[] default `[]` · `status` enum `draft|submitted|verified|rejected` · `completeness_score` int (server-computed) · `missing_fields` jsonb string[] (server-computed) · `notes` text null **encrypted**.

**Completeness dimensions** (equal weight): origin country set · valid geolocation (legacy GeoJSON **or** ≥1 active linked plot) · quantity > 0 · both harvest dates set with `from ≤ to` · producer name set · ≥1 attachment (id list **or** live linked-attachment count). Score = round(met/6×100). A non-blocking `harvest_before_cutoff` advisory is computed in the route's item mapping when the harvest window predates 2020-12-31 — blocking would be wrong, since pre-cut-off lots need review, not rejection.

### EudrDueDiligenceStatement (`eudr_due_diligence_statements`)
`title` text required · `commodity` enum required · `reference_number` / `verification_number` text null · `status` enum `draft|submitted|available|withdrawn|archived` · `quantity_kg` numeric null · `order_id` uuid null + `order_snapshot` jsonb `{orderNumber}` · `activity_type` enum null `import|export|domestic_production|trade` · `actor_role` enum null `operator|non_sme_trader|sme_trader` · `referenced_statements` jsonb default `[]` · `supplementary_unit` text null + `supplementary_quantity` numeric null · `submitted_at` timestamptz null (auto on draft→submitted) · `reference_issued_at` timestamptz null (set once at submitted→available) · `notes` text null. Partial index `(tenant_id, organization_id, submitted_at) WHERE deleted_at IS NULL` supports the annual report.

### EudrPlot (`eudr_plots`)
`supplier_entity_id` uuid required + `supplier_snapshot` jsonb · `name` text required · `external_id` / `description` text null · `origin_country` text required · `plot_type` enum `point|polygon` (server-derived) · `geometry` jsonb required (normalized Feature; Point/Polygon/MultiPolygon, ≤256 KB) · `area_ha` numeric (computed for polygons, required manual input for points) · `validation_warnings` jsonb string[] · `producer_name` text null **encrypted** · `is_active` bool default true.

### EudrRiskAssessment (`eudr_risk_assessments`)
`statement_id` uuid required · `country_risks` jsonb `[{country, tier}]` (snapshot at assessment) · `overall_tier` enum `low|standard|high|mixed|unknown` · `criteria` jsonb `{key: {answer, note?}}` · `conclusion` enum `negligible|non_negligible` · `is_simplified` bool · `assessed_at` timestamptz · `assessed_by_name` text null · `review_due_at` date null · `notes` text null **encrypted**.

### EudrMitigationAction (`eudr_mitigation_actions`)
`risk_assessment_id` uuid required · `action_type` enum `request_documents|supplier_audit|satellite_verification|certification_check|switch_sourcing|other` · `title` text required · `description` text null · `status` enum `planned|in_progress|completed|cancelled` · `due_date` date null · `completed_at` timestamptz null (auto-set on completion) · `notes` text null **encrypted**.

## API Contracts

All CRUD routes use `makeCrudRoute` with `list.entityId`/`indexer.entityType` = `E.eudr.<entity>`, zod-validated bodies, org/tenant scoping via `withScopedPayload`, `updatedAt` in list and detail items, writes delegated to module commands via `actions.*.commandId`, and OpenAPI exported through `api/openapi.ts`. Feature gates per method: `.view` for GET, `.manage` for writes. `pageSize` capped at 100.

**Encrypted-field read path**: list projections exclude `producer_name`/`notes`; detail reads merge decrypted values via `findOneWithDecryption` in an `afterList` hook; the export route reads via `findWithDecryption`. Writes encrypt transparently through the flush subscriber — never `nativeUpdate`.

| Route | Features | Notes |
|-------|----------|-------|
| `/api/eudr/product-mappings` | `eudr.mappings.view\|manage` | filters `commodity, isInScope, productId, ids, search`; duplicate active (product, commodity) → 400 |
| `/api/eudr/product-mappings/suggestions` (+ `/apply`) | `.view` / `.manage` | GET scans catalog for Annex-I HS prefixes without an active mapping (≤200); POST loops the create command per row (each independently undoable), never auto-writes |
| `/api/eudr/evidence-submissions` | `eudr.submissions.view\|manage` | filters `commodity, status, supplierEntityId, statementId, ids, search`; items carry `completenessScore`, `missingFields`, `warnings`; client-sent server-computed fields → 400 |
| `/api/eudr/statements` | `eudr.statements.view\|manage` | `search` on title + reference number; filters `commodity, status, orderId, ids`; POST restricted to draft; PUT enforces transitions, gate, amend window, `referenceIssuedAt` immutability, returning `details.reasons[]` of i18n keys; `afterList` merges `latestRisk` only for callers holding `eudr.risk.view` |
| `/api/eudr/statements/[id]/export` | statements + submissions view | JSON packet (statement, submissions, mappings incl. species, plots, risk, mitigation, lifecycle, readiness with `warnings[]`); `?format=geojson` → FeatureCollection; 404 on unknown/foreign-org id |
| `/api/eudr/plots` | `eudr.plots.view\|manage` | filters `supplierEntityId, plotType, isActive, originCountry, ids, search`; geometry validated server-side |
| `/api/eudr/plots/import` | `eudr.plots.manage` | `{supplierEntityId, defaultCountry?, featureCollection}` (≤1 MB, ≤500 features) → `{created, failed: [{index, name?, errorKey}]}` partial success in a 200 body |
| `/api/eudr/risk-assessments` | `eudr.risk.view\|manage` | filters `statementId, conclusion, overallTier, reviewDueBefore, ids`; country risks / overall tier / simplified computed server-side |
| `/api/eudr/mitigation-actions` | `eudr.risk.view\|manage` | filters `riskAssessmentId, status, actionType, ids` |
| `/api/eudr/reports/annual?year=&format=` | base `eudr.statements.view` | per-block gating: `countries` needs submissions view, `risk`/`mitigation` need risk view; unauthorized blocks omitted server-side; CSV via the shared `serializeExport`; aggregates only, zero PII |
| `/api/eudr/suppliers/compliance?supplierEntityId=` | `eudr.submissions.view` | `plots` block included only with `eudr.plots.view` |
| `/api/eudr/dashboard/widgets/compliance-overview` | `eudr.statements.view` | rollups and queues per-feature gated; absent blocks omitted |

**Annual report semantics** (fixed and testable): statements bucket by `submitted_at` in the calendar year (UTC) with status ∈ submitted/available/withdrawn/archived — drafts never appear, withdrawn and archived remain with their `byStatus` breakdown. `byCommodity[]` carries count, quantity sum, and `supplementaryQuantities` grouped by trimmed case-folded unit (rendered uppercased, empty units omitted, accumulated as integer thousandths so there is no float drift and no cross-unit sums). `countries[]` are distinct origin countries of linked submissions with tier and count. `risk` counts the **latest** assessment per bucketed statement; `simplified` is the count whose latest assessment has `is_simplified`. `mitigation` covers actions on those latest assessments. A year with zero statements returns a valid empty-shaped report, not a 404.

## Commands & Events

Commands (undoable, snapshot-based undo, plural-resource ids): `eudr.product_mappings.*`, `eudr.evidence_submissions.*`, `eudr.statements.*`, `eudr.plots.*`, `eudr.risk_assessments.*`, `eudr.mitigation_actions.*` — each `create|update|delete`. Submission writes recompute completeness inside the command and validate that linked plots exist, are active, and belong to the same org and supplier. Statement writes enforce transitions, the gate, and the amend window. Custom mutating routes (`plots/import`, `suggestions/apply`) run the mutation-guard registry before executing.

CRUD events (category `crud`, singular entity, past tense): `eudr.product_mapping.*`, `eudr.evidence_submission.*`, `eudr.due_diligence_statement.*`, `eudr.plot.*`, `eudr.risk_assessment.*`, `eudr.mitigation_action.*` — each `created|updated|deleted`.

Lifecycle events (category `lifecycle`, emitted post-write on the persistent bus): `eudr.due_diligence_statement.submitted`, `…reference_issued` (the submitted→available transition — "reference issued" is the past-tense domain fact; "available" is a state, not an action), `…withdrawn`, `eudr.risk_assessment.concluded` (on create always, on update when the conclusion changed — the subscriber, not the event, decides whether to notify), `eudr.mitigation_action.completed` (on the auto-`completed_at` transition and on create-as-completed). Payloads carry tenant/org scope plus `occurredAt`, stamped once at emission as the notification idempotency anchor.

Subscribers: two completeness recomputes on attachment created/deleted (subscriber `metadata.event` is a single event id, hence two files), and five notification subscribers — each persistent, one side effect, idempotent via the deterministic groupKey.

## Notifications

Five types with severity and explicit retention: statement submitted (info, 168h), reference issued (success, 720h — the compliance-critical one downstream partners wait for), withdrawn (warning, 168h), risk concluded non-negligible (warning, 168h), mitigation completed (success, 168h). Standard notification-center rendering (no custom renderer); titles and bodies from i18n with variables; `linkHref` to the record detail. Fan-out targets `eudr.statements.manage` holders for statement lifecycle and `eudr.risk.manage` holders for risk and mitigation, restricted to the event's organization.

Recipient predicate semantics: `userHasAllFeatures(candidate, [feature], { tenantId, organizationId })` returns true for users whose ACL grants the feature **in that organization context** — org-restricted roles are denied for other orgs, while tenant-wide unrestricted roles pass for every org. A tenant-wide admin legitimately receives cross-org compliance notifications (they can open the record); users restricted to another org receive nothing.

Known residual (accepted, documented): groupKey coalescing checks active statuses only, so a redelivery arriving after the recipient already read or dismissed the notification re-creates it. The window is the persistent bus's near-term retry horizon, and this is still strictly stronger than the platform baseline, where existing modules' notification subscribers have no occurrence dedupe at all. An undone transition does not retract an already-sent notification — informational only.

## Internationalization

Namespace `eudr.*` in `i18n/{en,de,es,pl}.json` — flat dotted keys, codepoint-sorted. Covers nav and page titles, field labels, every enum (commodity, statuses, tiers, conclusions, action types, activity types, actor roles, plot types), completeness and readiness labels, gate reason keys, cockpit and queue copy, notification titles and bodies, annual report and supplier panel copy, picker placeholders, and error keys. No hardcoded user-facing strings; internal-only throws prefixed `[internal]`. Country names come from the shared resolver per active locale rather than per-country keys.

## UI/UX

Backend pages under `/backend/eudr/*` in the "Compliance" sidebar group, all gated by view features. DS tokens only — no hardcoded status colors, no arbitrary values. Every dialog supports `Cmd/Ctrl+Enter` submit and `Escape` cancel; icon buttons are aria-labeled; **no UUID renders anywhere**.

- **Overview (cockpit)** — first sidebar entry. KpiCards (in-scope products, active plots with warning count, submission completeness, statements by status) plus four action queues: incomplete submissions, risk reviews due, statements in the amend window, plots with warnings. Enforcement-deadline countdown chip. An Annual report card with a year select and JSON/CSV download. Every card renders only when its feature-gated block is present in the response.
- **Product mappings** — list with commodity/scope filters and a Suggestions dialog (checkbox rows → apply → per-row results); form shows species fields only for wood.
- **Evidence submissions** — list with completeness percentage and advisory chips; create redirects to edit so `AttachmentInput` can be used immediately; origin country is a searchable localized combobox with a risk-tier badge; plots are a typeahead-add chip list scoped to the selected supplier.
- **Plots** — list with type badge, area, warnings; Import GeoJSON dialog (file or paste → per-row result table, error severity on total failure); form with live geometry validation and a read-only Leaflet preview (dynamic import, env-overridable tiles).
- **Risk assessments** — form with auto-computed country tier chips, the criteria checklist grouped in four buckets, conclusion, review-due date, and an inline mitigation actions table with an edit dialog.
- **Statements** — detail carries the lifecycle action bar (allowed transitions as confirmed actions, gate failures listed with i18n reasons, 72h countdown badge, retention line), the risk section (latest assessment card, history, "Assess risk"), the referenced-statements editor, the order picker, the species advisory chip, and a plot map preview. List and detail expose a Duplicate action.
- **Injected surfaces** — EUDR column on the catalog products list (enricher-fed, feature-gated, fail-open); EUDR compliance panel on sales order detail (statements with reference/verification numbers and a create link carrying `?orderId=`); supplier readiness panel on both company-detail generations, rendering nothing when totals are zero or the fetch fails.

## Migration & Backward Compatibility

Purely **additive**. Contract surfaces touched, each ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md`:

- **DB schema** — six new tables plus additive nullable/defaulted columns and a supporting partial index, in module-scoped migrations with the module snapshot updated in the same change. No renames, removals, or type changes; `down()` provided. Zero-downtime; no backfill (null species renders as an em-dash).
- **API routes** — all new routes are eudr-local; additions to existing eudr routes are optional params and response fields. Semantics tightened on eudr routes (transition guards, per-block gating) apply to an unreleased surface on the same unmerged branch with zero external consumers; tests were updated in-change to assert the guard rather than weakened.
- **Types/signatures** — `createForFeature` input gains one optional boolean, defaulted off; existing callers are byte-identical.
- **Event IDs / notification type IDs / widget registrations** — all new; existing ids untouched; widgets register on existing, verified spot ids.
- **ACL / DI / CLI / import paths / generated-file contracts** — untouched. No FROZEN surface is modified, so no deprecation path is required.

Deploy: run the migrations and `yarn generate`. New ACL features reach existing tenants via `defaultRoleFeatures` plus `yarn mercato auth sync-role-acls`, followed by `yarn mercato configs cache structural --all-tenants`. Rollback = disable the module entry in `modules.ts`; tables remain for data retention.

## Integration Test Coverage

Module-local Playwright specs under `__integration__/`, self-contained: API-created fixtures, policy-compliant users, cleanup in `finally`, no reliance on seeded or demo data.

| Spec | Covers |
|------|--------|
| TC-EUDR-001 | product-mappings CRUD round-trip, `updatedAt` exposure, invalid commodity, duplicate guard, 401 tokenless, view-only 403 on write, cross-org probes |
| TC-EUDR-002 | evidence submissions + scoring: minimal → score 0 with all six missing fields, full → 100, client-sent computed fields → 400, invalid GeoJSON/country → 400, soft delete |
| TC-EUDR-003 | statements CRUD, submission linkage, export packet shape and readiness math, foreign id → 404, view-only can export but not write |
| TC-EUDR-004 | backend UI smoke across the three original list pages |
| TC-EUDR-005 | plots: server-derived type and area, point >4 ha → 400, invalid geometry/country → 400, import happy path and partial-failure report, supplier mismatch, feature gates |
| TC-EUDR-006 | risk and mitigation: server-computed tiers, negligible-with-concern requires completed mitigation, review-due defaulting, `completedAt` auto-set, filters |
| TC-EUDR-007 | statement lifecycle: non-draft POST rejected, gate reasons, stale-assessment and overdue-review rechecks, simplified and SME-trader paths, reference stamping, immutability, amend-window expiry, downstream-reference block, archived read-only |
| TC-EUDR-008 (+008b) | dashboard widget shape, suggestions find + apply, catalog `_eudr` enrichment, export v2 keys and GeoJSON format, per-block rollup gating for partial-feature callers |
| TC-EUDR-009 | UI smoke for plots, submission edit (attachments, plot multi-select, country combobox), statement detail lifecycle and risk sections |
| TC-EUDR-010 | searchable pickers: server-side `?search=` filtering, selection by name, no UUID on the page |
| TC-EUDR-011 | compliance cockpit KPIs and queue links |
| TC-EUDR-012 | order compliance panel lists the statement with its reference number and links to detail |
| TC-EUDR-013 | order→DDS prefill (order, title, commodity from mapped lines), duplication copy list, param precedence, degradation probes for invalid and unreadable sources |
| TC-EUDR-014 | annual report: year bucketing with a pg-backdated prior-year fixture, drafts excluded, withdrawn included, per-unit supplementary grouping, countries with tiers, latest-assessment risk counts, CSV formula neutralization, per-block gating, 401/403, delete-guard probes |
| TC-EUDR-015 | species round-trip, export packet inclusion, readiness warning variants, server-side clearing on commodity flip, supplier aggregate rollups and block omission, panel on companies-v2 |
| TC-EUDR-016 | every notification lifecycle emission path under bounded polling, plus the org-restricted negative case |

Unit tests cover completeness (including plot and attachment-count paths), geometry, country tiers, transitions and the gate matrix, suggestions matching, seeding helpers, species warnings, the annual-report builder (bucketing, thousandths accumulation, CSV shape), cockpit gating, the notification helper, and the notifications-service org filter.

## Risks & Impact Review

### Data integrity
Submission writes and completeness recompute happen in one command flush. Snapshot resolution failures degrade to null and never abort the write. Concurrent edits are covered by optimistic locking on all six entities via `updated_at` plus the CrudForm auto-header, surfacing a 409 conflict bar instead of a lost update. Dangling FK-ids are by design (FK-id + snapshot convention): readiness skips missing or inactive plots and reports the gap; no cascade. The attachment recompute is projection-only, idempotent, and fails open.

### Tenant & data isolation
Every query and write is scoped by tenant and organization through the CRUD factory and scoped payload helpers. Hand-written routes (export, import, suggestions, dashboard, annual report, supplier aggregate) resolve `resolveOrganizationScopeForRequest` and filter both tenant and org. Enricher and AI tools scope through the request context. Notification fan-out is authorized per candidate before any row is written, and fails closed.

### Cascading failures
The catalog enricher is fail-open and feature-gated, so the catalog list is unaffected by eudr errors. Injected panels render nothing on failure. Notification failures never propagate into commands (post-commit). No module depends on `eudr`; peers are soft-referenced, so disabling catalog, customers, or sales degrades snapshots only.

### Named risks

| Risk | Severity / area | Mitigation | Residual |
|------|-----------------|------------|----------|
| EU IS schema drift before the application dates | Medium — export consumers | Additive schema; export versioned by stable shape; a future integration provider isolates EU IS specifics | Manual re-mapping effort; acceptable pre-enforcement |
| Reference-data drift (benchmarking, Annex-I) | Medium — legal accuracy | One lib file with source and effective-date headers; suggestions marked non-authoritative | Manual update on law change |
| Completeness read as legal compliance | Medium — user trust | Copy says "evidence completeness"; readiness wording avoids legal claims; dimensions documented | User misinterpretation |
| Unencrypted plot geolocation | Low/Medium — GDPR posture | Producer names and notes encrypted; geolocation stays plaintext because area and map validation need it | Plaintext coordinates at rest; accepted consciously |
| 72h window vs EU IS truth | Medium — bookkeeping accuracy | Our lock is advisory over an external system's state; UI copy says EU IS state governs; every change is command-audited | A user can backdate within their own audit trail |
| Species advisory does not block export | Low — DDS completeness | Chip on statement detail plus export readiness warning; TRACES would reject a species-less timber DDS anyway | A wood DDS without species is still exportable; deliberate |
| Geodesic area approximation | Low — plot classification | Spherical-excess error is far below the 4-ha decision margin; documented in the lib header | Negligible at plot scale |
| Notification redelivery after read/dismiss | Low — noise | Deterministic groupKey coalesces active duplicates | A post-read redelivery can re-create one notification |

### Operational
Geolocation and geometry payloads are bounded by zod; plot import is capped at 500 features and 1 MB (synchronous and bounded — a progress-framework migration is roadmap). Annual-report aggregation is SQL-side with a supporting index. Notification fan-out is capped at 200 candidates; beyond that it is skipped and logged, since a tenant with more than 200 holders of a manage feature needs a digest design, not 200 rows per transition. Blast radius is module-local.

## Roadmap (separate specs)

Supplier self-service portal · EU IS (TRACES) SOAP filing and status sync via an integrations provider package · satellite deforestation screening · time-based reminder notifications once a scheduling primitive exists · volume reconciliation and lot/serial binding · leaflet-draw polygon editing · AI document extraction (OCR → fields with human review) · a `FilterBar` async-typeahead primitive so DataTable list-filter supplier dropdowns stop capping at the first 100 companies (every **form** picker is already a server-searchable typeahead).

## Final Compliance Check

FK-ids plus snapshots only, no cross-module ORM relations · tenant and organization scoping on every read and write, org-restricted notification fan-out · zod validators with `z.infer`, no `any` · undoable commands for every mutation, mutation guards on custom mutating routes · optimistic locking on all six entities with both guard maps updated · encryption maps for producer and notes fields, `findWithDecryption` reads, never `nativeUpdate` on encrypted fields, nothing encrypted indexed or exported to the annual report · `makeCrudRoute` plus OpenAPI on every route · declarative `requireAuth`/`requireFeatures` guards, never `requireRoles` · `apiCall` only, no raw `fetch`; CrudForm or `useGuardedMutation` for every write · DS tokens only, no raw colors or arbitrary values, dialogs bound to Cmd/Ctrl+Enter and Escape, `pageSize` ≤ 100 · i18n ×4 with no hardcoded strings and the `[internal]` prefix rule · events singular and past-tense, `as const`, generator-discovered · subscribers persistent with one side effect each, idempotent, fail-open on absent services and fail-closed on org-filter uncertainty · structured logging facade, no raw `console.*` in new code · additive module-scoped migrations, no generated files hand-edited · three additive released-module touches, each documented above.

## Implementation Status

Implemented on `feat/eudr-compliance-module` across four delivery batches (see Changelog). Full validation gate green (`build:packages`, `generate`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `test`, `build:app`). Unit suites green across eudr and the touched notifications module. Integration specs TC-EUDR-001…016 pass against fresh ephemeral environments.

## Changelog

### 2026-07-22 — Batch 4: ERP-native flows, annual report, supplier panel, notifications
Order→DDS prefill (`?orderId=`) and statement duplication (`?duplicateFrom=`) with a fixed copy list and degradation probes; wood species fields on mappings with warning-level enforcement and server-side clearing on commodity flip; Art. 12(3) annual report with SQL aggregation, per-block ACL, and CSV via the shared serializer; supplier readiness panel dual-registered on both company-detail generations; five lifecycle events with idempotent notification subscribers and the additive org-restricted `createForFeature` filter; cockpit rollups gated per feature (closing a cross-feature aggregate leak); `ce.ts` risk-assessment `labelField` moved off a raw UUID; OpenAPI drift fixes. Hardened through implementation-council rounds: statements-list `latestRisk` gated behind `eudr.risk.view`, export scope and ACL union tightened, delete-vs-withdraw guard parity, chunked fail-closed recipient RBAC checks, deterministic gate ordering, mutation-guard registry collection with `modifiedPayload` merge-back, single-wave create-page seeding (fixing a CrudForm late-`initialValues` race that intermittently dropped the seeded commodity).

### 2026-07-11 — Batch 3: UX, compliance cockpit, cross-module integrations
`LookupSelect` server-side typeaheads replacing the 100-row-capped client selects across all six pickers (preserving snapshot capture); raw-ID eradication with localized `recordUnavailable` fallbacks and localized country names; product column sorting disabled rather than risking an unresolvable jsonb sort mapping; compliance cockpit at `/backend/eudr` with feature-gated queues; DDS reference propagation onto sales order detail via injection; global search over statements, plots, and submissions excluding encrypted fields; non-blocking harvest cut-off advisory; create-then-attach flow replacing raw attachment UUID textareas.

### 2026-07-06 — Batch 2: risk, plots, DDS lifecycle, ecosystem
Country benchmarking tiers and Art. 13 simplified due diligence; Art. 10 risk assessments with the criteria catalog, conclusion rule, and annual review tracking; Art. 11 mitigation actions; first-class plot registry with pure-lib geometry validation, GeoJSON import with per-row reporting, and read-only Leaflet preview; DDS lifecycle with guarded transitions, the submission gate with assessment freshness, the 72-hour amend/withdraw window, and upstream reference chaining; dashboard widget; catalog enricher plus injected column; HS-code scope suggestions; read-only AI tool pack and agent; attachment-driven completeness recompute. Spec-stage jury closed five blockers: create restricted to draft, `referenceIssuedAt` set-once and immutable, gate-time assessment freshness, points requiring a positive area, and the corrected catalog injection spot id.

### 2026-07-06 — Batch 1: foundation
Product mappings, evidence submissions with server-computed completeness, the DDS registry, and the JSON export packet with readiness math — plus the full platform wiring (commands, events, ACL, encryption, optimistic locking, i18n ×4, migrations, guard-test registrations, backend UI). Pre-implement audit and review-gate fixes: plural-resource command ids, exact generated entity-id slugs, `record-locks-coverage` registration, the encrypted-field read path for detail and export, organization scope resolved via `resolveOrganizationScopeForRequest` rather than the token org, exhaustive `sortFieldMap` for header sorting, tenant filtering on the duplicate guard, and detail pages reading the route id from the `params` prop.
