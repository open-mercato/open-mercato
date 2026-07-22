# EUDR Compliance Batch 3 — World-Class UX, Compliance Cockpit & Cross-Module Integrations

## TLDR

Batch 3 closes the gap between the EUDR module (batches 1–2: mappings, plots, evidence, risk, DDS lifecycle) and the commercial EUDR platform category (LiveEO TradeAware, Coolset, Odoo/SprintIT, TrusTrace, Duveka, osapiens), with a hard UX mandate: **no raw IDs/GUIDs anywhere, every record picked by name via server-side searchable typeaheads, no encrypted data visible, no blockers**. Five slices:

1. **Searchable pickers** — replace the eudr `AsyncSelectField` plain-Select wrappers (client-side, 100-row cap) with `LookupSelect`-based server typeaheads for products, suppliers, mappings, statements, orders, and plots. Only eudr routes change: statements `search` (title-only today) extends to reference_number and gains `orderId`; product-mappings gains `productId` for name-based 2-step resolution. Plots and sales orders `search` already exist — **this batch touches no module outside eudr**.
2. **Raw-ID eradication** — localized name fallbacks instead of UUID fallbacks in 4 list columns; localized country names in the submissions list; fix product-column sort (UUID order today); remove the raw `attachmentIds` textarea (create → save → attach via `AttachmentInput` flow with a flash hint).
3. **Compliance cockpit** — a `/backend/eudr` overview landing page (KpiCards + action queues: incomplete submissions, reviews due, statements in amend window, plots with warnings, enforcement deadline countdown) reusing an extended compliance-overview API.
4. **DDS reference propagation** — an injection widget on the sales order detail page (`sales.document.detail.order:details`) listing linked EUDR statements with reference + verification numbers (the Odoo/Duveka "refs ride the sales documents" table-stake).
5. **Global search + cut-off advisory** — `search.ts` indexing statements/plots/submissions (never encrypted fields), and a non-blocking `harvest_before_cutoff` advisory when the harvest window predates 2020-12-31.

Out of scope (roadmap): TRACES SOAP API submission/polling, supplier self-service portal, satellite deforestation screening, notification reminders, volume reconciliation, multi-entity TRACES setups.

## Batch Analysis (why these features, why now)

Competitive research (2026-07-11; LiveEO, Coolset, Odoo/SprintIT, TrusTrace, Duveka, osapiens) shows the category table-stakes we still miss are: a compliance dashboard with per-record status rollups, reference-number propagation onto sales documents, and friction-free record pickers. The category P0s we already have (plot registry with GeoJSON/4-ha validation, Annex II DDS fields, ref+verification pair, lifecycle gates, country benchmarking, risk + mitigation, 5-year retention posture) were shipped in batches 1–2. The remaining P0-class items (TRACES API, supplier portal, satellite screening) are external-service integrations too large for this batch and are explicitly deferred. Batch 3 therefore targets: (a) every UX defect that contradicts the product mandate (raw IDs, unsearchable pickers, ISO codes), (b) the two highest-value in-platform table-stakes (cockpit, ref propagation), and (c) cheap regulatory polish (cut-off advisory, global search reachability).

## Problem Statement

Tenants with more than 100 products/companies/orders cannot select records beyond the first page in any eudr form; pickers do not search server-side. UUIDs leak into four list columns as fallbacks and the evidence create form asks users to paste raw attachment UUIDs. There is no single compliance surface answering "what needs my attention"; DDS reference numbers are invisible from the sales order they belong to; eudr records are unreachable from global search.

## Proposed Solution

### Design Decisions

