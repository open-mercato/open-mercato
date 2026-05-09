# WMS roadmap and time estimates 

## Module breakdown

Order is **dependency-aware** (foundations first).

| Module | Typical scope | Complexity |
|--------|----------------|------------|
| **Master data** | products/SKUs, UOMs, zones, location types, validation, imports (CSV at scale) | M |
| **Locations / slotting** | hierarchy, addressing, uniqueness, capacities, basic rules, **primary warehouse** policy | M–L |
| **Inventory + reservations** | on-hand, allocated, available, concurrency | L–XL |
| **Sales ↔ WMS (commerce minimum)** | per-warehouse availability on orders, reserve/release automation, insufficient-stock UX | L |
| **Inbound / receiving (ASN/GRN)** | headers/lines, discrepancies, posting | L |
| **Putaway** | directed tasks, priorities, confirmations | M–L |
| **Picking** | waves, paths, partial/short picks | L–XL |
| **Packing / shipping** | containers, labels, shipment close-out | M–L |
| **Cycle count / adjustments** | counts, variances, **simple** posting vs full approval workflows | L |
| **Replenishment** | thresholds, tasks from buffer to pick face | M–L |
| **Lots / serials / expiry (FEFO/FIFO)** | compliance-grade traceability | XL |
| **Integrations (first “serious” one)** | mappings, idempotency, retries, monitoring | L–XL |
| **Reports / KPI / exports** | operational dashboards and exports | M |

**Legend:** S = small, M = medium, L = large, XL = very large.

---


## Three-month forward plan

This quarter targets **foundations + one closed operational loop**: **receive → putaway → correct stock on the target location**. It does **not** promise a full enterprise WMS (wave picking, heavy lot control, production-grade carrier integration, etc.).

**Commerce coherence:** WMS must not ship as “another module beside” `sales`. A **minimum sales integration** is in scope for the quarter (see Month 2): multi-warehouse visibility on the order, deterministic default warehouse for automation, reserve/release tied to order lifecycle, and insufficient-stock UX **before** the customer calls.

### Rule for “phase complete”

Each month ends with a **Definition of Done**: a short set of **acceptance scenarios** plus **minimum auditability** (who changed inventory state, when).

---

### Month 1 (weeks 1–4) — “The warehouse has a map and dictionaries”

**End state:** you can maintain warehouse structure and an operational catalog, **bootstrap stock without CSV-only opening balances**, and expose **lot/expiry** visibility for FMCG-style operations—while wiring the **policy** that makes Month 2 sales automation deterministic.

- **Correct UX:** flows for master data and locations are **production-usable**—clear navigation, consistent patterns, sensible defaults, validation feedback, empty/loading/error states, and keyboard-friendly forms where applicable. This is not “placeholder UI”; it should be shippable for daily admin/warehouse lead use.
- **Operational views (read-only):** ship dependable **lookup** screens for day-to-day supervision:
  - **Per SKU:** “where it sits” — balances by location (and lot, if captured) for a chosen product.
  - **Per location:** “what’s here” — contents of a chosen bin/address.
  - **Per lot:** “what expires” — lot-level picture (quantities, locations, expiry dates when the model carries them).
  - **Expiry card:** a compact **summary of upcoming and past-due expiry** (drives value for **food, cosmetics, FMCG** alongside per-lot drill-down).
  These views are built in Month 1; until **inventory movements / balances** exist (Month 2+), they correctly show **empty states** or data entered via **Adjust** / opening-balance flows below.
- **Operations overview (dashboard):** a single landing view surfacing **low stock**, **upcoming / past expiry** (aligned with the expiry card), **aging reservations** (stuck or old holds), and **today’s movements** (receipts, transfers, adjustments—as soon as those event types exist in the ledger).
- **Primary warehouse policy:** persist **`Warehouse.is_primary`** (or equivalent) per tenant/org scope so subscribers and defaults know **which warehouse to target first** for reserves and projections. Document explicitly that **rich allocation rules** (channel, region, cost) are later; this flag is the **MVP discriminator** so sales integration is not “random multi-warehouse.”
- **Inventory mutation UI (minimum in M1):**
  - **Adjust:** production UI for adjustments used for **opening balances** and day-to-day corrections—avoid “API-only or CSV-only” bootstrap.
  - **Cycle count:** a **simple 3-step** flow (count → variance → post) for a **single role**, **without** multi-step approval workflows. This is a **central daily** operator pattern at minimal scope.
  - **Deferred to Month 2+:** **Move** and **release** as row-level actions (and other advanced mutation surfaces) unless capacity remains—Adjust + simple cycle count take priority.
