# Property Management

| Field | Value |
|-------|-------|
| **Status** | Specification — approved, ready for implementation |
| **Created** | 2026-10-15 |
| **Module** | `property_management` (new, `packages/core/src/modules/property_management`) |
| **Touches** | `planner` (export one helper, additive), `catalog` (enricher + form-field widget, additive), `sales` (commands consumed), `customer_accounts` / portal (pages, nav, notifications), `scheduler` (optional peer), `dictionaries` |
| **Source** | Clickable prototype `.ai/prototypes/property-management/` (44 screens) and `.ai/prototypes/property-management.requirements.md` (Epics A–K, US-A1 … US-K1) |

## TLDR

**Key Points:**
- A core module for operators of leased and bookable space (coworking, serviced offices). It models **buildings → floors → spaces → units** in metres, draws them to scale, and runs the two ways a unit earns money — **leases** (billed monthly on a schedule) and **bookings** (charged per booking) — with the customer-portal side of both.
- Units are typed and priced by the existing **catalog**: type = category, product = product, and whether a unit is leased or booked is a property of its **product**. Leases and bookings **snapshot the product and price** they were made at; units keep a **product history**, leases a **version history**, and both stay consistent with the `sales` documents that bill them.

**Scope:**
- Property structure: buildings (optional opening hours, availability, archive), floors (size, numbering with ground floor 0, laid out from below/above-ground counts), spaces (non-overlapping rectangles, one default space per floor), units (size + position, drag-and-drop placement, product history), common areas.
- Availability on building / floor / space / unit, inherited downwards: blocks new leases and bookings, **cancels bookings** in the period (customers notified), **flags leases** "Unit unavailable".
- Floor plan (to-scale status view) and floor setup pages.
- Leases: draft → active → ended; product snapshot; version history; extension offers answered in the portal; **scheduled monthly invoicing** through the sales Quote → Order → Invoice flow.
- Bookings: product + price snapshot; only within opening hours and outside unavailable periods; a **sales order per confirmed booking**.
- Customer portal: my bookings, book (review shows the unit on its floor), my lease + extension offer, bell notifications.

**Out of scope (separately specified or deferred):** credits; payment collection; rent escalation, deposits, proration beyond calendar-month periods; uploaded floor-plan backgrounds; non-rectangular geometry; the portal's access, events, invoices, support and extras sections.

**Concerns:**
- The module is large; it ships in seven phases, each independently usable (Implementation Plan).

---

## Overview

Operators of flexible workspace sell one building two ways: units leased for months (private offices, company units, parking spaces, dedicated desks) and units booked by the hour or day (meeting rooms, flex desks). Open Mercato has the CRM, the catalog and sales, but no notion of *where* something is sold, how a building is divided, or which unit is occupied or booked today. This module adds that layer for building managers (backoffice) and for tenants and members (customer portal).

> **Market Reference:**
> - **LibreBooking** (OSS resource booking) — blackouts that collide with reservations offer *delete / skip / reject* and notify affected users. **Adopted:** unavailability cancels bookings and notifies. **Rejected:** *reject* — a manager closing a floor for a leak must win; *skip* leaves bookings in a closed room.
> - **Seatsurfing** (OSS desk booking) — drag-and-drop desks on an uploaded floor-plan image. **Adopted:** drag-and-drop placement. **Rejected (deferred):** image-based geometry — this module stores metres so scale, fit and overlap can be validated; a background image is a later layer on top.
> - **ERPNext real-estate apps** (Frappe) — a scheduler issues a Sales Invoice per lease billing cycle; escalation, proration and deposits on the contract. **Adopted:** scheduled invoicing against the existing sales documents. **Deferred:** escalation, deposits, partial-month proration rules beyond whole calendar months.

## Problem Statement

- **No spatial model.** Nothing records buildings, floors, how a floor is divided, or the units on it, so occupancy and availability live in spreadsheets and nobody can check a layout fits.
- **Leasing and booking are disconnected from the catalog and from sales.** What a unit *is* and costs should come from the catalog; what was sold must survive later catalog changes; and the invoices a tenant receives must agree with their lease.
- **Closures are manual.** Taking a building, floor or space out of use means hand-cancelling bookings and remembering which tenants are affected.
- **No self-service.** Tenants and members cannot book, see their lease or answer an extension offer without contacting the manager.

## Proposed Solution

A single core module, `property_management`, delivered in seven phases (structure → leases → bookings → availability → invoicing → floor plan → portal). It owns the spatial model, availability, leases, bookings and their portal pages; it **references** catalog products/categories, CRM companies/people and sales documents by FK id, and reaches other modules only through their commands, events, enrichers and widget injection.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| One umbrella spec, phased (Q1 = A) | The capabilities share one data model (unit) and one availability resolver; phasing keeps each step shippable. |
| Lives in `packages/core/src/modules/property_management` (Q2 = A) | Official modules are being consolidated into core. |
| Module id `property_management` (Q7) | Domain noun; precedent for non-plural ids: `planner`, `sales`, `catalog`, `wms`, `staff`, `inbox_ops`, `data_sync`. Entities, events and commands stay singular. |
| Own schedule tables in **planner's rule format** (Q3 = B) | Planner's `subject_type` enum is fixed (`member|resource|ruleset`); storing `rrule`/`kind`/`exdates` rows lets this module call planner's `getMergedAvailabilityWindows` and `parseAvailabilityRuleWindow` unchanged. Planner gains one exported helper (`buildWeeklyRrule`), additive. |
| Own bookings table, not `resources` (Q4 = B) | `resources` serves staff-schedulable resources; units need geometry, product snapshots and lease/booking exclusivity. |
| Geometry in metres, rectangles only | Validatable (fit, overlap) and drawn to scale; matches the prototype. Non-rectangular shapes deferred. |
| Leasable/bookable is a **product** property stored in a module-owned mapping (`ProductUse`) | Catalog categories are hierarchical and one category can hold both kinds (Open space: flex desk vs dedicated desk); catalog has no such flag and must not gain module-specific columns. Exposed on products via a response enricher (eudr/wms precedent). |
| Lease billing via **Quote → Order → Invoice** | Activating a lease creates a quote converted to an order (one line: the product, quantity = months, unit price = monthly rate); the scheduler invoices one month at a time against that order. Fully within the sales flow; the order line carries the product, so invoices agree with the lease version by construction. |
| **Order per confirmed booking** | One `sales.orders.create` per booking (product + price snapshot). Orders without a source quote are a supported path: `orderCreateSchema` has no quote reference, the backoffice creates orders directly (`/backend/sales/documents/create?kind=order`), and `warranty_claims` does the same from code. |
| Unavailability **cancels bookings, flags leases** | Bookings in the period are cancelled with notification; leases are never ended by it — they are flagged "Unit unavailable" until the period ends. |
| Spaces as partitions | Spaces never overlap; resizing never moves units; a layout with any unit outside its space cannot be saved. |
| Bookings: per-unit row lock, not a DB exclusion constraint | Avoids the `btree_gist` extension dependency; overlap is checked inside the booking command under `SELECT … FOR UPDATE` on the unit. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Extend planner subjects to building/floor/space/unit | Planner's subject enum and reason dictionaries are frozen contracts; extending them couples planner to this domain. Code reuse achieves the same with zero contract change. |
| Units as `resources` resources | Different use case (staff scheduling); would drag capacity units, comments and tags in and still lack geometry. |
| Direct invoices without an order | Skips Quote → Order; invoice lines carry no product reference, so lease ↔ invoice consistency would rely on metadata. |
| Floor plan as an image with hotspots | No scale, no fit/overlap validation, no to-scale portal map. |