1. **`LookupSelect` for all single-record pickers** (`@open-mercato/ui/backend/inputs`), mirroring `sales/components/documents/SalesDocumentForm.tsx` customer picker: debounced `fetchItems(query)` → `apiCall` with `search` + `pageSize: 20`; selected record resolved by `?id=` for edit seeding (existing pattern kept). Product items show `name` + SKU subtitle; company items show display name; statement items show title + reference-number subtitle; order items show order number.
2. **Plot multi-select becomes typeahead-add + chip list**: a `LookupSelect` (search by plot name/external id, filtered to the selected supplier when set) that appends to a removable chip list. No raw plot IDs shown; chips show plot names.
3. **Additive filters, eudr-only**: `eudr/statements` — extend the existing title-only `search` `$or` with `reference_number`, add optional `orderId` (exact match on the existing `order_id` column shipped in batch 2 — no migration); `eudr/product-mappings` — add optional `productId` filter. `eudr/plots` (`search` on name/external_id) and `sales/orders` (`search`, documents factory) already exist — no changes there, and **no module outside eudr is modified**.
3a. **Mapping picker finds by product name via 2-step resolution**: mappings `search` matches commodity/hs_code/notes but not the product snapshot name; the mapping picker wrapper first queries `/api/catalog/products?search=<q>&pageSize=20`, then `/api/eudr/product-mappings?productId=<ids>` and titles items by snapshot name (SKU + commodity subtitle). Direct `search` passthrough stays for HS-code queries.
4. **Name fallbacks, never UUIDs**: where a snapshot name is absent, render localized `eudr.common.recordUnavailable` ("Record unavailable") — never the FK id. Sites: product-mappings product column, evidence-submissions supplier column, statement-detail linked-submissions supplier, plots supplier column.
5. **Product column sorting**: `sortFieldMap` cannot address jsonb snapshot paths through the query engine reliably → the product column becomes `enableSorting: false` (lesson 2026-07-06: every sortable accessorKey must resolve through sortFieldMap; a non-sortable column is the compliant minimal fix).
6. **Attachments on create**: `AttachmentInput` requires a saved record (`attachments.library.upload.saveFirst`). The create form drops the raw `attachmentIds` textarea (inline in `create/page.tsx:102–112` — there is no separate EvidenceAdvancedFields component); the create flow changes from redirect-to-list to **redirect-to-edit** (capture the `createCrud` result `{ id }`) with a flash hint so documents can be attached immediately; the completeness `documents` dimension already tolerates zero attachments at create. The legacy textarea inline in the edit page (`[id]/page.tsx:156–166`) is removed from the UI; the API field `attachmentIds` stays accepted (BC for API clients).
7. **Cockpit page reuses the dashboards widget API route**, extended: `/api/eudr/dashboard/widgets/compliance-overview` gains a `queues` object alongside existing rollups; org scoping stays `resolveOrganizationScopeForRequest`; the route's zod `responseSchema` is extended. **Queue definitions (exact criteria) and per-queue feature gating** — each queue is computed AND returned only when the caller holds that queue's view feature (checked server-side; UI hides absent cards):
   - `incompleteSubmissions` (requires `eudr.submissions.view`): submissions with non-terminal status and `completeness_score < 100`, ordered `completeness_score` asc, top 5; item = { id, supplier snapshot name (fallback label), completeness %, URL }.
   - `reviewsDue` (requires `eudr.risk.view`): risk assessments with `review_due_at <= now + 30 days` (overdue included), ordered `review_due_at` asc, top 5; item = { id, statement title, due date, URL }.
   - `amendWindow` (requires `eudr.statements.view`): statements currently inside the amend/withdraw window as decided by the existing `lib/statement-lifecycle.ts` helper (72h from `reference_issued_at`, per the batch-2 lifecycle design), ordered by window expiry asc, top 5; item = { id, title, window-expires-at, URL }.
   - `plotsWithWarnings` (requires `eudr.plots.view`): active plots with non-empty `validation_warnings`, top 5; item = { id, name, warning codes, URL }.
   Base route ACL stays the widget's existing gate; a caller lacking a queue's feature receives the payload without that key (no cross-feature leakage — spec-jury blocker resolved).
8. **Sales order panel is an injection widget** (`kind: 'group'`, column 2), mirroring `workflows/widgets/injection/order-approval`: registered under the existing spot `sales.document.detail.order:details`, gated `features: ['eudr.statements.view']`, fetching `/api/eudr/statements?orderId=<id>` (new additive `orderId` filter). Sales module is not modified for this slice — the spot already exists.
9. **Global search never indexes encrypted fields** (`producer_name`, `notes`): statements index title/reference_number/commodity; plots index name/external_id/origin_country; submissions index batch_number/commodity/supplier snapshot displayName. `aclFeatures` per entity mirror the route ACLs.
10. **Cut-off advisory is non-blocking**: `computeCompleteness` gains no new dimension; instead evidence create/update commands compute `harvest_before_cutoff` into a new advisory `warnings: string[]` surfaced next to completeness in UI (detail + list tooltip). Blocking would be wrong — pre-cut-off harvest lots need review, not rejection.

### Alternatives Considered