- **Master data (MVP):** products/SKUs, units, warehouse-relevant attributes (dimensions/weight only if you truly need them day one).
- **Locations (MVP):** zones, racks, addresses, uniqueness, simple location-type rules (e.g., pick vs bulk—even simplified).
- **CSV bulk import (bootstrap):** do **not** treat as universally optional. For **large catalogs (e.g. 10k+ SKUs)** it is a **hard blocker** for go-live; for **first merchants above an agreed threshold (e.g. > ~2k SKUs)** treat import as **must-have** in the same window. Record the **designated first merchant** and SKU scale in planning so the quarter commits either a **thin CSV MVP** (validate → report → apply) or a scoped alternative (API bulk) explicitly.
- **Permissions + audit (minimum):** operator vs supervisor roles, log of key changes.

**Phase complete:** *Warehouse structure + catalog + solid UX + operational visibility (including lot/expiry) + primary warehouse + Adjust + simple cycle count + import decision tied to first merchant scale* — demo: configure warehouses with one primary, create locations/SKUs, post an opening balance via Adjust, run a short cycle count, show per-SKU / per-location / per-lot + expiry card + overview; import path exists or is explicitly waived with written scale assumption.

---

### Month 2 (weeks 5–8) — “There is stock, inbound works, and sales sees the warehouse”

**End state:** receiving creates inventory movements and updates availability; **`sales` is integrated end-to-end** for the minimum commerce surface (not a disconnected WMS).

- **Inventory (MVP):** `on-hand` per location; reservation model consistent with **auto-reserve / release** below; concurrency-safe mutations.
- **Receiving (light ASN/GRN):** header + lines, statuses (e.g., draft → posted), minimum discrepancy handling (e.g., note + quantity correction before posting).
- **Documents:** numbering; optional basic print/PDF (not required to be perfect).
- **Sales integration (minimum viable — all three):**
  1. **Multi-warehouse breakdown on the order card:** sales users see **availability per warehouse** (e.g. Warsaw 50 / Kraków 30 / Poznań 0), not only a single rolled-up number—via **additive `_wms.*` enrichment** (or equivalent contract) on opted-in `sales` routes.
  2. **Auto-reserve + auto-release:** on **`sales.order.confirmed`** (or the canonical confirmed event for your order lifecycle), **reserve** stock against the **primary** warehouse policy unless a later rule overrides; on **order cancellation** (full or as agreed for partials), **release** reservations **idempotently** with clear ordering vs line edits. Wire the existing **subscriber** path **end-to-end** (not “present in a PR” only).
  3. **Insufficient-stock UX on the order card:** surface **shortfalls before fulfillment** so the sales user sees gaps **before the customer calls** (ties into the same enrichment / guardrails as reservation failures).

**Phase complete:** *Posted receipt increases stock **and** a confirmed order shows per-warehouse stock, reserves on confirm, releases on cancel, and blocks/flags insufficient stock with visible UX* — scenario: two warehouses, primary set, confirm order with lines that fit one warehouse but not the other; UI and behavior match expectations.

---

### Month 3 (weeks 9–13) — “Stock lands where it should” + optional picking stub

**End state:** close the loop **receive → putaway → stock on final location**; picking only as a **plan/placeholder** or an **ultra-MVP** if capacity remains.

- **Putaway (MVP):** tasks/lines from inbound staging to final locations, confirmation (scan or manual, depending on hardware).
- **Picking (optional end of month 3):** single pick list, one strategy (e.g., FIFO by receipt time), **no** waves and **no** route optimization.
- **Deeper sales allocation (optional):** only if time remains—e.g. explicit per-line warehouse picks, channel-specific rules—**without** replacing the Month 2 minimum trio above.

**Phase complete:** *Inbound → putaway → correct stock on destination* — end-to-end scenario on one SKU and two locations, with Month 2 sales visibility still accurate after physical moves.

---

## Explicitly *out* of the 3-month slice (keep backlog honest)

- Full **picking** (waves, partial/short, route optimization)
- **Packing/shipping** with production carrier integrations
- **Cycle counting** with **full** multi-step **approval** workflows and blind-count / segregation complexity (Month 1 ships a **simple** cycle count only)
- Production-grade **replenishment**
- **Lots/serials/expiry** at **enterprise compliance** depth (Month 1–2 ship **visibility** and model hooks; not full regulatory/traceability suite)
- **Heavy ERP integration** (a thin import/export skeleton may be possible, but not “ERP-grade” integration in this window)
- **Rich allocation** beyond **primary warehouse** (regions, channels, cost-optimized sourcing)—explicit follow-up after the MVP policy
