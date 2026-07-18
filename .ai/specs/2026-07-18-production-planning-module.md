# Production Planning Module (`@open-mercato/production`)

| Field | Value |
|-------|-------|
| **Status** | Draft (rev 1) |
| **Created** | 2026-07-18 |
| **Source** | Functional draft `open-mercato-modul-produkcja-spec.md` v0.1 (discrete MTO/MTS manufacturing for SMB) |
| **Builds on** | `catalog` (products, variants, unit conversions), `dictionaries`, `planner` (RRULE availability), `resources`, `queue` + `progress`, `scheduler`, `sales` (soft), `feature_toggles` |
| **Related** | `SPEC-034` units-of-measure conversions (implemented), `SPEC-022` POS module (vertical-module precedent), `packages/scheduler` (workspace-package layout reference) |

## TLDR

**Key Points:**
- New optional vertical module for SMB discrete manufacturing: technology (BOM + routings + work centers), production orders with lifecycle and technology snapshot, simplified net MRP, shop-floor reporting, and a minimal production stock ledger.
- Ships as a dedicated workspace package **`packages/production`** (module id `production`), enabled by one `apps/mercato/src/modules.ts` entry and gated by a **`production_enabled` feature toggle**. **Zero modifications to core modules** — all integration happens through events, widget injection, response enrichers, FK-id + snapshot, and `tryResolve` soft dependencies.
- The platform has **no warehouse, no purchasing, and no print-template engine** (verified 2026-07-18). This spec resolves those gaps explicitly: a minimal module-owned stock ledger behind a **`productionStockProvider` DI seam** (decision *i*), MRP "buy" suggestions degraded to export + notification (decision *d*), and the QR/PDF shop traveler deferred (decision *f*).
- Delivery is **one PR per phase** (P0+P1, P2, P3, P4, P5, P6), each shipping its own integration tests, all behind the feature toggle.

**Scope (MVP, phases 0–6):**
- Work centers (cost rate, capacity factor, optional planner availability calendar), versioned BOMs (scrap factor, phantom, per-operation material assignment, UoM), versioned routings (sequence, setup/run times, reporting points), per-product planning parameters (make/buy, lead time, lot sizing, safety stock)
- Standard cost rollup (quantities × catalog prices + work-center rates, UoM-converted)
- Minimal production stock ledger: on-hand per product/variant, optional batches, **append-only** movements (receipt / issue / adjustment + storno), reservations; opening balances via manual receipt and CSV import
- Production orders: `draft → planned → released → in_progress → completed → closed` (+ `cancelled`), technology snapshot as copied rows at release, material reservations and shortage list at release
- Sales integration (soft): "Production" tab + create-production-order action injected into the sales order detail, optional MTO subscriber on `sales.order.created`, `_production` response enricher
- Shop-floor reporting: partial/final operation reports (good/scrap qty with dictionary reason codes, times), configurable backflush or manual issue, finished-goods receipt on final operation; operator "lite" work-queue surface with dedicated minimal ACL
- Net MRP: per-tenant asynchronous runs (queue worker + `ProgressJob` + scheduler cron), versioned runs with suggestions (make / buy / reschedule / cancel), ack/dismiss with carry-over, bulk accept; seeded performance benchmark (10k SKUs / 5 BOM levels < 60 s)
- Quantity-based MVP reports: late/at-risk orders, actual vs. standard consumption, scrap by reason

**Deferred (explicit backlog — not silently dropped):**
- APS: finite-capacity scheduling, Gantt, sequencing, CTP, event-driven rescheduling (draft phase 2; licensing decision open)
- Shop traveler PDF + operation QR codes (no platform print engine; new production dependency requires maintainer approval)
- PIN/badge login and offline kiosk mode for the operator panel (requires platform-level auth work)
- Purchasing integration for MRP buy suggestions; full warehouse module (StockProvider extraction), inventory valuation, transfers, stocktaking
- Purchase/acquisition price source for the cost rollup (new purchase-type `CatalogPriceKind` or a production-owned cost table) — until then the rollup is a `catalog_list_price` estimate and is labeled as such in the UI
- Batch genealogy report (data model is batch-ready from Phase 2; the report is deferred), routing operation alternatives, downtime events / OEE, process manufacturing, subcontracting, forecast demand sources