## User Stories / Use Cases

The prototype's requirements are the authoritative story list (`.ai/prototypes/property-management.requirements.md`). Mapping to this spec:

| Stories | Capability | Phase |
|---------|-----------|-------|
| US-D1 … D4, D7, US-G1 … G7, G9 | Buildings, floors, spaces, units, common areas, archive | 1 |
| US-E1 … E6, US-K1 | Leases, versions, extension offers, settings | 2 |
| US-F1, US-G7 (booking side) | Bookings, product/price snapshot | 3 |
| US-D5, US-D6, US-G8, availability switches | Opening hours, availability cascade | 4 |
| US-E6 (invoices), §Lease product and history | Scheduled lease invoicing | 5 |
| US-A1 … A3, US-B1 … B3, US-C1 … C3 | Floor plan status view | 6 |
| US-H1 … H4, US-I1 … I4, US-J1 … J2 | Customer portal | 7 |

## Architecture

### Module layout (auto-discovered)

```
packages/core/src/modules/property_management/
  index.ts  acl.ts  setup.ts  di.ts  events.ts  notifications.ts  notifications.client.ts
  ce.ts  encryption.ts  search.ts  translations.ts
  data/{entities.ts, validators.ts, enrichers.ts, extensions.ts}
  lib/{geometry.ts, floorNumbering.ts, availabilityResolver.ts, bookingSlots.ts, leasePeriods.ts, productUse.ts}
  commands/{building.ts, floor.ts, space.ts, unit.ts, common-area.ts, availability.ts, lease.ts, lease-extension.ts, lease-billing.ts, booking.ts}
  api/…          (makeCrudRoute + custom routes, each exporting openApi)
  backend/…      (pages + page.meta.ts)
  frontend/[orgSlug]/portal/…   (portal pages + page.meta.ts)
  widgets/injection/…           (catalog product form field)
  workers/{lease-invoicing.ts, booking-sweep.ts}
  subscribers/…  i18n/…  migrations/…  __integration__/…
```

### Components

| Component | Responsibility |
|-----------|----------------|
| `lib/geometry.ts` (pure) | `fitsInside(rect, container)`, `overlaps(a, b)`, `firstConflicts(rect, others)`; 0.01 m tolerance; used by commands **and** the drag-and-drop editor (same rules client and server). |
| `lib/floorNumbering.ts` (pure) | `layoutFloors(below, above)` → numbers −below…−1, 0…above−1; `minimumCounts(floors)` from floors that still hold units. |
| `lib/availabilityResolver.ts` | Effective availability of a unit at a time range = its own unavailability ∪ its space's ∪ floor's ∪ building's; building archived ⇒ unavailable. Feeds the "Unit unavailable" lease flag, slot computation and booking guards. |
| `lib/bookingSlots.ts` | Bookable windows for a unit and date = planner `getMergedAvailabilityWindows` over the building's opening-hours rules, minus unavailability ranges, minus confirmed bookings. No opening hours ⇒ whole day. |
| `lib/leasePeriods.ts` (pure) | Calendar-month billing periods for a lease version; first/last periods cut at the lease's start/end dates. |
| `lib/productUse.ts` | Resolves a product's use (`leasable|bookable`) and billing unit; products eligible for a category = direct assignments of the category **and its descendants** (`descendant_ids`). |
| Workers | `property_management.lease_invoicing` (daily, concurrency 1): issues due invoices, ends leases past `ends_on`, expires unanswered extension offers. `property_management.booking_sweep` (every 15 min): completes past bookings, sends reminders once (`reminder_sent_at`). `property_management.unavailability_apply`: cancels bookings for large unavailability sets in chunks of 100. Scheduled through the optional `schedulerService` in `setup.ts` `seedDefaults` (warranty_claims pattern: stable UUID ids, `try/catch`). |
| Time | Every calendar computation — opening hours, slots, "today", billing periods, lease end, offer deadlines — uses the **building's timezone**. |

### Commands & Events

All mutations are commands (singular ids). Undo is specified per command; side effects that cannot be undone are listed.