- **CrudForm `type:'combobox'` with `loadOptions(query)`** instead of LookupSelect: viable, but eudr forms already render custom field components and LookupSelect gives richer items (subtitle/badge) and is the pattern sales uses for the identical job; chosen LookupSelect.
- **Server-side jsonb sort for product column** (`product_snapshot->>'name'`): query-engine support is unproven; a wrong mapping 400s every header click (lesson). Disabled sorting instead.
- **New dedicated cockpit API route**: rejected — extending the widget route avoids a second org-scope/ACL surface for the same aggregates.
- **Modifying sales order detail page directly** for the DDS panel: rejected — UMES injection via the existing spot keeps modules decoupled (AGENTS: cross-module coupling via widget injection).
- **Deferred/pending uploads on create**: would require reworking the attachments module contract; out of scope, redirect-then-attach is the house pattern.

### Resolved Questions (from repo context + readiness audit + spec-stage cross-model jury; recorded for transparency)

- `sales/orders` list already supports `search` (sales documents factory) and `eudr/plots` already supports `search` — the spec's earlier plan to add them was stale; dropped. **No module outside eudr is modified in this batch.**
- `eudr/statements` search is title-only today → extend `$or` with `reference_number`; `orderId` filter maps to the existing `order_id` column (batch 2) — **no migration** (deepseek jury blocker resolved).
- Injection spot `sales.document.detail.order:details` verified to exist and render (`sales/backend/sales/documents/[id]/page.tsx:1944`, rendered ~:4891); workflows module registers the same literal spot with `kind:'group', column:2` — proven registration path (deepseek jury blocker resolved).
- LookupSelect edit seeding: the wrapper refetches the stored id via `?id=` and passes the resolved item as the selected display item — the exact pattern `SalesDocumentForm` uses; missing record → `eudr.common.recordUnavailable` label (deepseek jury note resolved).
- Snapshot capture (`onSnapshot` plumbing in current pickers) MUST be preserved in the LookupSelect wrappers — silent snapshot loss would regress list columns to fallback labels (audit gotcha).
- `harvest_before_cutoff` is computed in the evidence route's item mapping (`transformItem`/afterList), NOT in commands — single computation site, no write-path change (audit gotcha).
- `eudr/product-mappings` supports `search` (commodity/hs_code/notes — not product name, hence Design Decision 3a); products/companies routes support `search` natively.
- Enforcement deadline countdown (already in the widget) keeps the post-amendment dates (2026-12-30 / 2027-06-30) from `lib/reference-data.ts`.

## User Stories

- As a compliance officer, I type three letters of a product name and pick it from live catalog matches — never paging, never seeing a UUID.
- As a compliance officer, I open Compliance → Overview and see what needs attention today: incomplete evidence, risk reviews due, statements sitting in the 72h amend window, plots with warnings, and the enforcement countdown.
- As a sales operator, I open an order and see its EUDR statements with reference + verification numbers, ready to quote downstream.
- As any backoffice user, I find a DDS by its reference number from global search.
- As a compliance officer, I see an advisory when a submission's harvest window predates 31 Dec 2020 so I can review the lot's special status.

## Architecture (changes under `packages/core/src/modules/eudr/` unless noted)

- `components/formConfig.tsx` — `AsyncSelectField` replaced by `LookupSelectField` (wraps `LookupSelect`; props: `endpoint`, `mapItem`, `resolveById`, `extraParams`); wrappers `ProductSelectField`, `CompanySelectField`, `MappingSelectField`, `StatementSelectField`, `OrderSelectField` rewired; `PlotMultiSelectField` → typeahead-add + chips.
- `api/statements/route.ts` — extend `search` `$or` with `reference_number`; additive `orderId` filter.
- `api/product-mappings/route.ts` — additive `productId` filter (uuid or comma list) for picker name resolution.
- `api/dashboard/widgets/compliance-overview/route.ts` — extended payload: `queues: { incompleteSubmissions[], reviewsDue[], amendWindow[], plotsWithWarnings[] }` (id, name/title, metric, per-item URL path).
- `backend/eudr/page.tsx` (NEW) — Compliance → Overview cockpit; `KpiCard` row + four queue cards; `LoadingMessage`/`ErrorMessage`/`EmptyState`.
- `widgets/injection-table.ts` — add `'sales.document.detail.order:details' → eudr.injection.order-compliance` (group, column 2, priority 210).
- `widgets/injection/order-compliance/widget.ts` + `widget.client.tsx` (NEW) — statements list for the order (title, status badge, reference + verification numbers, link), `features: ['eudr.statements.view']`.
- `search.ts` (NEW) — SearchModuleConfig for `eudr:eudr_due_diligence_statement`, `eudr:eudr_plot`, `eudr:eudr_evidence_submission`; presenters + `/backend/eudr/...` URLs; no encrypted fields.
- `lib/completeness.ts` — export `HARVEST_CUTOFF_DATE`, `computeHarvestCutoffWarning(harvestFrom, harvestTo): 'harvest_before_cutoff' | null`; computed in the evidence route's item mapping only (no command/write-path change, nothing stored).
- Backend pages touched for fallbacks/labels: `product-mappings/page.tsx`, `evidence-submissions/page.tsx` (+ detail `[id]/page.tsx:156–166` legacy textarea removal), `plots/page.tsx`, `statements/[id]` linked-submissions table, `evidence-submissions/create/page.tsx:102–112` (textarea removal + redirect-to-edit).
- i18n: `i18n/en.json`, `de.json`, `es.json`, `pl.json` — new keys (`eudr.common.recordUnavailable`, `eudr.overview.*`, `eudr.orderPanel.*`, `eudr.warnings.harvestBeforeCutoff`, picker placeholders); codepoint-sorted flat files.