**Concerns:**
- The minimal stock ledger is a scope-creep magnet — the NOT-in-scope fence (decision *j*) is normative, not advisory.
- MRP is the performance hot spot; naive per-entity ORM loads will not meet the 60 s KPI. The bulk-load design (§ MRP Engine) and the benchmark are mandatory before Phase 5 is declared done.
- Shared shop-floor tablets running standard backend sessions are the top security risk; the operator surface is deliberately minimal-privilege with client-side inactivity logout (decision *e*).

## Overview

Open Mercato today covers CRM, catalog, and sales but offers nothing for manufacturers: no bill of materials, no production orders, no material requirements planning, no shop-floor capture. SMB manufacturers (make-to-order and make-to-stock) either run a separate MES/APS or spreadsheets. This module gives them a single place to define technology, plan and release production, record execution, and keep component/finished-goods quantities consistent — without an enterprise system and without forking the platform.

The module is an **optional vertical**: platform installations that do not enable the `production_enabled` feature toggle see no UI, no routes, and no behavior change.

## Problem Statement

1. **No technology master data.** Products exist in `catalog`, but there is no way to describe how a product is made (components, operations, work centers, times, scrap).
2. **No production execution.** No production order lifecycle, no link from a sales order to manufacturing, no shop-floor capture of good/scrap quantities.
3. **No requirements planning.** Nothing computes "what to make and what to buy, and when" from demand, stock, and open orders.
4. **Platform gaps block the naive design.** The functional draft assumes a warehouse module (hard dependency), a purchasing module, and a print-template engine — none exist. An implementation that pretends they do will fail; an implementation that modifies core to add them violates the module-isolation contract.

## Proposed Solution

### Design Decisions

Decisions (a)–(k) below were fixed during planning (research 2026-07-18 + adversarial review panel) and are normative for phases 0–6.

| # | Decision | Resolution | Rationale |
|---|----------|------------|-----------|
| a | Work-center calendars | **Reuse `planner` availability rules.** `WorkCenter.availability_rule_set_id` is a nullable FK-id to planner's `PlannerAvailabilityRuleSet`, declared via `data/extensions.ts` (no ORM relation). Null or planner module absent → treat the work center as available 24/7. | Planner already models shifts/exceptions as iCal RRULE rules with dictionary-backed unavailability reasons; building a second calendar would duplicate a framework mechanism. Resolves draft open decision #1. |
| b | Reason codes | **`dictionaries` module.** MVP seeds one org-scoped dictionary: `production-scrap-reasons` (idempotent upgrade action, pattern: customers `interaction-statuses`). `production-downtime-reasons` ships later with the OEE extension. | Tenant-configurable enumerations are a solved problem; planner already FK-references dictionary entries the same way. |
| c | MRP execution model | **Per-tenant asynchronous jobs.** An `MrpRun` row is created, then one queue job per tenant/org (worker `{ queue: 'production-mrp', id: 'production:mrp-run', concurrency: 1 }`) executes it with a `ProgressJob` for top-bar progress. Cyclic execution via a `scheduler` cron entry that enumerates tenants and enqueues one job each (fan-out; never one job iterating all tenants). | Matches the platform's queue+progress+scheduler stack; per-tenant fan-out prevents cross-tenant bleed and starvation. Runs are versioned audit objects per the draft. |
| d | MRP "buy" suggestions | **Degrade to export + notification.** `buy` suggestions can be acknowledged/dismissed and exported to CSV; an in-app notification targets users with `production.mrp.manage`. No purchase order is created (no purchasing module exists). `production.mrp_suggestion.accepted` is emitted so a future purchasing module can subscribe. | Honest degradation instead of a dead button; the event is the forward-compatible seam. |
| e | Operator authentication | **Standard login + dedicated minimal role.** ACL features `production.operator.view` / `production.operator.report` gate the operator surface; `setup.ts` seeds an "Operator" role holding only those two features. The operator page implements client-side inactivity auto-logout (default 15 min, org-configurable). PIN/badge login and offline kiosk mode are **platform-level backlog**, not module scope. | The platform has no PIN/card auth; improvising one inside a module would weaken security. A minimal-feature role bounds the shared-tablet blast radius. |
| f | Shop-floor reporting UX | **List-based selection in MVP.** Operators pick an operation from their work queue; QR scanning and the printed shop traveler are deferred together (no print/PDF engine exists; a new production dependency needs maintainer approval — Ask First). | The draft itself allows "scan **or** pick from list"; the list path delivers the workflow without new dependencies. Recorded as an explicit scope cut, not an omission. |
| g | Technology snapshot at release | **Copied rows, not a JSON blob.** On release, BOM items are copied into `production_order_materials` and routing operations into `production_order_operations`, stamped with source ids + versions. All downstream logic (reservations, backflush, reporting, genealogy) reads **only** snapshot tables. | Snapshot rows are queryable, indexable, and diff-able; a JSON blob would force every consumer to re-parse and would silently drift from validation rules. Technology edits after release never affect in-flight orders. |
| h | Stock movement mutability | **Append-only + storno.** `production_stock_movements` rows are immutable; corrections create a compensating movement referencing `reverses_movement_id`. Command undo for movement-producing commands is implemented as compensating movements, never row mutation/deletion. Movements and production reports use the documented append-only exemption from the optimistic-lock editable-entities guard (allowlisted with reason). | A mutable ledger cannot be audited and breaks genealogy; naive command-undo of a consumed receipt would corrupt on-hand. Storno matches the draft's correction requirement. |
| i | Stock access seam | **`productionStockProvider` DI contract.** Interface (D1): `getOnHand(scope, productId, variantId?, uom)`, `reserve(lines, ref)`, `releaseReservations(ref)`, `issue(lines, ref)`, `receive(lines, ref)`, `adjust(line, reason, ref)`, `findBatches(scope, productId)`. The default implementation is backed by module-owned `production_stock_*` tables. **Only the DI interface and emitted events are contract surfaces; the tables are internal.** Extraction path: a future warehouse module registers its own provider under the same DI token and ships a one-time data migration from `production_stock_*`; the production module itself does not change. | Makes "minimal ledger now, real warehouse later" a swap instead of a rewrite, and keeps the ledger honest about being an implementation detail. |
| j | Mini-ledger scope fence | **NOT in scope (normative):** multi-warehouse/locations (one logical location per organization), transfers, stocktaking/cycle counts, any valuation (quantities only — no FIFO/weighted average), negative-stock overrides (hard block), serial numbers, FEFO/automatic batch picking (batch choice is manual; batches optional per product). | Each fence line is a real-world day-one feature request; accepting any of them doubles Phase 2. Valuation belongs to the future warehouse module. |
| k | Test strategy | **Integration coverage ships per phase** (repo policy), per the matrix in § Integration Test Coverage. MRP additionally gets a named unit-test matrix and a seeded performance benchmark (10k SKUs / 5 levels < 60 s) that must pass before Phase 5 closes. | One "tests at the end" task violates `.ai/qa/AGENTS.md` and guarantees an untested module. |

