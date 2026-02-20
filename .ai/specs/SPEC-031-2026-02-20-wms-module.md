# WMS Module Specification (SPEC-031)

**Date**: 2026-02-20  
**Status**: Proposed  
**Issue**: [#388 - feat: WMS module](https://github.com/open-mercato/open-mercato/issues/388)

---

## TLDR

**Key points:** New core module `wms` in `packages/core/src/modules/wms/` for warehouse and inventory management. Multi-warehouse, multi-location hierarchy, inventory balances with reservations/allocations, FIFO/LIFO/FEFO strategies, lot/serial/expiry tracking. Link to catalog via foreign keys only (no cross-module ORM relations). Forward compatibility with POS (SPEC-022): WMS will subscribe to `pos.cart.completed` and `pos.session.closed` for future inventory decrement.

**Scope (MVP Phase 1):** Core entities (Warehouse, WarehouseLocation, ProductInventoryProfile, InventoryLot, InventoryBalance, InventoryReservation, InventoryMovement), CRUD + validations + OpenAPI, inventory adjust/reserve/release/allocate/move, FIFO/LIFO/FEFO on reserve/allocate, basic admin UI (warehouses, locations, inventory list), search config for warehouses and locations.

**Out of scope for Phase 1:** ASN/ReceivingLine, PutawayTask, PickWave, PackingTask (Phases 2–3).

---

## 1) Overview

The WMS (Warehouse Management System) module adds warehouse and inventory capabilities to Open Mercato: multiple warehouses, hierarchical locations, real-time inventory balances, reservations and allocations, lot/serial/expiration tracking, and strategy-based picking (FIFO/LIFO/FEFO). It extends the catalog conceptually via `ProductInventoryProfile` linked to catalog product/variant by UUID only; no MikroORM relations across modules. The module is tenant- and organization-scoped and follows the same auto-discovery, CRUD factory, command, and event patterns as existing core modules (e.g. customers, catalog, resources).

---

## 2) Problem Statement

- Open Mercato has no built-in warehouse or inventory management. Sales and catalog do not track stock, locations, or reservations.
- POS (SPEC-022) defers inventory decrement and emits `pos.cart.completed`; a WMS module is required to consume these events and update inventory.
- Operators need multi-warehouse and multi-location hierarchy, inventory adjustments with audit trail (InventoryMovement), reservations/allocations for orders, and strategy-based allocation (FIFO/LIFO/FEFO) for lots and expiry.

---

## 3) Goals

- Provide core WMS entities and APIs for warehouses, locations, inventory profiles, lots, balances, reservations, and movements.
- Support inventory adjustments, reservations, releases, allocations, and moves with full audit (InventoryMovement ledger).
- Apply FIFO/LIFO/FEFO when reserving or allocating from lots.
- Link to catalog only by UUID (`catalog_product_id`, `catalog_variant_id`); declare extension in `data/extensions.ts` via `defineLink`.
- Enable future POS integration by subscribing to `pos.cart.completed` (and optionally `pos.session.closed`) when implemented.
- Keep all data tenant- and organization-scoped; use undoable commands and `emitCrudSideEffects` / `emitCrudUndoSideEffects` with `indexer: { entityType, cacheAliases }`.

---

## 4) Non-Goals (Phase 1)

- ASN (Advanced Shipping Notice), ReceivingLine, PutawayTask (Phase 2).
- PickWave, PickTask, PackingTask (Phase 3).
- Barcode scanning API (Phase 2).
- Slotting, replenishment rules, heatmap analytics (Phase 4).
- Kitting, bundling, value-added services (Phase 5).

---

## 5) Module Integration Status

| Module    | Exists | Phase 1 Integration |
|-----------|--------|---------------------|
| **catalog** | ✅ Yes | **Link only** — ProductInventoryProfile references `catalog_product_id` / `catalog_variant_id` (FK); no ORM relations. Declare in `data/extensions.ts` with `defineLink`. |
| **directory** | ✅ Yes | **Required** — tenant_id, organization_id on all entities. |
| **auth**   | ✅ Yes | **Required** — performed_by, RBAC via `acl.ts` and `setup.ts` defaultRoleFeatures. |
| **query_index** | ✅ Yes | **Required** — `indexer: { entityType: E.wms.* }` in makeCrudRoute and emitCrudSideEffects. |
| **audit_logs** | ✅ Yes | **Built-in** — ActionLog via command pattern. |
| **POS**    | ✅ Yes (SPEC-022) | **Future** — WMS will subscribe to `pos.cart.completed`, `pos.session.closed`. PosRegister.warehouseId references Warehouse.id. |

---

## 6) Proposed Solution

- **Location:** `packages/core/src/modules/wms/`.
- **Entities:** Warehouse, WarehouseLocation, WarehouseZone (optional in Phase 1), ProductInventoryProfile, InventoryLot, InventoryBalance, InventoryReservation, InventoryMovement (see Data Models).
- **Commands (undoable):** createWarehouse, updateWarehouse, createLocation, receiveInventory, putawayInventory, reserveInventory, releaseReservation, allocateReservation, moveInventory, adjustInventory, cycleCountReconcile. All use `withAtomicFlush` where multi-phase mutations occur; side effects after flush with `indexer: { entityType, cacheAliases }`.
- **API:** CRUD for warehouses, locations, inventory/balances; POST for adjust, reserve, release, allocate, move, cycle-count. All routes export `openApi` with Zod schemas.
- **Validation:** Zod schemas in `data/validators.ts` (warehouseCreateSchema, locationCreateSchema, inventoryAdjustSchema, reservationCreateSchema, lotCreateSchema, movementCreateSchema, etc.).
- **Extensions:** `data/extensions.ts` — link ProductInventoryProfile to catalog product/variant via `defineLink` (FK only).

---

## 7) Architecture

- WMS is a standard Open Mercato module: `index.ts`, `acl.ts`, `setup.ts`, `di.ts`, `ce.ts`, `events.ts`, `data/entities.ts`, `data/validators.ts`, `data/extensions.ts`, `commands/`, `api/`, `backend/` (UI), `search.ts`.
- No direct imports of catalog entities; only UUIDs stored. Catalog product/variant existence is not enforced by FK at DB level (cross-package); validation can be application-level if needed.
- Event flow: commands emit CRUD events; query_index and cache updated via emitCrudSideEffects. Future: WMS subscribes to `pos.cart.completed` to decrement or reserve inventory by warehouse (from PosRegister.warehouseId and cart lines).
- Dependency flow: directory (tenant/org), auth (user), catalog (IDs only), query_index (indexer), events (bus).

---

## 8) Data Models

All entities include: `id` (uuid), `created_at`, `updated_at`, `deleted_at`, `tenant_id`, `organization_id` (where applicable). Table names use `wms_*` prefix.

### 8.1 Warehouse

- `name` (string, required)
- `code` (string, unique per org)
- `is_active` (boolean)
- `address` (json or separate: address_line1, city, postal_code, country)
- `timezone` (string, nullable)

### 8.2 WarehouseLocation

- `warehouse_id` (uuid)
- `code` (string, required, unique per warehouse)
- `type` (enum: zone | aisle | rack | bin | slot | dock | staging)
- `parent_id` (uuid, nullable)
- `is_active` (boolean)
- `capacity_units`, `capacity_weight` (number, nullable)
- `constraints` (json: max_height, max_width, temp_range, hazmat flags, etc.)

### 8.3 WarehouseZone (optional Phase 1)

- `warehouse_id`, `code`, `name`, `priority` (number, for picking/putaway)

### 8.4 ProductInventoryProfile

- `catalog_product_id` (uuid, required)
- `catalog_variant_id` (uuid, nullable for product-level)
- `default_uom` (string)
- `track_lot`, `track_serial`, `track_expiration` (boolean)
- `default_strategy` (enum: fifo | lifo | fefo)
- `reorder_point`, `safety_stock` (number)

### 8.5 InventoryLot

- `sku`, `catalog_variant_id`, `lot_number`, `batch_number` (nullable)
- `manufactured_at`, `best_before_at`, `expires_at` (date, nullable)
- `status` (enum: available | hold | quarantine | expired)

### 8.6 InventoryBalance

- `warehouse_id`, `location_id`, `catalog_variant_id`, `lot_id` (nullable), `serial_number` (nullable)
- `quantity_on_hand`, `quantity_reserved`, `quantity_allocated` (number)
- `quantity_available` = on_hand - reserved - allocated (computed, not stored)

### 8.7 InventoryReservation

- `warehouse_id`, `catalog_variant_id`, `lot_id` (nullable), `serial_number` (nullable), `quantity`
- `source_type` (enum: order | transfer | manual), `source_id` (uuid)
- `expires_at` (nullable), `status` (active | released | fulfilled)

### 8.8 InventoryMovement (ledger)

- `warehouse_id`, `location_from_id`, `location_to_id` (nullable each)
- `catalog_variant_id`, `lot_id`, `serial_number`, `quantity`
- `type` (enum: receipt | putaway | pick | pack | ship | adjust | transfer | cycle_count)
- `reference_type` (po | so | transfer | manual | qc), `reference_id`, `performed_by`, `performed_at`, `reason` (nullable)

---

## 9) API Contracts

### 9.1 CRUD (Phase 1)

- `GET/POST /api/wms/warehouses` — list, create
- `GET/PUT/DELETE /api/wms/warehouses/:id`
- `GET/POST /api/wms/locations` — list, create
- `GET/PUT/DELETE /api/wms/locations/:id`
- `GET/POST /api/wms/inventory/balances` — list (and create if needed for initial stock)

### 9.2 Actions (Phase 1)

- `POST /api/wms/inventory/adjust` — body: warehouse_id, location_id, catalog_variant_id, lot_id (optional), quantity delta, reason (required)
- `POST /api/wms/inventory/reserve` — quantity, source_type, source_id, optional expires_at
- `POST /api/wms/inventory/release` — reservation id or criteria
- `POST /api/wms/inventory/allocate` — reservation id or criteria
- `POST /api/wms/inventory/move` — from location, to location, variant, lot, quantity
- `POST /api/wms/inventory/cycle-count` — reconciliation with reason

All request/response bodies defined with Zod; all route files export `openApi` for generator.

### 9.3 Later Phases (reference only)

- ASN: `GET/POST /api/wms/asn`, `POST /api/wms/asn/receive`
- Pick: `GET/POST /api/wms/pick-waves`, `POST /api/wms/pick-waves/:id/assign`, `POST /api/wms/pick-waves/:id/complete`
- Packing: `GET/POST /api/wms/packing`

---

## 10) Inventory Strategy Rules

- **FIFO:** oldest received first (e.g. by movement `performed_at` or lot received_at if stored).
- **LIFO:** newest first.
- **FEFO:** earliest `expires_at` first; fallback to FIFO if missing.
- Respect `track_lot` / `track_serial` on ProductInventoryProfile when reserving/allocating.

---

## 11) Implementation Approach / File Structure

Module skeleton to create under `packages/core/src/modules/wms/`:

- `index.ts` — metadata (ModuleInfo), export features from acl
- `acl.ts` — features (e.g. wms.view, wms.manage_warehouses, wms.manage_inventory)
- `setup.ts` — defaultRoleFeatures, optional seedDefaults/seedExamples
- `di.ts` — register(container), optional services
- `ce.ts` — custom entity specs if any; else `entities = []`
- `events.ts` — createModuleEvents('wms', { ... })
- `data/entities.ts` — MikroORM entities, default export array
- `data/validators.ts` — Zod schemas
- `data/extensions.ts` — defineLink for ProductInventoryProfile ↔ catalog
- `commands/index.ts` — re-export commands
- `commands/warehouses.ts`, `commands/locations.ts`, `commands/inventory.ts` (or equivalent split)
- `api/openapi.ts` — createCrudOpenApiFactory({ defaultTag: 'WMS' })
- `api/warehouses/route.ts`, `api/warehouses/[id]/route.ts`
- `api/locations/route.ts`, `api/locations/[id]/route.ts`
- `api/inventory/balances/route.ts`, `api/inventory/adjust/route.ts`, reserve, release, allocate, move, cycle-count
- `search.ts` — search config for warehouse, location (and balances if needed)
- `backend/` — backend pages (e.g. warehouses list/detail, locations, inventory list)

App registration: add `{ id: 'wms', from: '@open-mercato/core' }` to `apps/mercato/src/modules.ts`.

After creating entities: run `yarn generate`, then `yarn db:generate` (migrations), then implement commands and API.

---

## 12) Integration Coverage (API & UI Paths)

| Area | Path / Scope | Phase 1 |
|------|-------------|---------|
| API | GET/POST /api/wms/warehouses | ✅ |
| API | GET/PUT/DELETE /api/wms/warehouses/:id | ✅ |
| API | GET/POST /api/wms/locations | ✅ |
| API | GET/PUT/DELETE /api/wms/locations/:id | ✅ |
| API | GET /api/wms/inventory/balances | ✅ |
| API | POST /api/wms/inventory/adjust, reserve, release, allocate, move, cycle-count | ✅ |
| UI | Backend list/detail warehouses | ✅ |
| UI | Backend list/detail locations | ✅ |
| UI | Backend inventory list (balances) | ✅ |
| Events | Subscriber pos.cart.completed (future) | Phase 2 |

Integration tests (per AGENTS.md) must be self-contained; create fixtures via API, clean up in teardown. Cover at least: create warehouse, create location, adjust inventory, reserve, release (or allocate).

---

## 13) Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| Race on reserve/allocate (over-allocation) | High | InventoryBalance, InventoryReservation | Use `withAtomicFlush` + transaction in reserve/allocate commands; check available qty in same transaction | Low if constraints and tests in place |
| Stale query index / cache after command | Medium | Search, UI lists | Always pass `indexer: { entityType, cacheAliases }` in emitCrudSideEffects and emitCrudUndoSideEffects | Low |
| Catalog product/variant deleted but WMS still references | Low | ProductInventoryProfile, balances | No DB FK; application can validate or allow orphaned refs; optional cleanup job later | Acceptable for Phase 1 |
| POS event payload shape changes | Low | Future subscriber | Pin POS event schema in SPEC-022 or contract doc; version payload if needed | Low |

---

## 14) Final Compliance Report

- [ ] Spec follows `.ai/specs/` naming: SPEC-031-2026-02-20-wms-module.md
- [ ] Spec includes TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact, Integration coverage, Changelog
- [ ] Implementation will follow AGENTS.md Task Router: packages/core/AGENTS.md, customers/catalog patterns, query index indexer, withAtomicFlush for multi-phase commands
- [ ] No cross-module ORM relations; catalog linked only via UUID and data/extensions.ts defineLink
- [ ] SPEC-022 (POS) compatibility: PosRegister.warehouseId and events pos.cart.completed / pos.session.closed acknowledged for future WMS subscriber

---

## Changelog

### 2026-02-20

- Initial WMS module specification (MVP Phase 1). Source: GitHub issue #388, SPEC-022 (POS) for integration contract. Scope: core entities, CRUD + inventory actions, validations, OpenAPI, search config, basic backend UI; Phases 2–5 deferred.