No new entities, no migrations, no DI changes, no new ACL features (existing view/manage features cover all new surfaces).

## Data Models

No schema changes. `harvest_before_cutoff` is computed server-side per response; `validation_warnings` (plots) unchanged.

## Commands & Events

No new commands; no new events. Existing evidence-submission commands gain the computed advisory in their output mapping only.

## API Contracts (all additive, all eudr)

- `GET /api/eudr/statements?search=&orderId=` — `search` ilike on `title` (existing) extended with `reference_number`; `orderId` exact uuid match on existing `order_id`. ACL `eudr.statements.view`.
- `GET /api/eudr/product-mappings?productId=` — additive filter (single uuid or comma list). ACL `eudr.mappings.view`.
- `GET /api/eudr/dashboard/widgets/compliance-overview` — response gains feature-gated `queues` object (see Design Decision 7); zod responseSchema extended. Base ACL unchanged.
- `GET /api/eudr/evidence-submissions` — items gain computed `warnings: string[]`. ACL unchanged.
- OpenAPI: extend existing route specs for the new params/fields.

## UI/UX (backend, Compliance sidebar; DS tokens; dialogs Cmd/Ctrl+Enter / Escape; icon buttons aria-labeled)

- Pickers: `LookupSelect` with `minQuery` 0–2 (0 → initial page loads so small tenants see options immediately), debounce 300–400ms, subtitle lines (SKU / email / ref number / order number), loading + empty states from the component; seeded label on edit via `?id=` fetch.
- Overview page: first entry in the Compliance sidebar group ("Overview"); KpiCards (in-scope products, active plots (+warnings count), submissions complete %, statements by status), queue cards each linking to the filtered list page; countdown chip for enforcement dates; every metric card links to its list.
- Order panel: compact group card "EUDR compliance"; statement rows → title, `StatusBadge`, ref/verification numbers with copy affordance, link to statement detail; empty state = one-line "No statements linked" with link to create (feature-gated).
- Warnings: amber advisory chip (status token, not raw color) on evidence detail + list tooltip.
- No UUID may render anywhere; fallback label `eudr.common.recordUnavailable`.

## i18n

All four locales (en/de/es/pl), flat dotted keys, codepoint-sorted; no hardcoded user-facing strings; `[internal]` prefix for internal throws.

## Migration & Compatibility

- No DB migrations. All API changes additive (new optional query params, new response fields), confined to eudr routes. UI-only removals: raw `attachmentIds` textareas (API field still accepted → API BC preserved); `AsyncSelectField` was module-internal (verified not exported outside eudr) → safe to replace.
- Contract surfaces touched: eudr list routes (additive params), dashboard widget response (additive feature-gated field), injection table (additive registration on an existing, verified spot id), auto-discovery additions (`search.ts`, backend page, widget) — all ADDITIVE-ONLY compliant. No FROZEN surface touched. No module outside eudr modified.

## Implementation Plan (phases = dispatch packets; A → B∥C∥D → E → F)

- **A. Picker infrastructure** — `LookupSelectField` + rewire 6 pickers (preserving snapshot capture); statements route `search`+`orderId`; mappings route `productId`; unit tests for new filters.
- **B. Raw-ID eradication & polish** — fallback labels (4 sites), localized country names in submissions list, product column `enableSorting:false`, create redirect-to-edit + textarea removals (create + edit), cut-off advisory (`lib/completeness.ts` + route item mapping + UI chip) with unit tests.
- **C. Compliance cockpit** — extend widget route (+ queues), new `backend/eudr/page.tsx`, sidebar entry.
- **D. Order compliance panel** — injection widget + table registration.
- **E. Global search** — `search.ts` + verify reindex CLI picks entities up.
- **F. i18n (4 locales), `yarn generate`, integration tests, gate.**