### Alternatives Considered

| Alternative | Why rejected |
|-------------|-------------|
| Build a full standalone `packages/inventory` module first | Months of prerequisite work before any manufacturing value ships; the DI seam (decision *i*) buys the same replaceability at a fraction of the cost. Revisit when a real warehouse module is prioritized. |
| Put the module in `packages/core/src/modules/production` | Manufacturing is not a core concern of every installation; core placement would drag entities/migrations into every deployment and contradicts the optional-vertical requirement. |
| Put the module in `apps/mercato/src/modules/` | Forbidden by repo policy (`apps/mercato/src` is user-app boilerplate; only committed `*.generated.ts` registries may live there). |
| JSON-blob technology snapshot | See decision *g*. |
| Editable stock movements with command undo | See decision *h*. |
| One big PR for the whole module | 15–25k lines, unreviewable and unrebasable; per-phase PRs behind the toggle keep each review tractable and CI-green. |
| PIN auth implemented inside the module | Security-sensitive auth belongs to the platform `auth` module; a module-local PIN scheme would be a weaker parallel auth path. |

## User Stories

| # | As a... | I want to... | So that... |
|---|---------|--------------|------------|
| 1 | Technolog | define versioned BOMs and routings with scrap factors and per-operation materials | production orders and MRP work from accurate technology |
| 2 | Technolog | roll up a standard cost for a BOM version | I can sanity-check pricing before activating a version |
| 3 | Planista | release a production order and immediately see reservations and a shortage list | I know whether production can start |
| 4 | Planista | create a production order from a sales order in one action | make-to-order flow takes minutes, not re-typing |
| 5 | Planista | run MRP (manually or on a cron) and accept suggestions singly or in bulk | the plan reflects demand, stock, and open orders |
| 6 | Operator | see my work queue and report good/scrap quantities with a reason code on a tablet | execution is captured at the source |
| 7 | Kierownik produkcji | see late/at-risk orders and actual-vs-standard consumption | I can intervene before dates slip |
| 8 | Magazynier-lite | record opening balances and manual receipts/issues | on-hand quantities in the system match reality |

