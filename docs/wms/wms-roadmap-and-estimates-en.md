# WMS roadmap and time estimates 

## Module breakdown

Order is **dependency-aware** (foundations first).

| Module | Typical scope | Complexity |
|--------|----------------|------------|
| **Master data** | products/SKUs, UOMs, zones, location types, validation, optional imports | M |
| **Locations / slotting** | hierarchy, addressing, uniqueness, capacities, basic rules | M–L |
| **Inventory + reservations** | on-hand, allocated, available, concurrency | L–XL |
| **Inbound / receiving (ASN/GRN)** | headers/lines, discrepancies, posting | L |
| **Putaway** | directed tasks, priorities, confirmations | M–L |
| **Picking** | waves, paths, partial/short picks | L–XL |
| **Packing / shipping** | containers, labels, shipment close-out | M–L |
| **Cycle count / adjustments** | counts, variances, approvals, audit | L |
| **Replenishment** | thresholds, tasks from buffer to pick face | M–L |
| **Lots / serials / expiry (FEFO/FIFO)** | compliance-grade traceability | XL |
| **Integrations (first “serious” one)** | mappings, idempotency, retries, monitoring | L–XL |
| **Reports / KPI / exports** | operational dashboards and exports | M |

**Legend:** S = small, M = medium, L = large, XL = very large.

---


## Three-month forward plan

This quarter targets **foundations + one closed operational loop**: **receive → putaway → correct stock on the target location**. It does **not** promise a full enterprise WMS (wave picking, heavy lot control, production-grade carrier integration, etc.).

### Rule for “phase complete”

Each month ends with a **Definition of Done**: a short set of **acceptance scenarios** plus **minimum auditability** (who changed inventory state, when).

---

### Month 1 (weeks 1–4) — “The warehouse has a map and dictionaries”

**End state:** you can maintain warehouse structure and an operational catalog without full downstream processes yet.

- **Correct UX:** flows for master data and locations are **production-usable**—clear navigation, consistent patterns, sensible defaults, validation feedback, empty/loading/error states, and keyboard-friendly forms where applicable. This is not “placeholder UI”; it should be shippable for daily admin/warehouse lead use.
- **Operational views (read-only):** ship dependable **lookup** screens for day-to-day supervision:
  - **Per SKU:** “where it sits” — balances by location (and lot, if captured) for a chosen product.
  - **Per location:** “what’s here” — contents of a chosen bin/address.
  - **Per lot:** “what expires” — lot-level picture (quantities, locations, expiry dates when the model carries them).
  These views are built in Month 1; until **inventory movements / balances** exist (Month 2+), they correctly show **empty states** or seed/opening-balance data if you add that for demos.
- **Operations overview (dashboard):** a single landing view surfacing **low stock**, **upcoming / past expiry**, **aging reservations** (stuck or old holds), and **today’s movements** (receipts, transfers, adjustments—as soon as those event types exist in the ledger).
- **Master data (MVP):** products/SKUs, units, warehouse-relevant attributes (dimensions/weight only if you truly need them day one).
- **Locations (MVP):** zones, racks, addresses, uniqueness, simple location-type rules (e.g., pick vs bulk—even simplified).
- **Permissions + audit (minimum):** operator vs supervisor roles, log of key changes.

**Phase complete:** *Warehouse structure + catalog + solid UX + operational visibility* — demo: create site, create locations, add SKUs, assign basic rules; open per-SKU / per-location / per-lot views and the overview (meaningful tiles populate as soon as stock and movements exist; empty states are acceptable at the end of Month 1 if inventory is not live yet).

---

### Month 2 (weeks 5–8) — “There is stock and inbound works”

**End state:** receiving creates inventory movements and updates availability.

- **Inventory (MVP):** `on-hand` per location to start; defer complex reservation models or keep a single simple reservation model if unavoidable.
- **Receiving (light ASN/GRN):** header + lines, statuses (e.g., draft → posted), minimum discrepancy handling (e.g., note + quantity correction before posting).
- **Documents:** numbering; optional basic print/PDF (not required to be perfect).

**Phase complete:** *Posted receipt increases stock* — scenario: receive two lines to a target location; reopening shows correct balances.

---

### Month 3 (weeks 9–13) — “Stock lands where it should” + optional picking stub

**End state:** close the loop **receive → putaway → stock on final location**; picking only as a **plan/placeholder** or an **ultra-MVP** if capacity remains.

- **Putaway (MVP):** tasks/lines from inbound staging to final locations, confirmation (scan or manual, depending on hardware).
- **Reservations (optional):** only if month 3 truly requires sales-order linkage; otherwise defer to the next quarter.
- **Picking (optional end of month 3):** single pick list, one strategy (e.g., FIFO by receipt time), **no** waves and **no** route optimization.

**Phase complete:** *Inbound → putaway → correct stock on destination* — end-to-end scenario on one SKU and two locations.

---

## Explicitly *out* of the 3-month slice (keep backlog honest)

- Full **picking** (waves, partial/short, route optimization)
- **Packing/shipping** with production carrier integrations
- **Cycle counting** with full approval workflows
- Production-grade **replenishment**
- **Lots/serials/expiry** at enterprise compliance depth
- **Heavy ERP integration** (a thin import/export skeleton may be possible, but not “ERP-grade” integration in this window)

