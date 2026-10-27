# WMS — Gap Report: Month 1 vs Phase 1 Implementation

| Field | Value |
|-------|-------|
| **Date** | 2026-06-06 |
| **Branch** | `feat/388-wms-phase-1` |
| **Commit** | `79fe0f515` |
| **Issue** | [#388](https://github.com/open-mercato/open-mercato/issues/388) |
| **Language** | English |

## Summary

The implementation on branch `feat/388-wms-phase-1` **covers the vast majority** of the WMS roadmap Month 1 business scope and **~95%** of the Phase 1 technical specification. At the same time, the branch **is ahead of plan** in several areas scheduled for Month 2+ (sales integration, auto-reserve/release, Move/Release console actions, warehouse assignment on orders).

| Metric | Assessment |
|--------|------------|
| Month 1 business plan coverage | **~85–90%** |
| Phase 1 technical spec coverage | **~95%** |
| Scope beyond M1 (M2+) | **Significant** — sales integration and advanced UI mutations |
| Readiness to close M1 | **Close** — a few UX/operational gaps and missing in-app notifications |

---

## Baseline sources (plan)

| Document | Path | Role |
|----------|------|------|
| Business roadmap (M1–M3) | `docs/wms/wms-roadmap-and-estimates-en.md` | Definition of "Month 1" — warehouse, dictionaries, operational views, Adjust, cycle count, CSV import, primary warehouse |
| Phase 1 technical spec | `.ai/specs/2026-04-15-wms-phase-1-core-inventory.md` | Technical contract: entities, API, UI, catalog/sales integrations |
| Roadmap context | `.ai/specs/2026-04-15-wms-roadmap.md` | Phases 1–5, cross-module dependencies |

### Definition of Done — Month 1 (from roadmap)

> *Warehouse structure + catalog + solid UX + operational visibility (including lot/expiry) + primary warehouse + Adjust + simple cycle count + import decision tied to first merchant scale* — demo: configure warehouses with one primary, create locations/SKUs, post an opening balance via Adjust, run a short cycle count, show per-SKU / per-location / per-lot + expiry card + overview; import path exists or is explicitly waived with written scale assumption.

---

## Implementation scope (WMS module)

**Path:** `packages/core/src/modules/wms/`

**Integration tests:** 22 Playwright files in `packages/core/src/modules/wms/__integration__/`

---

## Compliance matrix — Month 1

Status legend:

| Symbol | Meaning |
|--------|---------|
| ✅ | Done per M1 plan |
| ⚠️ | Partial / quality below M1 expectations |
| ❌ | Missing vs M1 plan |
| 🔵 | Ahead of plan — scheduled for M2+ or beyond M1 |

### 1. Warehouse topology and master data

| M1 requirement | Status | Evidence / notes |
|----------------|--------|------------------|
| Warehouses (`Warehouse`) | ✅ | CRUD + UI `/backend/config/wms` |
| Zones (`WarehouseZone`) | ✅ | CRUD in WMS configuration |
| Locations (`WarehouseLocation`) | ✅ | Hierarchy, address uniqueness |
| **Primary warehouse** (`is_primary`) | ✅ | MVP policy; used by sales automation |
| Products/SKUs (catalog integration) | ✅ | `ProductInventoryProfile`, `catalog-inventory-profile` widget |
| Units of measure | ✅ | Via catalog (not duplicated in WMS) |
| RBAC: operator / supervisor | ✅ | `setup.ts`, `acl.ts` — 9 features |
| CSV import (bootstrap) | ✅ | `ImportInventoryDialog`, validate/apply/template API, tests TC-WMS-025, TC-WMS-IMPORT-UI-001 |

### 2. Inventory engine

| M1 requirement | Status | Evidence / notes |
|----------------|--------|------------------|
| Movement ledger (`InventoryMovement`) | ✅ | Append-only, API `/api/inventory/movements` |
| Balances (`InventoryBalance`) | ✅ | Per location/variant/lot |
| Reservations (`InventoryReservation`) | ✅ | Model + API + UI `/backend/wms/reservations` |
| Lots (`InventoryLot`) + expiry | ✅ | Entity, views, expiry dashboard |
| Inventory profiles | ✅ | Lot/serial/FEFO/safety stock/reorder |
| **Adjust** mutation (UI) | ✅ | `AdjustInventoryDialog`, TC-WMS-INVENTORY-UI-001 |
| **Cycle count** mutation (3 steps) | ✅ | Simple count → variance → post flow |
| **Move** mutation (UI row action) | 🔵 | `MoveInventoryDialog`, TC-WMS-026 — M1 roadmap defers to M2+ |
| **Release** mutation (UI row action) | 🔵 | `ReleaseReservationDialog`, TC-WMS-026 — same |
| `receive` API | 🔵 | Endpoint exists — receiving is M2 scope |
| `allocate` API | 🔵 | Endpoint exists — deeper allocation is M2+ |

### 3. Operational views (read-only)

| M1 requirement | Status | Evidence / notes |
|----------------|--------|------------------|
| Per SKU — "where it sits" | ✅ | `/backend/wms/sku/[id]`, TC-WMS-023/024 |
| Per location — "what's here" | ✅ | `/backend/wms/location/[id]` |
| Per lot — "what expires" | ✅ | `/backend/wms/lot/[id]`, list `/backend/wms/lots` |
| Expiry card (upcoming/past due) | ✅ | Operational dashboard |
| Dashboard: low stock, expiry, aging reservations, today's movements | ✅ | `WmsOperationalDashboardPage`, TC-WMS-DASHBOARD-001/UI-001 |
| Inventory console | ✅ | `/backend/wms/inventory` |

### 4. Permissions and audit

| M1 requirement | Status | Evidence / notes |
|----------------|--------|------------------|
| Operator / supervisor roles (seed) | ✅ | `setup.ts`, `lib/roleFeatures.ts` |
| Log of key changes | ⚠️ | Ledger (`InventoryMovement`) provides technical audit; **no dedicated operational audit view** for supervisors |
| In-app notifications (e.g. low stock) | ❌ | Event `wms.inventory.low_stock` emitted (`commands/inventory-actions.ts`), but `notifications.ts` is **empty** — no notification types or UI renderers |

### 5. Catalog integration

| M1 / Phase 1 requirement | Status | Evidence / notes |
|----------------------------|--------|------------------|
| Inventory profile widget on product | ✅ | `widgets/injection/catalog-inventory-profile` |
| `_wms.*` enrichers | ✅ | `data/enrichers.ts`, `enrichers.test.ts` |
| Profile sync from catalog | ✅ | `lib/catalogInventoryProfileSync.ts` |

### 6. Sales integration (M2 plan — delivered early)

The roadmap places **full sales integration** in Month 2. A significant portion is already on the branch:

| M2 requirement | Status on branch | Evidence / notes |
|----------------|------------------|------------------|
| Auto-reserve on `sales.order.confirmed` | 🔵 | `subscribers/sales-order-confirmed-reserve.ts`, TC-WMS-017 |
| Auto-release on `sales.order.cancelled` | 🔵 | `subscribers/sales-order-cancelled-release.ts`, TC-WMS-017 |
| Stock column on order line items | 🔵 | `order-items-stock-column`, TC-WMS-STOCK-COL-001/002/003 |
| Stock context on order card | 🔵 | `sales-order-stock-context` widget |
| Warehouse assignment on order | 🔵 | `SalesOrderWarehouseAssignment`, TC-WMS-004 |
| **Per-warehouse multi-warehouse breakdown** on order card | ⚠️ | Enrichment exists, but **full Warsaw/Kraków/Poznań breakdown** from the M2 scenario is not closed in UX |
| **Insufficient-stock UX** before fulfillment | ⚠️ | Partially via enrichment; no dedicated guardrail UX matching the M2 scenario |
| E2E UI test for sales widget on order card | ⚠️ | API/column tests exist; **no full E2E UI** of order card with visible shortfall |

---

## Compliance matrix — Phase 1 spec (technical)

| Spec area | Status | Notes |
|-----------|--------|-------|
| Entities: Warehouse, Zone, Location | ✅ | `data/entities.ts` |
| Entities: Profile, Lot, Balance, Reservation, Movement | ✅ | Complete |
| CRUD API + OpenAPI | ✅ | `makeCrudRoute`, `openApi` on routes |
| Commands: adjust, cycle-count, move, reserve, release, allocate, receive | ✅ | `commands/inventory-actions.ts` |
| Search config | ✅ | `search.ts` |
| WMS events | ✅ | `events.ts` — incl. `wms.inventory.low_stock` |
| ACL (9 features) | ✅ | `acl.ts` |
| i18n (en, pl, de, es) | ✅ | `i18n/*.json` |
| Backend UI (dashboard, console, config, detail views) | ✅ | Pages under `/backend/wms/*` |
| Catalog integration (widget + enricher) | ✅ | |
| Sales integration (enricher + widget + subscriber) | ✅ / 🔵 | Done, but goes beyond "backend-first without full sales integration" from phase description |
| In-app notifications | ❌ | Empty `notifications.ts` |
| Spec status | ⚠️ | Still **Draft** — not moved to `.ai/specs/implemented/` |
| Integration test coverage per spec | ✅ | 22 TC-WMS-* scenarios |

---

## Gaps — what is missing vs M1

### Must (blocks M1 closure per roadmap)

1. **In-app notifications for low stock** — event exists; missing `notificationTypes`, notification subscriber, and renderers in `notifications.client.ts`. Dashboard shows low stock, but there is no proactive alert for supervisors.

### Should (M1 operational quality)

2. **Dedicated operational audit view** — movements are in the ledger and movements list, but no consolidated "who/what/when" view for supervisors (roadmap requires "minimum auditability").
3. **Sales widget — SKU names instead of UUIDs** — stock column on order line items may show variant IDs instead of readable product names.
4. **Spec status** — Phase 1 remains Draft; no implementation changelog or move to `implemented/`.

### Could (nice-to-have before M1 demo)

5. **Consistent empty states** on detail views before first Adjust (roadmap expects correct empty states until M2).
6. **Written waiver documentation** for CSV import — if the first merchant has <2k SKUs, the roadmap requires an explicit written planning decision.

---

## Ahead of plan (scope creep)

The following items **were not required in Month 1** and belong to M2+ per `docs/wms/wms-roadmap-and-estimates-en.md`:

| Item | Planned month | Files / tests |
|------|---------------|---------------|
| Auto-reserve subscriber (`sales.order.confirmed`) | M2 | `subscribers/sales-order-confirmed-reserve.ts` |
| Auto-release subscriber (`sales.order.cancelled`) | M2 | `subscribers/sales-order-cancelled-release.ts` |
| Reservation automation (`salesOrderInventoryAutomation.ts`) | M2 | `lib/salesOrderInventoryAutomation.ts` |
| Stock context widget on order | M2 | `sales-order-stock-context` |
| Stock column in order line items table | M2 | `order-items-stock-column` |
| Warehouse assignment on order | M2 | TC-WMS-004 |
| Move / Release row actions in console | M2+ (explicit defer) | TC-WMS-026 |
| Receiving API (`receive`) | M2 (inbound) | `commands/inventory-actions.ts` |
| Extended operational dashboard with aging reservations | M1 partial + M2 | More than minimal M1 overview |

**Ahead-of-plan assessment:** positive for sales integration velocity, but **blurs the M1/M2 boundary** and makes quarterly progress reporting harder without this analysis.

---

## Test coverage

| Category | Count | Examples |
|----------|-------|----------|
| API / backend | 12+ | TC-WMS-001–003, 017–023, 025 |
| WMS UI | 6+ | TC-WMS-INVENTORY-UI-001, DASHBOARD-UI-001, IMPORT-UI-001, 024 |
| Sales integration | 5+ | TC-WMS-004, 017, STOCK-COL-001/002/003 |
| Row actions (M2+) | 1 | TC-WMS-026 |

**Test gap:** no dedicated E2E test of the full sales order card with per-warehouse breakdown and insufficient-stock UX (M2 Definition of Done scenario).

---

## Final verdict

### Month 1 (business)

The implementation **meets or exceeds** most M1 criteria:

- ✅ Warehouse structure, primary warehouse, locations
- ✅ Adjust + simple cycle count (production UI)
- ✅ CSV import
- ✅ Per SKU / location / lot views + expiry
- ✅ Operational dashboard
- ✅ RBAC operator/supervisor
- ⚠️ Operational audit (ledger yes, dedicated view no)
- ❌ In-app notifications (low stock)

**Estimate: ~85–90% M1.**

### Phase 1 (technical)

**Estimate: ~95%** — mainly missing the notifications layer and formal spec closure (Draft → implemented).

### Recommended next steps

1. Add `notificationTypes` + subscriber on `wms.inventory.low_stock` + UI renderer.
2. Consider a simple audit view (movements filter + actor/timestamp) or integration with `audit_logs`.
3. Fix SKU name display in sales widgets.
4. Move spec to `implemented/` with changelog and deployment date.
5. For issue #388: mark M2 items already done to avoid duplicate work in the next sprint.
6. Add E2E test for sales order card (M2 DoD scenario) — can be a separate PR under M2.

---

## Appendix — key repository paths

```
packages/core/src/modules/wms/
├── acl.ts                          # 9 RBAC features
├── setup.ts                        # operator/supervisor roles
├── events.ts                       # wms.inventory.low_stock
├── notifications.ts                # EMPTY — gap
├── commands/inventory-actions.ts   # adjust, cycle-count, move, reserve, release, allocate, receive
├── subscribers/
│   ├── sales-order-confirmed-reserve.ts   # M2+
│   └── sales-order-cancelled-release.ts   # M2+
├── widgets/injection/
│   ├── catalog-inventory-profile/
│   ├── sales-order-stock-context/         # M2+
│   └── order-items-stock-column/          # M2+
├── backend/wms/                    # dashboard, inventory, reservations, lots, detail views
├── backend/config/wms/             # warehouse configuration
└── __integration__/                # 22 TC-WMS-* files
```

---

## Report changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-06-06 | Cursor Agent | Initial version — M1 gap analysis vs branch `feat/388-wms-phase-1` @ `79fe0f515` |
| 2026-06-06 | Cursor Agent | English translation |