## Architecture

### Placement & wiring

```
packages/production/                      # new workspace package @open-mercato/production
└── src/modules/production/
    ├── index.ts  acl.ts  setup.ts  di.ts  events.ts  ce.ts  translations.ts
    ├── data/{entities,validators,extensions,enrichers}.ts
    ├── commands/…       api/…        backend/production/…
    ├── widgets/{injection-table.ts,injection/…}
    ├── subscribers/…    workers/…    migrations/ (+ .snapshot-open-mercato.json)
    └── i18n/{en,pl,de,es}.json
```

- Enabled via one entry in `apps/mercato/src/modules.ts`: `{ id: 'production', from: '@open-mercato/production' }` (same wiring as `scheduler`).
- Entire surface (menu items, routes, pages, subscribers, cron) is gated by the `production_enabled` feature toggle (module `feature_toggles`); toggle off ⇒ no observable change.
- **No core module is modified.** Sales integration uses existing injection spots; planner/resources/dictionaries are referenced by FK-id via `data/extensions.ts`; absence of any soft peer is handled with module-local `tryResolve` and verified by the module-decoupling test.

### Dependencies

| Peer | Kind | Used for | Absent behavior |
|------|------|----------|-----------------|
| `catalog` | hard | product/variant identity, `catalog_product_unit_conversions`, prices for standard cost | module requires catalog (platform-core, always present) |
| `dictionaries` | hard | scrap reason codes | platform-core, always present |
| `queue`, `progress`, `scheduler` | hard | MRP jobs, progress, cron | platform packages, always present |
| `planner` (+ `resources`) | soft | work-center availability calendars | work centers default to 24/7; calendar picker hidden |
| `sales` | soft | MTO demand, order-detail injection, enricher | manual/MTS mode: no injected tab, MRP demand = min-stock only |
| `feature_toggles` | hard | module gate | platform-core |

### Sales integration (soft, injection-only)

- **Widget**: a "Production" tab injected into spot `sales.document.detail.order:tabs` showing linked production orders and a "Create production order" action (visible only for products with `ProductPlanningParams.procurement = 'make'` and feature `production.orders.manage`).
- **Subscriber** (optional, org-configurable, default off): on `sales.order.created`, create draft production orders for `make` items (MTO).
- **Response enricher** on `sales:order`: `_production: { orders: [{ id, status, qtyPlanned, qtyCompleted }] } | null`, feature-gated by `production.orders.view`, batch `enrichMany`, fallback `null`. Never exposed on portal/customer-facing responses.

### MRP engine (performance-critical design)

1. **Bulk load per tenant/org** (a handful of scoped SQL queries, not per-entity ORM walks): active BOM + routing versions, planning params, on-hand + reservations (via `productionStockProvider`), open production orders, demand (sales order lines with due dates via query engine, `tryResolve`d; plus min-stock/safety-stock deficits).
2. **In-memory netting + explosion**: low-level-coded BOM explosion with memoized subtrees, phantom pass-through, scrap-factor and UoM conversion at each level; backward scheduling from required dates by lead time (infinite capacity in MVP); lot sizing (min lot, multiple).
3. **Suggestions**: `make` / `buy` / `reschedule` / `cancel` written with the run id; previously acknowledged/dismissed suggestions carry over (matched by product + demand source) instead of re-emitting noise.
4. **Worker contract**: idempotent (re-running a failed run recomputes from scratch and supersedes partial output), `ProgressJob` heartbeats, `progressService.failJob` on error.
5. **Benchmark**: seeded generator (10k products, 5-level BOMs) + timed run < 60 s, executable locally and as opt-in CI job. Phase 5 does not close without it.

### Status machine (ProductionOrder)

`draft → planned → released → in_progress → completed → closed`, `cancelled` reachable from `draft|planned|released`. Guards: release requires an active BOM+routing version pair (snapshot copies them, decision *g*) and emits reservations + shortage list; `cancelled` releases reservations and is blocked when material was partially issued (storno first); `completed` requires a final report on the last reporting-point operation (which triggers finished-goods receipt); `closed` is terminal bookkeeping. Sub-resources (operations, reports) are guarded by the **parent order's** `updated_at` (sales-document aggregate pattern, `enforceCommandOptimisticLock`).