| Command | Undo | Non-reversible side effects |
|---------|------|-----------------------------|
| `property_management.building.create / update / delete` | delete / restore snapshot / restore (delete allowed only for a building with no lease or booking ever) | — |
| `property_management.building.archive` | none — archiving is final by design (US-D7); blocked while active leases or upcoming bookings exist | — |
| `property_management.floor.layout_replace` (counts + names + sizes) | restore previous floor set; refused if a removed floor held units, or a resized floor would leave a space, unit or common area outside it | — |
| `property_management.space.create / update / delete` | inverse; update refused if any unit would fall outside | — |
| `property_management.unit.create / update / delete` | inverse; delete refused while leases/bookings exist | — |
| `property_management.unit.product_change` | close the new history period, reopen the previous; refused (409) while an active lease exists, and when the new product's use is `leasable` while confirmed future bookings exist | — |
| `property_management.common_area.create / update / delete` | inverse | — |
| `property_management.unavailability.create` (compound) | remove the row; **cancelled bookings are not restored** — the slots may have been rebooked, and customers were already told | booking cancellations, customer notifications, sales order status changes |
| `property_management.unavailability.end` (make available) | re-create the row | — |
| `property_management.lease.create / update / delete` | inverse (delete never ends a tenancy; invoices survive). `update` on an active lease writes a `corrected` version and updates the lease order line via `sales.orders.lines.upsert` (unit price, quantity = remaining + invoiced months); issued invoices are untouched; undo restores the previous version and line while no invoice was issued since | — |
| `property_management.lease.activate` (compound) | dispatch `sales.orders.delete` + `sales.quotes.delete` (scrubbed ctx), revert status — only while no invoice was issued | — |
| `property_management.lease.end` (early or at term) | revert status and the order line quantity | the order line quantity is reduced to the invoiced months via `sales.orders.lines.upsert` |
| `property_management.lease.extend` (manager records the signed agreement for an accepted offer) | delete the extension quote/order and the `extended` version while uninvoiced | — (creates a new quote → order for the extension term; the lease's `ends_on` and current version move) |
| `property_management.lease_extension.offer / withdraw` | withdraw / re-offer | customer notification |
| `property_management.lease_extension.answer` (portal; accept/decline) | none — it is the customer's statement, not a state the manager may revert; a declined offer stays acceptable until its deadline, and acceptance changes nothing until `lease.extend` | manager notification |
| `property_management.lease_extension.expire` (worker) | none — time-based | — |
| `property_management.lease_billing.issue` (worker) | none — an issued invoice is corrected with a credit memo in sales | invoice. Sequence: insert the period row as `pending` (the unique key is the claim) → `sales.invoices.create` with `metadata.propertyManagementBillingPeriodId` → mark `issued`. A retry finding a `pending` row first looks up an invoice by that metadata key and only creates one if none exists (crash-safe, no duplicates, no orphans) |
| `property_management.booking.create` (compound) | cancel the booking and set its order to the cancelled status | customer notification |
| `property_management.booking.cancel` | none — the customer has been notified and the slot released for others; rebooking is the recovery | notification; the booking's order is moved to the sales order status entry configured as cancelled (`sales.orders.update` with `statusEntryId`), or deleted with `sales.orders.delete` when it has no invoice or payment |

Child sales commands are dispatched with a scrubbed context (no `request`), as `warranty_claims` does, so the parent's optimistic-lock header never reaches them.

**Events** (`createModuleEvents`, `module.entity.action`, past tense) — frozen once released:
`property_management.building.{created,updated,archived,deleted}`, `.floor.{created,updated,deleted}`, `.space.{created,updated,deleted}`, `.unit.{created,updated,deleted,product_changed}`, `.common_area.{created,updated,deleted}`, `.unavailability.{created,ended}`, `.lease.{created,updated,activated,extended,ended,deleted,invoice_issued,invoice_failed}`, `.lease_extension.{offered,withdrawn,accepted,declined,expired}`, `.booking.{created,cancelled,completed}`. `portalBroadcast: true` on `booking.created`, `booking.cancelled`, `lease_extension.offered`.

**Notifications** (`notifications.ts`): portal recipients — `property_management.booking.reminder`, `.booking.cancelled`, `.lease_extension.offered`; staff recipients — `.lease_extension.answered`, `.lease.invoice_failed`. Portal notifications are `Notification` rows whose recipient is the customer user (as read by `customer_accounts/api/portal/notifications.ts`).

### Cross-module touchpoints

| Peer | Mechanism | Owner of the glue | Peer absent |
|------|-----------|-------------------|-------------|
| `catalog` | FK ids (`catalog_category_id`, `catalog_product_id`); `catalogPricingService` for prices; response enricher on `catalog_product` (use, billing unit); CrudForm field widget on spot `crud-form:catalog.product:fields` (`catalog/extension-points.ts`) | this module | catalog is a hard dependency (units cannot exist without a product) — declared in `index.ts` |
| `customers` (CRM) | FK ids (tenant company, contact person, booking person) | this module | hard dependency (core) |
| `sales` | `commandBus.execute('sales.quotes.create' → 'sales.quotes.convert_to_order' → 'sales.invoices.create')`, `sales.orders.create`, `sales.orders.update/delete` | this module | hard dependency (core) |
| `planner` | **direct core-to-core import** of `lib/availabilityMerge`, `lib/availabilitySchedule`, new exported `lib/weeklyRrule` (moved from the private `buildWeeklyRrule`) and the weekly schedule editor component — accepted deliberately: pure functions and UI with no data access, the same way `resources` and `staff` import them today | this module | hard dependency (core) |
| `scheduler` | `schedulerService.register(...)` in `seedDefaults` | this module | soft-optional: `hasRegistration` + `try/catch`; without it the workers can be run from the CLI (`mercato property_management billing:run`) and a banner on the leases page says automatic billing is off |
| `customer_accounts` / portal | portal pages + `page.meta.ts` nav, `defaultCustomerRoleFeatures`, `CustomerUser.customerEntityId` → tenant company | this module | portal pages simply not reachable |
| `dictionaries` | `property_management.unavailability-reasons` dictionary seeded in `setup.ts` | this module | — |

## Data Models

All tables `property_management_*`, UUID PKs, `organization_id` + `tenant_id` on every row, `created_at`, `updated_at` (optimistic locking, default ON), `deleted_at` where soft-deletable. Lengths in metres: `numeric(7,2)`; positions are a rectangle's top-left corner from the floor's top-left. Only the unique fields are listed.

### Building
`name`, `address` (text), `timezone` (IANA, default org timezone), `status` (`active|archived`), `archived_at`, `opening_hours_enabled` (bool). Index `(organization_id, status)`.

### Floor
`building_id`, `number` (int; ground = 0, below ground negative), `name`, `size_x`, `size_y`. Unique `(building_id, number)` where not deleted. Floor counts (below/above ground) are derived, never stored.

### Space
`floor_id`, `name`, `purpose` (text, nullable), `x`, `y`, `width`, `depth`, `is_default` (bool). Invariant: inside the floor, no overlap with other spaces of the floor. Every floor is created with one default space covering it.

### Unit
`floor_id`, `space_id`, `name`, `catalog_category_id`, `catalog_product_id`, `x`, `y`, `width`, `depth`. Invariants: fully inside its space; no overlap with another unit or common area of the floor; product assigned to the category or one of its descendants. Indexes `(organization_id, floor_id)`, `(organization_id, space_id)`, `(organization_id, catalog_product_id)`.

### UnitProductPeriod (append-only)
`unit_id`, `catalog_product_id`, `product_name`, `use` (`leasable|bookable`), `billing_unit` (`month|hour|day`), `price_amount`, `currency_code`, `price_kind_id`, `valid_from`, `valid_to` (nullable = current). Exactly one open period per unit (partial unique index).

### CommonArea
`floor_id`, `name`, `kind` (`corridor|kitchen|toilets|lobby|stairs_lifts|storage|other`), `x`, `y`, `width`, `depth`. Inside the floor; no overlap with units or other common areas; spaces may overlap it.

### ProductUse
`catalog_product_id` (unique per organization), `use` (`leasable|bookable`), `billing_unit` (`month` for leasable; `hour|day` for bookable).

### ScheduleRule (planner rule shape)
`building_id`, `rrule` (planner format `DTSTART…\nDURATION…\nRRULE:FREQ=WEEKLY;BYDAY=…`), `timezone`, `kind` (`availability` — opening hours). One row per open weekday window, written by `buildWeeklyRrule`. Ignored when the building's `opening_hours_enabled` is false.

### Unavailability
`subject_type` (`building|floor|space|unit`), `subject_id`, `reason_entry_id` (dictionary), `reason_text`, `starts_at`, `ends_at` (nullable = open-ended), `ended_at` (set when made available early), `cancelled_booking_count`, `apply_status` (`applied|applying`). Index `(organization_id, subject_type, subject_id, starts_at)`. `subject_id` is polymorphic, so the command loads the subject with the caller's `organization_id` before inserting — never trusts the id alone.

### Lease
`reference` (unique per org, `L-YYYY-NNN`, issued from a per-organization counter row locked `FOR UPDATE`), `unit_id`, `customer_company_id`, `primary_contact_person_id`, `status` (`draft|active|ended`), `starts_on`, `ends_on`, `current_version_id`, `sales_quote_id`, `sales_order_id`. Active leases of one unit **must not have overlapping terms** (checked under the unit row lock) — so the next tenant's lease can be signed while the current one runs. Activation also fails while confirmed bookings fall inside the term. "Unit unavailable" is **derived** (resolver) and returned by the list API, filterable. Index `(organization_id, unit_id, status)`.

### LeaseVersion (append-only)
`lease_id`, `version_no`, `event` (`drafted|activated|corrected|extended`), `catalog_product_id`, `product_name`, `monthly_rate`, `currency_code`, `starts_on`, `ends_on`, `sales_order_id`, `sales_order_line_id`, `effective_from`. The product is copied from the unit's open `UnitProductPeriod` at draft time and frozen at activation.

### LeaseExtensionOffer
`lease_id`, `starts_on`, `ends_on`, `monthly_rate`, `currency_code`, `message` (encrypted), `respond_by`, `status` (`sent|accepted|declined|withdrawn|expired`), `answered_at`, `answered_by_customer_user_id`. Partial unique: one `sent` offer per lease.

### LeaseBillingPeriod (idempotency ledger)
`lease_id`, `lease_version_id`, `period_start`, `period_end`, `amount`, `status` (`pending|issued|failed`), `sales_invoice_id`, `attempts`, `last_error`. **Unique `(lease_id, period_start)`** — the worker's claim and idempotency key; see `lease_billing.issue` for the crash-safe sequence.

### Booking
`unit_id`, `customer_company_id` (nullable for members), `booked_by_person_id`, `customer_user_id` (nullable — backoffice-made bookings), `starts_at`, `ends_at`, `status` (`confirmed|completed|cancelled`), `cancel_reason` (`customer|manager|unavailability`), `unavailability_id`, `catalog_product_id`, `product_name`, `unit_price`, `quantity`, `billing_unit`, `total_amount`, `currency_code`, `sales_order_id`, `reminder_sent_at`, `notes` (encrypted). Indexes `(organization_id, unit_id, starts_at)`, `(organization_id, customer_user_id, starts_at)`, `(organization_id, status, starts_at)`.

**Booking rules (MVP):** slots start on the hour; an hourly booking is 1–10 whole hours, quantity = hours; a daily booking (flex desk) is one day from opening to closing, quantity 1; a booking never crosses midnight or the building's opening hours; price = `catalogPricingService` price for the product × quantity, snapshotted. Customers may cancel until the booking starts; no cancellation fee in this iteration.

### Encryption (`encryption.ts`)
`Booking.notes`, `LeaseExtensionOffer.message` — free text written to or about people. Read through `findWithDecryption`. Building addresses are business addresses, not personal data.

### Custom entities (`ce.ts`)
`property_management:building`, `:unit`, `:lease` declared so operators can add custom fields.

## API Contracts

Standard CRUD (`makeCrudRoute`, zod, `openApi`, `updatedAt` in responses, `pageSize ≤ 100`) for `buildings`, `floors`, `spaces`, `units`, `common-areas`, `product-uses`, `leases`, `bookings` (list + detail; create/cancel are custom). Only non-CRUD contracts are listed.

### `POST /api/property_management/buildings/{id}/floors/layout`
`{ below: int ≥ 0, above: int ≥ 1, floors: [{ number, name, sizeX, sizeY }] }` → `200 { floors }`. `422` with `{ minimumAbove, minimumBelow, blockingFloor }` when a removed floor still holds units. Optimistic lock on the building.

### `GET /api/property_management/floors/{id}/layout?date=YYYY-MM-DD`
One call for the floor plan and setup pages: floor, spaces, units (with product, use, own + inherited availability), common areas, and — when `date` is given — per-unit status (`occupied|available|unavailable|booked|free`, lease end and days left, today's bookings). Expected query count: 6, independent of unit count.

### `POST /api/property_management/unavailabilities?dryRun=true|false`
`{ subjectType, subjectId, reasonEntryId?, reasonText: string(1..200), startsAt, endsAt?, previewToken? }`. Dry run → `200 { units, bookingsToCancel: [{id, unit, startsAt, person}], leasesToFlag: [{id, reference, company, unit}], previewToken }` (`previewToken` = hash of the affected booking ids). Confirm must send the `previewToken`; if the affected set changed since the preview → `409 preview_stale` and the dialog re-previews. Confirm → `201 { id, cancelledBookings, flaggedLeases, applyStatus }`: up to 200 bookings are cancelled in the request; more are queued to `unavailability_apply` (chunks of 100, progress in the top bar) while the unavailability row itself takes effect immediately, so no new booking can land in the window. `409` when the subject is archived. Requires `property_management.availability.manage`.

### `POST /api/property_management/unavailabilities/{id}/end` → `200` (make available now).

### `GET /api/property_management/units/{id}/slots?date=YYYY-MM-DD`
`{ openingHours: [{start, end}] | null, slots: [{ start, end, state: 'free'|'booked' }], price: { amount, currency, billingUnit } }`. Backoffice and portal (portal variant scoped to bookable units).

### `POST /api/property_management/units/{id}/product`
`{ catalogProductId }` → closes the open product period and opens a new one. `409` while the unit has an active lease (product locked); allowed with upcoming bookings.

### `POST /api/property_management/leases/{id}/activate` · `/end`
Activate creates the sales quote and order (see Commands). `422` if the unit is unavailable for new leases or already has an active lease.

### `POST /api/property_management/leases/{id}/extension-offers` · `DELETE …/extension-offers/{offerId}`
`{ startsOn, endsOn, monthlyRate, respondBy, message? }`. `409` when a `sent` offer exists.

### `GET` · `PUT /api/property_management/settings`
`{ billingChannelId: uuid | null, invoiceIssueDay: int 1..28, cancelledOrderStatusEntryId: uuid | null, leaseEndingThresholdDays: int 1..365, bookingReminderMinutes: int 5..1440 }`; `GET` returns the stored values with defaults applied. `PUT` validates that the channel and status entry belong to the caller's organization (`422` otherwise); scope comes from the auth context, never the body. Requires `property_management.manage`.

### Portal (`requireCustomerAuth`, scoped to the customer user's company)
| Endpoint | Purpose |
|----------|---------|
| `GET /api/property_management/portal/units?building={id}&date=` | Bookable units with slots, grouped by floor; excludes unavailable units |
| `GET /api/property_management/portal/bookings?building=&state=` | My bookings |
| `POST /api/property_management/portal/bookings` | `{ unitId, startsAt, endsAt, notes? }` → `201`; `409` slot taken / outside opening hours / unit unavailable |
| `POST /api/property_management/portal/bookings/{id}/cancel` | Customer cancellation |
| `GET /api/property_management/portal/lease` | Current lease of the customer's company (unit, product, size, term, rate, open offer) |
| `POST /api/property_management/portal/lease/extension-offers/{id}/answer` | `{ answer: 'accept'|'decline' }`; a declined offer may still be accepted until `respondBy` |

Portal scoping: bookings are scoped to the **customer user** (`customer_user_id`) — a member without a company books and sees only their own bookings; the lease is scoped to the customer user's company (`CustomerUser.customerEntityId`), never to a body parameter. `GET portal/units` runs a constant 5 queries per request (building + floors/units, opening rules, unavailability, confirmed bookings for the date, prices via `resolvePriceMany`); slots are computed in memory.

Errors use the platform's error envelope; messages are i18n keys, never raw strings.

## Internationalization (i18n)

All labels under `property_management.*` in `i18n/*.json` (en, pl at minimum); `useT()` client-side, `resolveTranslations()` server-side. Unit types and products show catalog names (already translated by catalog). Dictionary entries for unavailability reasons are translatable.

## UI/UX

The prototype is the visual reference for every screen; the spec records only behaviour that is not standard `CrudForm`/`DataTable`.

**Backoffice** (`backend/…`, sidebar group *Facilities*: Floor plan, Buildings, Leases, Bookings, Settings):
- **Floor plan** — to-scale drawing: floor rectangle, dimension labels, 1 m grid; units positioned in metres; one metres-per-pixel scale for every floor of a building (widest floor). Status colours are reserved: neutral = in use (occupied/booked), success = ready (available/free), warning fill = unavailable; "lease ending" (60 days) is an annotation (dashed warning edge + clock badge), never a fill. Detail panels per unit. "Edit floor" opens the floor page.
- **Floor page** — floor details (name, size, availability), layout drawing (spaces as labelled dashed zones, units, common areas, unavailable areas hatched), Spaces / Units / Common areas tables.
- **Unit, space, common-area forms** — position is set by **drag and drop** on the to-scale preview (0.5 m snap, arrow keys 0.5 m / Shift 1 m, `aria-roledescription="draggable"`); x/y are read-only read-outs; a dropped unit adopts the space that fully contains it; fit/overlap problems are named in words and disable Save.
- **Availability** — the same `Available` switch in every list and form (buildings, floors, spaces, units). Switching off opens a dialog (reason required, from, until) that previews the bookings it cancels and the leases it flags (dry-run API); switching on is immediate. Dialogs: `Cmd/Ctrl+Enter` confirm, `Escape` cancel.
- **Leases list** — status chips include *Unit unavailable*; row status shows Active + "Unit unavailable · until …".
- **Lease detail** — product (locked once active), the sales order created at activation, History card (versions + invoices per version, linked to sales), extension offer composer with live preview of the tenant's card.
- **Bookings list** — "Booked as" column (product + price snapshot) and "Order" column (the booking's sales order, marked cancelled with the booking).
- **Settings** — one `CrudForm` over the keys in §Configuration; the sales channel has no default, and a refused activation or booking links here while it is unset.
- DS primitives only: `DataTable`, `CrudForm`, `StatusBadge`, `Alert`, `FormField`, `SectionHeader`, `EmptyState`, `LoadingMessage`, `useConfirmDialog`; semantic status tokens; lucide icons; `aria-label` on icon-only buttons.

**Portal** (`frontend/[orgSlug]/portal/…`, nav *Bookings*, *My lease*): my bookings; book (location switcher, units grouped by floor with product and space, slots within opening hours, prices in the product's `currency_code`); review with a to-scale "Where it is" map (only the booked unit highlighted); confirmation; my lease (unit + product + size, term, rate, expiry warning identical to the backoffice threshold); extension offer accept/decline; bell entries for booking reminders, cancellations and extension offers.

### Frontend Architecture Contract

| Route / surface | Server root | Client islands | Data owner |
|---|---|---|---|
| `/backend/property_management/floor-plan` | `page.tsx` | `FloorPlanCanvas` (status drawing, detail drawer) | `GET floors/{id}/layout` |
| `/backend/property_management/buildings/[id]/floors/[floorId]` | `page.tsx` | `FloorLayoutCanvas`, `AvailabilitySwitch` | layout API |
| `/backend/property_management/units/…`, `spaces/…`, `common-areas/…` | `page.tsx` | `CrudForm` + `PlacementEditor` | CRUD API |
| `/backend/property_management/buildings`, `leases`, `bookings` | `page.tsx` | `DataTable` + `AvailabilitySwitch` | CRUD API |
| `/backend/property_management/settings` | `page.tsx` | `CrudForm` | `GET`/`PUT /api/property_management/settings` |
| `/[orgSlug]/portal/bookings/new` | `page.tsx` | `SlotPicker`, `WhereItIsMap` | portal units API |

`"use client"` ledger:

| File | Reason | Heavy deps? | Alternative rejected |
|---|---|---|---|
| `components/FloorPlanCanvas.tsx` | pointer/keyboard selection, drawer state | none (absolutely-positioned elements + CSS custom properties) | `@xyflow/react` — graph semantics, ~100 kB, no metric geometry |
| `components/PlacementEditor.tsx` | drag and drop (pointer capture), live validation | none | — |
| `components/AvailabilitySwitch.tsx` | dialog + dry-run call via `useGuardedMutation` | none | badge + separate page (prototype iteration rejected) |
| `components/portal/SlotPicker.tsx` | slot selection state | none | — |

Budgets: 0 page-root `"use client"`; no client file > 300 LOC (`FloorPlanCanvas` splits into `UnitTile`, `SpaceZone`, `DimensionRulers`); 0 heavy libraries; a Playwright hydration smoke per changed interactive route; `yarn check:client-boundaries` clean. No global provider or bootstrap changes.

## Configuration

Per organization, through the DI `moduleConfigService` (`configs/lib/module-config-service`, as `catalog/api/settings` uses it): `billingChannelId` (sales channel for lease and booking documents — required before activation/booking; the API returns `422 billing_channel_missing` otherwise), `cancelledOrderStatusEntryId` (sales order status used for cancelled bookings), `leaseEndingThresholdDays` (int, default 60), `invoiceIssueDay` (int 1–28, default 1, in the building's timezone), `bookingReminderMinutes` (int, default 60).

## Migration & Compatibility

- New module and tables only; no existing table changes.
- **Planner (additive):** `buildWeeklyRrule` moves from `commands/availability-weekly.ts` into exported `lib/weeklyRrule.ts`; the command and the three inline copies switch to it (no behaviour change).
- **Catalog (additive):** one response enricher field set (`propertyManagement: { use, billingUnit }`) and one injected form field; no catalog schema change.
- New event ids, notification ids, ACL features (`property_management.view`, `.manage`, `.availability.manage`, `.leases.manage`, `.bookings.manage`, portal `portal.property_management.bookings`, `.lease`) and API routes are new contract surfaces — frozen once released (`BACKWARD_COMPATIBILITY.md`).
- Migrations generated with `yarn db:generate`, snapshot committed; no `db:migrate` in the PR.

## Implementation Plan

Each step ends with a working app and is covered by the tests named in it. Integration tests (`__integration__/`) create their own fixtures via the API and clean up.

### Phase 1: Property structure
1. Scaffold the module (`index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `i18n`), entities Building, Floor, Space, CommonArea, Unit, UnitProductPeriod, ProductUse; migration. *Unit tests:* `geometry.ts`, `floorNumbering.ts`.
2. Building + floor CRUD with `floor.layout_replace` (counts, read-only numbers, minimum-count guard); Buildings list/edit pages. *Integration:* create building with 1 below / 3 above → floors −1…2; lowering past a floor with units → 422.
3. ProductUse API + catalog enricher + injected product form field. *Integration:* product flagged bookable appears enriched on `GET /api/catalog/products`.
4. Space, unit, common-area commands with geometry invariants and the default space; product history on unit create/`product_change` (locked when an active lease exists — enforced from Phase 2). *Integration:* overlapping unit → 422 naming the conflict; shrinking a space that strands a unit → 422.
5. Floor page (setup view) + `PlacementEditor` drag and drop. *Playwright:* drag a unit into another space → Space field follows; drop onto a common area → Save disabled.
6. Building archive (blocked by active leases/upcoming bookings — check wired as leases and bookings arrive) and delete-only-if-never-used.

### Phase 2: Leases
1. Lease, LeaseVersion entities; create (draft, product snapshot), update, delete; one active lease per unit. *Integration:* second active lease on a unit → 409.
2. Settings API (`GET`/`PUT /api/property_management/settings`, `property_management.manage`, values via `moduleConfigService` scoped to the caller's tenant/organization) and the Settings page. *Integration:* `PUT` with an issue day of 29 → 422; activation before a channel is set → `422 billing_channel_missing`.
3. `lease.activate` / `lease.end` creating the sales quote → order (scrubbed ctx) and storing ids; undo while uninvoiced. *Integration:* activation produces an order whose line carries the unit's product and the monthly rate.
4. Leases list (status chips, building filter, search) and detail with sales order link and History card.
5. Extension offers (offer/withdraw, one outstanding, preview card); `lease_extension.offered` event. *Integration:* second offer while one is sent → 409.

### Phase 3: Bookings
1. Booking entity; `booking.create` (unit row lock, overlap check, product/price snapshot via `catalogPricingService`, `sales.orders.create`), `booking.cancel` (order cancelled). *Integration:* two concurrent bookings of one slot → exactly one succeeds.
2. `units/{id}/slots` without opening hours; backoffice bookings list with "Booked as". *Integration:* changing the unit's product leaves existing bookings' snapshot unchanged.
3. `booking_sweep` worker (complete past bookings; reminders) registered via scheduler.

### Phase 4: Availability and opening hours
1. Unavailability entity, resolver, `unavailability.create` dry-run/confirm with `previewToken` (cancel bookings + notify + order status), the chunked `unavailability_apply` worker, and `end`. *Integration:* making a floor unavailable today cancels its bookings, flags its active leases, blocks new bookings in the window; a stale preview token → 409.
2. `AvailabilitySwitch` + dialog in every list and form. *Playwright:* switch off on the buildings list → dialog → confirm → row shows reason and end date.
3. ScheduleRule + opening-hours editor (reusing planner's weekly editor), planner `weeklyRrule` export; slots respect hours. *Integration:* booking outside opening hours → 409.
4. "Unit unavailable" lease flag + filter chip.

### Phase 5: Lease invoicing
1. `leasePeriods.ts` + LeaseBillingPeriod ledger. *Unit tests:* periods for mid-month start/end.
2. `lease_billing.issue` worker issuing `sales.invoices.create` against the lease order line with the pending → invoice → issued sequence; failures recorded + `lease.invoice_failed` staff notification. *Integration:* running the worker twice for one period issues one invoice; a period left `pending` with an existing invoice is reconciled, not re-invoiced.
3. History card lists invoices per version; `lease.extend` (signed agreement for an accepted offer) creates the extension quote → order and an `extended` version; the daily sweep ends leases past `ends_on` and expires unanswered offers. *Integration:* extend after acceptance → new version and new order; an offer past `respondBy` becomes `expired`.
4. Early `lease.end` reduces the order line to the invoiced months; `lease.update` on an active lease writes a `corrected` version and updates the line. *Integration:* ending a 24-month lease after 10 invoices leaves the order line at 10.

### Phase 6: Floor plan status view
1. `floors/{id}/layout?date=` status projection (6 queries). *Integration:* a lease ending in ≤ 60 days returns `leaseEnding` with days left.
2. `FloorPlanCanvas` with legend, building/floor switcher, unit detail drawers, "Edit floor". *Playwright:* hydration smoke; clicking a unit opens its panel.

### Phase 7: Customer portal
1. Portal nav + my bookings + book (slots, prices) + review with "Where it is" map + confirmation. *Integration:* customer of company A cannot see or book against company B's data.
2. My lease + extension answer (accept/decline, re-accept until deadline). *Integration:* answering an expired offer → 409.
3. Portal notifications (reminder, cancellation, extension offered) + `portalBroadcast` live refresh.

### Testing Strategy
Pure libs (geometry, numbering, periods, slots) by unit tests; every API route above by integration tests; drag and drop, availability dialog, booking flow and floor plan by Playwright. Concurrency tests for booking overlap and billing idempotency.

## Edge Cases & Failure Scenarios

| Scenario | Behaviour the user sees |
|----------|-------------------------|
| Opening hours are narrowed while bookings exist outside the new hours | Existing bookings are kept; the save dialog lists them so the manager can cancel individually. New bookings follow the new hours. |
| A space is shrunk so a unit would stick out | Save is disabled; the message names every unit outside the space (US-G4). |
| A floor is resized smaller than its spaces/units | `422` naming what would fall outside; the floor size field shows the error. |
| A unit's product is deleted in the catalog | Snapshots keep leases, bookings and history intact; the unit shows a "product missing" warning and cannot take new leases or bookings until a product is set. |
| A product's use changes from bookable to leasable in the catalog while units have future bookings | The product-use edit is refused with the list of affected units and bookings. |
| The sales command fails during lease activation or booking | The compound command rolls back; the lease stays draft / the booking is not created; the sales error is shown. |
| The scheduler module is not installed | No automatic invoices; the leases page shows a banner and the CLI `mercato property_management billing:run` issues due invoices. |
| A tenant answers an offer after its deadline | `409 offer_expired`; the portal shows the offer as expired and points to the building manager. |
| Two managers make overlapping floors/spaces unavailable | Both rows stand; the effective availability is their union; ending one leaves the other in force. |
| A building is archived while the portal page is open | The next booking attempt fails with `409 location_unavailable`; the location switcher marks it unavailable on reload. |

## Risks & Impact Review

### Data Integrity Failures
- **Double booking** under concurrency — mitigated by the unit row lock + overlap check in one transaction; integration test with parallel requests.
- **Duplicate invoices** from worker retries — unique `(lease_id, period_start)` ledger; the invoice is created inside the same unit of work that marks the period issued.
- **Layout drift** (a unit outside its space) — invariants enforced by commands, not only the UI; space updates re-validate contained units.

### Cascading Failures & Side Effects
- **Unavailability cancels many bookings** — dry run shows exactly what is cancelled; the confirm button states the count; cancellations run in one transaction; notifications emitted after commit.
- **Sales command failure during booking/activation** — compound command rolls back the booking/lease state; user sees the sales error message.

### Tenant & Data Isolation Risks
- Portal endpoints derive the company from `CustomerUser.customerEntityId`, never from the request body; every query filters by `organization_id`.

### Migration & Deployment Risks
- New tables only. Planner refactor is behaviour-preserving and covered by planner's existing tests.

### Operational Risks
- **Scheduler absent** — invoices not issued; detected by a banner on the leases page and the `billing:run` CLI; documented in setup.
- **Sales channel not configured** — activation and booking return `422 billing_channel_missing`; settings page links to configuration.

### Risk Register

| Risk | Affected area | Severity | Likelihood | Mitigation | Residual |
|------|---------------|----------|-----------|------------|----------|
| Concurrent double booking | bookings | High | Medium | Row lock + overlap check + test | Low |
| Duplicate lease invoice | lease invoicing, sales invoices | High | Low | Unique ledger key + idempotent worker | Low |
| Unavailability cancels bookings by mistake | availability, bookings, customers | Medium | Medium | Dry-run preview, explicit count on confirm, reason required | Medium (cancellations are not undone) |
| Floor plan slow for large floors | floor plan, layout API | Medium | Low | Single layout endpoint, constant query count, CSS-positioned tiles | Low |
| Worker crash between invoice and ledger update | lease invoicing | High | Low | Pending claim row + reconciliation by invoice metadata key | Low |
| Closing a whole building cancels thousands of bookings | availability worker | Medium | Low | Row takes effect at once; cancellations chunked on a worker with progress | Low |
| Timezone drift (org vs building) in periods and slots | slots, billing, sweeps | Medium | Medium | One rule: building timezone everywhere; unit tests around DST changes | Low |
| Duplicate reminders on sweep reruns | portal notifications | Low | Medium | `reminder_sent_at` set in the same transaction as the send | Low |
| Catalog product deleted while referenced | units, leases, bookings | Medium | Low | Snapshots on unit periods, leases, bookings; unit shows "product missing" warning | Low |

## Final Compliance Report — 2026-10-15

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/core/src/modules/customer_accounts/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | FK ids to catalog, customers, sales |
| root AGENTS.md | Filter by `organization_id` | Compliant | Every entity scoped; portal company derived server-side |
| root AGENTS.md | Optimistic locking on new editable entities | Compliant | `updated_at` + `updatedAt` on all; command writes use `enforceCommandOptimisticLock`; child commands get scrubbed ctx |
| root AGENTS.md | Modules plural snake_case | Compliant (precedent) | `property_management` follows `planner`/`sales`/`catalog`/`wms` precedent |
| root AGENTS.md (Design System) | Semantic tokens, text scale, shared primitives, dialog keys, `aria-label` | Compliant | UI/UX section |
| packages/core → API Routes | `makeCrudRoute`, `openApi` on every route | Compliant | API Contracts |
| packages/core → Encryption | Sensitive fields in `encryption.ts`, `findWithDecryption` | Compliant | `Booking.notes`, `LeaseExtensionOffer.message` |
| packages/core → Events / Notifications | `createModuleEvents`, singular past-tense ids | Compliant | Commands & Events |
| catalog AGENTS.md | Prices via `catalogPricingService`, never inline | Compliant | Booking and unit-period price snapshots |
| sales AGENTS.md | Use `salesCalculationService`; scope documents to a channel | Compliant | sales commands do the math; `billingChannelId` setting |
| sales AGENTS.md | Quote → Order → Invoice (quote optional) | Compliant | Lease: quote → order → invoices. Booking: order without a quote — the supported direct-order path (`orderCreateSchema` has no quote reference; the backoffice and `warranty_claims` create orders directly) |
| queue AGENTS.md | Idempotent workers, `metadata` export, concurrency ≤ 20 | Compliant | Ledger key; concurrency 1 |
| ui AGENTS.md | `CrudForm`, `DataTable`, `apiCall`, `useGuardedMutation` | Compliant | Frontend Architecture Contract |
| root AGENTS.md | Integration tests ship with the feature | Compliant | Implementation Plan |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Every custom endpoint maps to listed entities |
| API contracts match UI/UX section | Pass | Dry-run availability, slots, layout, portal endpoints |
| Risks cover all write operations | Pass | Booking, billing, unavailability, layout, activation |
| Commands defined for all mutations | Pass | Commands table |
| Cache strategy covers all read APIs | Pass | No module cache in MVP; layout endpoint bounded to 6 queries; revisit if floor plans exceed 200 units |

### Non-Compliant Items
None.

### Verdict
**Fully compliant** — approved, ready for implementation.

## Changelog

### 2026-10-15
- Skeleton with Open Questions Q1–Q7; answers: one phased spec; core module; own schedule tables reusing planner code; own bookings; scheduled invoicing internal to the module; booking creates a sales document; id `property_management`.
- Follow-up gate after reading `sales/AGENTS.md`: lease billing through Quote → Order → Invoice; one order per booking.
- Full specification: research (LibreBooking, Seatsurfing, ERPNext real-estate apps), architecture, data model, API, UI, frontend contract, seven-phase plan, risks, compliance report.
- Revised after review: crash-safe billing ledger (pending claim + reconciliation), `lease.extend` and the expiry sweep, order adjustments on early end and corrections, explicit order-cancel mechanism, preview token + chunked worker for large unavailability, non-overlapping lease terms, product-use and floor-resize guards, building timezone everywhere, booking rules, org-leading indexes, portal scoping by customer user, idempotent reminders, corrected catalog injection spot id, `moduleConfigService` citation, planner reuse stated as accepted core-to-core import.
- Prototype aligned with the spec (screen 42 Settings, sales order on the lease detail and Bookings list, invoicing notes reworded, CRM sidebar group removed); Settings page and API added to the UI section and Phase 2; compliance row updated to the corrected sales AGENTS.md wording.

### Review — 2026-10-15
- **Reviewer**: Agent (fresh-context subagent given only this file and the checklist) + author pass
- **Scope cohesion**: Split would be cleaner (structure+availability / leases+invoicing / bookings+portal); acceptable as a phased umbrella — the maintainer chose one spec (Q1 = A), and each phase is independently shippable.
- **Security**: Passed — tenant scoping explicit, polymorphic subject ids loaded with org scope, portal scope derived server-side, free text encrypted.
- **Performance**: Passed — constant query counts on the layout and portal endpoints, org-leading indexes, chunked bulk cancellation.
- **Cache**: Passed — no module cache in the MVP, justified by bounded query counts; revisit above 200 units per floor.
- **Commands**: Passed after revision — every mutation is a command with undo or a stated reason it has none.
- **Risks**: Passed after revision — billing crash recovery, bulk cancellation, timezone drift and reminder duplication added.
- **Verdict**: Approved.
- Booking orders without a quote confirmed as the supported direct-order path (maintainer, verified against `orderCreateSchema` and the backoffice document-create page); the sales sign-off gate on Phase 3 and Phase 7 Step 1 removed.