## Integration Test Coverage (module-local Playwright; self-contained fixtures; policy-compliant users; cleanup in finally)

- **TC-EUDR-010 — searchable pickers**: create product via API; open mapping create; type product-name fragment in picker; assert filtered server results (network `?search=`); select by name; save; assert list shows name (no UUID anywhere on page).
- **TC-EUDR-011 — compliance cockpit**: seed mapping/plot/submission/statement via API; open `/backend/eudr`; assert KpiCards render numbers and a queue card links to the filtered list.
- **TC-EUDR-012 — order compliance panel**: create order (API) + statement linked to it; open sales order detail; assert EUDR panel lists the statement with reference number; link navigates to statement detail.
- **API-level assertions inside the above**: `GET /api/eudr/statements?search=<ref>` returns the statement; `?orderId=` filters; `GET /api/eudr/product-mappings?productId=` filters; evidence response carries `warnings: ['harvest_before_cutoff']` for a pre-2021 harvest window; compliance-overview omits queues for a user lacking the queue's feature.
- Unit tests: statements search/orderId + mappings productId filters, `computeHarvestCutoffWarning`, cockpit queue builder + feature gating.

## Risks & Impact Review

### Data integrity
No writes changed except computed response fields; no migrations.

### Tenant isolation
New filters flow through `makeCrudRoute` org scoping; the extended widget route already resolves `resolveOrganizationScopeForRequest` (lesson-compliant); injection widget fetches via the statements route (scoped). Search indexing is tenant-scoped by the search framework.

### Cascading
No module outside eudr changes. Injection widget renders only when eudr module enabled + feature granted; absent → spot renders nothing (soft-optional).

### Migration/deploy
None. `yarn generate` required (new search.ts, widgets, page auto-discovery).

### Specific risks
- LookupSelect edit-seeding: must resolve the stored id → label on mount (fetch by `?id=`); missing record → show `recordUnavailable`, never the id.
- Search route params must go through `sortFieldMap`-safe schemas (plain `z.string().optional()`); no enum sortField regressions (lesson).
- Plot chips list must cap displayed chips gracefully (many plots per submission).
- New ilike inputs (statements reference_number) sanitized like the existing title search.
- Queue feature-gating must be enforced server-side (omit key), not only hidden client-side.

## Final Compliance Check (self-review against §31 / AGENTS rules)

- No cross-module ORM relations (FK-id + snapshot kept). ✓
- Tenant/org scoping everywhere (makeCrudRoute + resolveOrganizationScopeForRequest). ✓
- zod validators in data/validators or route schemas; types via z.infer. ✓
- apiCall only (no raw fetch); CrudForm/useGuardedMutation for writes (no new raw writes). ✓
- i18n: no hardcoded strings, 4 locales, sorted. ✓
- DS tokens only; no arbitrary values; status colors via tokens. ✓
- Optimistic locking untouched (updatedAt already returned; CrudForm auto-headers). ✓
- Encrypted fields never indexed or rendered raw. ✓
- Additive-only contract changes; BACKWARD_COMPATIBILITY.md respected. ✓

## Implementation Status
- All phases (A–F) implemented 2026-07-11. Full gate green (build:packages ×2, generate, i18n:check-sync, typecheck, test, build:app). eudr unit suite 55/55; integration suite TC-EUDR-001…012 all pass against a live preview (three re-runs traced to environment: stale core dist, stale RBAC cache after sync-role-acls, and TC-EUDR-009 asserting the intentionally-removed legacy textarea — test updated to assert the new behavior). Fresh-context review PASS after one fix loop (three spec-mandated test assertions added, risk-assessments statement-title enrichment, sort hygiene). Cross-model jury: deepseek ran (all blockers reconciled spurious), codex/kimi skipped (CLI auth unavailable non-interactively). Manual preview verified every flow (cockpit, pickers, evidence create→edit attach flow, plots, risk, statements, order panel via TC-012, global search reindex + query, sidebar).

## Changelog
### 2026-07-11
- Spec created (batch 3): searchable pickers, raw-ID eradication, compliance cockpit, order DDS panel, global search, harvest cut-off advisory.
- Revised after readiness audit + spec-stage cross-model jury (kimi + deepseek; codex skipped): dropped stale sales/plots route changes (already support `search`) — batch is now 100% eudr-internal; defined exact cockpit queue criteria with per-queue feature gating (leak blocker); added mappings `productId` + 2-step product-name resolution for the mapping picker; create flow redirects to edit for attachments; cut-off warning computed in route item mapping; documented verified spot id and existing `order_id` column.
- Implemented (all phases); see Implementation Status.