## Data Models

All tables: `id uuid PK`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at` (soft delete) unless noted. Table prefix `production_`.

| Entity | Table | Key columns (beyond standard) |
|--------|-------|-------------------------------|
| `WorkCenter` | `production_work_centers` | `name`, `kind` (`machine\|manual\|line\|subcontractor`), `cost_rate_per_hour numeric`, `parallel_stations int`, `efficiency_factor numeric`, `availability_rule_set_id uuid null` (FK-id → planner, decision *a*), `is_active` |
| `ProductionBom` | `production_boms` | `product_id`, `variant_id null` (FK-id → catalog), `version int`, `status` (`draft\|active\|archived`), `valid_from/valid_to`, `name`; UNIQUE `(tenant_id, organization_id, product_id, variant_id, version)` |
| `ProductionBomItem` | `production_bom_items` | `bom_id`, `component_product_id`, `component_variant_id null`, `qty_per_unit numeric`, `uom varchar` (canonical unit code), `scrap_factor numeric default 0`, `is_phantom bool`, `operation_sequence int null` (material → operation assignment) |
| `Routing` | `production_routings` | `product_id`, `variant_id null`, `version int`, `status`, `name`; version pairs with BOM version = technology version |
| `RoutingOperation` | `production_routing_operations` | `routing_id`, `sequence int`, `name`, `work_center_id`, `setup_time_minutes`, `run_time_per_unit_seconds`, `is_reporting_point bool` (no alternatives in MVP) |
| `ProductPlanningParams` | `production_planning_params` | `product_id`, `variant_id null` UNIQUE per scope, `procurement` (`make\|buy`), `lead_time_days int`, `min_lot numeric`, `lot_multiple numeric`, `safety_stock numeric`, `backflush bool default true` |
| `StockItem` | `production_stock_items` | `product_id`, `variant_id null`, `uom`, `on_hand numeric`, `reserved numeric` (derived, maintained transactionally); UNIQUE per scope+product+variant |
| `StockBatch` | `production_stock_batches` | `stock_item_id`, `batch_number`, `on_hand numeric`, `expires_at null` (optional per product) |
| `StockMovement` | `production_stock_movements` | **append-only** (decision *h*): `movement_type` (`receipt\|issue\|adjustment`), `product_id`, `variant_id`, `batch_id null`, `qty numeric` (signed), `uom`, `reason_entry_id null` (dictionary), `source_type/source_id` (order, report, import, manual), `reverses_movement_id uuid null UNIQUE`; no `deleted_at` semantics — never deleted |
| `MaterialReservation` | `production_material_reservations` | `order_id`, `order_material_id`, `stock_item_id`, `batch_id null`, `qty numeric`, `uom`, `status` (`active\|released\|consumed`) |
| `ProductionOrder` | `production_orders` | `number` (sequence per org), `product_id`, `variant_id`, `qty_planned numeric`, `uom`, `due_date`, `priority int`, `status` (§ status machine), `source_type` (`sales_order\|mrp\|manual`), `source_id null`, `bom_version_id`, `routing_version_id`, `released_at`, `qty_completed`, `qty_scrapped` |
| `ProductionOrderOperation` | `production_order_operations` | snapshot rows (decision *g*): `order_id`, `sequence`, `name`, `work_center_id`, times, `is_reporting_point`, `status` (`pending\|in_progress\|done`), `qty_good`, `qty_scrap`, `source_operation_id` |
| `ProductionOrderMaterial` | `production_order_materials` | snapshot rows: `order_id`, `operation_sequence null`, `component_product_id/variant_id`, `qty_required`, `uom`, `scrap_factor`, `qty_issued`, `source_bom_item_id` |
| `ProductionReport` | `production_reports` | **append-only** + storno: `order_operation_id`, `reporter_user_id`, `qty_good`, `qty_scrap`, `scrap_reason_entry_id null`, `started_at/finished_at null`, `report_type` (`partial\|final`), `reverses_report_id null UNIQUE` |
| `MrpRun` | `production_mrp_runs` | `status` (`pending\|running\|completed\|failed`), `params jsonb`, `progress_job_id`, `started_at/finished_at`, `stats jsonb` |
| `MrpSuggestion` | `production_mrp_suggestions` | `run_id`, `suggestion_type` (`make\|buy\|reschedule\|cancel`), `product_id/variant_id`, `qty`, `uom`, `due_date`, `demand_source jsonb` (pegging), `status` (`open\|accepted\|dismissed\|superseded`), `carried_from_suggestion_id null` |

UoM everywhere: BOM items, movements, reservations, reports, and suggestions store a canonical unit code; conversions go through catalog's `catalog_product_unit_conversions` (+ `@open-mercato/shared/lib/units`) at issue/backflush/explosion time. Missing conversion ⇒ validation error, never a silent 1:1 assumption.

## API Contracts

All routes under `/api/production/*`, `makeCrudRoute` with `indexer: { entityType }`, exported `openApi`, standard optimistic locking; writes go through commands.

| Resource | Routes | Notes |
|----------|--------|-------|
| Work centers | CRUD `/api/production/work-centers` | |
| BOMs | CRUD `/api/production/boms` (+ `GET …/[id]` detail with items, `POST …/[id]/copy-version`, `POST …/[id]/activate`, `GET …/[id]/cost-rollup`) | activate validates cycles (missing-components validation is a tracked follow-up); cost-rollup returns a **list-price-based estimate** with `priceBasis: 'catalog_list_price'` — catalog has no purchase/cost price kind, so a true acquisition-cost basis is deferred until a purchase-price source exists (see Deferred) |
| Routings | CRUD `/api/production/routings` (+ `GET …/[id]` detail with operations, copy-version, activate) | |
| Planning params | CRUD `/api/production/planning-params` | gated by `production.mrp.view/manage` (planning master data is the planista's domain; the technology features stay with technolog) |
| Stock | `GET /api/production/stock`, `GET /api/production/stock/batches`, `POST /api/production/stock/receipts`, `POST /api/production/stock/issues`, `POST /api/production/stock/adjustments`, `POST /api/production/stock/import` (CSV, streaming) | mutations are commands emitting movements; storno via `POST /api/production/stock/movements/[id]/reverse` |
| Orders | CRUD `/api/production/orders` (+ `POST …/[id]/release`, `POST …/[id]/cancel`, `GET …/[id]/shortages`) | sub-resources guarded by parent `updated_at` |
| Reports | `POST /api/production/reports` (+ `POST …/[id]/reverse`) | final report on last reporting point triggers FG receipt |
| Operator | `GET /api/production/operator/queue` | features `production.operator.*` only |
| MRP | `POST /api/production/mrp/runs`, `GET …/runs`, `GET …/runs/[id]/suggestions`, `POST …/suggestions/accept` (bulk), `POST …/suggestions/dismiss`, `GET …/suggestions/export` | accept(make) → draft order; accept(buy) → ack + event only (decision *d*) |

## Events

`createModuleEvents({ moduleId: 'production' })`, convention `module.entity.action`:

`production.work_center.{created,updated,deleted}`, `production.bom.{created,updated,deleted,activated}`, `production.routing.{created,updated,deleted,activated}`, `production.order.{created,updated,deleted,released,completed,cancelled}`, `production.report.created`, `production.report.reversed`, `production.stock_movement.created`, `production.mrp_run.completed` (clientBroadcast), `production.mrp_suggestion.accepted`.

## Access Control

Features in `acl.ts` (immutable ids), granted in `setup.ts` `defaultRoleFeatures` and synced via `yarn mercato auth sync-role-acls`:

| Feature group | Features | Default roles |
|---------------|----------|---------------|
| Technology | `production.technology.view/manage` | admin, Technolog |
| Stock (mini-ledger) | `production.stock.view/manage` | admin, Planista, Magazynier-lite |
| Orders | `production.orders.view/manage` | admin, Planista |
| Reporting | `production.reports.view/manage` | admin, Planista, Kierownik |
| Operator surface | `production.operator.view/report` | admin, Operator (only these two — decision *e*) |
| MRP | `production.mrp.view/manage` | admin, Planista |

All feature checks in runtime helpers use the shared wildcard-aware matcher.

## Integration Test Coverage (decision *k*)

Self-contained Playwright/API tests (fixtures created via API, cleaned in teardown), shipped **in the same PR as the phase**:

| Phase | API coverage | UI coverage / invariants |
|-------|--------------|--------------------------|
| P1 | BOM/routing/work-center/planning-params CRUD; cycle detection returns 422; cost rollup with UoM + scrap | BOM editor create→version→activate; module hidden when toggle off |
| P2 | receipt/issue/adjustment/storno; CSV import; negative-stock hard block; tenant isolation on stock queries | stock list shows imported on-hand |
| P3 | status machine incl. illegal transitions; release → reservations/shortages; cancel releases reservations, blocked after partial issue; BOM edit post-release does not affect order | sales order → Production tab → create order → release (happy path); enricher absent from portal responses |
| P4 | report → backflush movements (UoM-converted) + FG receipt on final; storno chain; concurrent final reports (one wins, 409 surfaced) | operator queue shows only permitted operations; inactivity logout fires |
| P5 | MRP unit matrix (multi-level, phantom, scrap, UoM, version-by-date, min-stock, in-progress netting, lot sizing); carry-over no-duplication; per-tenant fan-out isolation | run progress in top bar; bulk accept creates draft orders |
| P6 | report aggregations tenant-scoped | reports render; full validation gate + `optimistic-lock-*` guard tests + `module-decoupling` test green |

Performance: seeded MRP benchmark (P5) documented with measured result in this spec's changelog.

## Risks & Impact Review

| Risk | Scenario | Severity | Area | Mitigation | Residual |
|------|----------|----------|------|------------|----------|
| MRP misses 60 s KPI | 10k SKUs, ORM-per-entity loads → multi-minute runs, worker timeouts | High | MRP | Bulk-SQL load design is normative; benchmark gates Phase 5; `concurrency: 1` per tenant | Pathological BOMs (>5 levels, huge fan-out) may exceed KPI — documented limit |
| Stock drift | Backflush + manual issues + stornos disagree with reality | High | Ledger | Append-only movements, derived `on_hand` maintained transactionally in commands (`withAtomicFlush`), negative-stock hard block, adjustment flow with reason codes | Physical-world drift needs stocktaking — explicitly out of scope (fence *j*), manual adjustments are the pressure valve |
| Shared-tablet session abuse | Operator tablet left logged in exposes backend | High | Security | Minimal-feature Operator role (2 features), operator surface renders no other nav, client inactivity logout | Client-side logout is best-effort; PIN/kiosk deferred to platform backlog |
| Cross-tenant leakage in raw SQL | Bulk MRP/shortage queries hand-written for speed omit scoping | Critical | Multi-tenancy | Every bulk query takes `(tenant_id, organization_id)` params from job payload, never from request-less context; P2/P5 tenant-isolation tests | — |
| Scope creep in mini-ledger | "Just add transfers/valuation" requests | Medium | Ledger | Fence *j* is normative in this spec; changes require spec revision | — |
| Snapshot divergence bugs | Code reads live BOM instead of snapshot post-release | Medium | Orders | Decision *g*: downstream reads only `production_order_*` tables; P3 test asserts BOM edit post-release has no effect | — |
| Suggestion noise | Nightly MRP re-emits identical suggestions | Medium | MRP | Ack/dismiss + carry-over matching (decision, P5 test) | Matching heuristic may occasionally re-emit after demand changes |
| Aggregate lock gaps | Concurrent edits on order sub-resources lost | Medium | Orders | Parent-`updated_at` guard via `enforceCommandOptimisticLock`; concurrency tests in P4 | — |

## Migration & Backward Compatibility

- **All contract surfaces are new** (module id, `production_*` tables, `/api/production/*` routes, `production.*` events, `production.*` ACL features, DI token `productionStockProvider`, widget spot usage) — no existing surface changes, nothing to deprecate.
- New surfaces enter `BACKWARD_COMPATIBILITY.md` scope on first release: the **StockProvider interface, event ids, and ACL feature ids are ADDITIVE-ONLY** thereafter; `production_stock_*` tables are explicitly documented as internal (decision *i*) and excluded from the contract.
- Migrations are module-scoped (`packages/production/src/modules/production/migrations/` + snapshot); PRs ship migration files, no local `db:migrate` by agents.
- Feature toggle `production` (default **off**) is the rollout/rollback switch; disabling it removes the entire surface without data loss.
- `DomainMapping`-style search exclusion: stock movements and reports are not search-indexed; orders/BOMs are (`search.ts`), with tenant-scoped indexing only.

## Final Compliance Report

- Simplicity: reuses planner/dictionaries/queue/progress/scheduler instead of new mechanisms; smallest ledger that keeps quantities consistent. ✅
- Module isolation: no core edits; events/injection/enrichers/FK-id+snapshot/`tryResolve` only; `module-decoupling` test required green. ✅
- Data & security: zod validators, commands for all writes, tenant+org scoping everywhere, wildcard-aware ACL checks, optimistic locking incl. aggregate guard, append-only exemptions allowlisted with reason. ✅
- UI: `CrudForm`/`DataTable`/`useGuardedMutation`, i18n in 4 locales, DS tokens, dialog shortcuts. ✅
- Testing: per-phase integration coverage matrix (decision *k*), MRP unit matrix + benchmark. ✅
- Open items intentionally deferred are listed in TLDR → Deferred; none are silent. ✅

## Changelog

- **2026-07-18 (rev 5, Phase 4 implemented)**: Shop-floor reporting shipped: append-only ProductionReport with storno (reverses_report_id UNIQUE), backflush per planning-params flag (consumption = qtyPerUnit × (1+scrap) × (good+scrap), UoM-converted; unassigned materials consume on the last reporting point; provider insufficiencies collect as warnings), finished-goods receipt and order-quantity accrual happen ONLY on the last reporting-point final report. STATUS MACHINE DELTA: reversing that final report reopens the order completed→in_progress through a reversal-only guarded helper (not exposed as a user transition) so a corrected final report can be resubmitted — the public transition map stays unchanged. ACL: production.operator.report gates report creation (granted also to planista/kierownik — requireFeatures is AND-only, no OR mechanism exists); reports.manage gates reversal. production-scrap-reasons lives in the GENERIC dictionaries module (spec decision (b) parenthetical about the customers module-local pattern is superseded — the generic module was the row's primary decision and enables the shared manage UI). Operator panel per decisions (e)/(f) with client inactivity logout. Integration spec TC-PROD-008.
- **2026-07-18 (rev 4, Phase 3 implemented)**: Production order aggregate shipped: normative status machine (pure lib, exhaustively tested), release copies active BOM+routing as snapshot rows atomically and reserves materials per line up to free availability (shared components never over-reserved; provider race rejections reclassified into shortage lines so release always completes side effects), computed shortage list at release + on-demand GET (qty_required − qty_issued − active reservations vs free stock). Sales integration per spec: Production tab injected into sales.document.detail.order:tabs (feature+toggle gated), opt-in idempotent MTO subscriber (moduleConfigService key production.mto_auto_draft, default OFF, tryResolve-degraded), caller-feature-gated _production enricher on sales:sales_order (portal callers hold no production.orders.view — verified against the platform enricher runner). Orders UI with aggregate-lock actions. Integration specs TC-PROD-006/007.
- **2026-07-18 (rev 3, Phase 2 implemented)**: Stock ledger shipped per decisions (h)/(i)/(j): `ProductionStockProvider` DI seam (`productionStockProvider`) with `StockLedgerService` default implementation; stock commands are `isUndoable: false` — storno (`production.stock.reverseMovement`, compensating movement with `reverses_movement_id`) IS the undo per decision (h), and commands stay on `commandBus` for audit; CSV import streams via sync_excel's `parseCsvDocumentBatches` with a 10k row cap whose response always reports the partial `{imported, failed, capExceeded, errors}` summary (retry safety); domain errors surface as translated `production.errors.*` keys. Note: core's optimistic-lock guard scans a curated module map that does not yet include `production` — adding it is a tracked follow-up.
- **2026-07-18 (rev 2, Phase 0+1 implemented)**: Toggle identifier fixed as `production_enabled`; role key `magazynier-lite`; planning-params ACL assigned to `production.mrp.view/manage`; BOM/routing single-record `GET …/[id]` detail routes added (multi-org scope via the module's `resolveOrganizationScopeFilter`, mirroring `makeCrudRoute`); BOM activate validates cycles (missing-components validation tracked as follow-up); cost rollup shipped as a **list-price-based estimate** (`priceBasis: 'catalog_list_price'`) because catalog exposes no purchase-price kind — purchase-price basis moved to Deferred. Integration specs TC-PROD-001..004.
- **2026-07-18**: Initial draft (rev 1). Platform-mapped rewrite of `open-mercato-modul-produkcja-spec.md` v0.1 with decisions (a)–(k) fixed after research + adversarial review panel: planner calendars reuse, dictionaries reason codes, per-tenant async MRP, degraded buy suggestions, operator auth without PIN, list-based reporting MVP, row-copy technology snapshot, append-only ledger with storno, `productionStockProvider` seam, mini-ledger scope fence, per-phase test matrix.
