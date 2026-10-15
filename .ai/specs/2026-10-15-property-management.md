# Property Management

| Field | Value |
|-------|-------|
| **Status** | Draft — in review ([open-mercato/open-mercato#7472](https://github.com/open-mercato/open-mercato/pull/7472)) |
| **Created** | 2026-10-15 |
| **Module** | `property_management` (new, `packages/core/src/modules/property_management`) |
| **Touches** | `catalog` (enricher + form-field widget, additive), `sales` (commands consumed), `customer_accounts` / portal (pages, nav, customer-role features), `notifications` (additive `createForCustomerUsers` — see Portal notifications), `scheduler` (optional peer), `dictionaries` |
| **Source** | Clickable prototype `.ai/prototypes/property-management/` (45 screens) and `.ai/prototypes/property-management.requirements.md` (Epics A–K, US-A1 … US-K1, incl. US-I5) |

## TLDR

**Key Points:**
- A core module for operators of leased and bookable space (coworking, serviced offices). It models **buildings → floors → spaces → units** in metres, draws them to scale, and runs the two ways a unit earns money — **leases** (billed monthly on a schedule) and **bookings** (charged per booking) — with the customer-portal side of both.
- Units are typed and priced by the existing **catalog**: type = category, product = product, and whether a unit is leased or booked is a property of its **product**. Leases and bookings **snapshot the product and price** they were made at; units keep a **product history**, leases a **version history**, and both stay consistent with the `sales` documents that bill them.

**Scope:**
- Property structure: buildings (optional opening hours, availability, archive), floors (size, numbering with ground floor 0, laid out from below/above-ground counts), spaces (non-overlapping rectangles, one default space per floor), units (size + position, drag-and-drop placement, product history), common areas.
- Availability on building / floor / space / unit, inherited downwards: blocks new leases and bookings, **cancels bookings** in the period (customers notified), **flags leases** "Unit unavailable".
- Floor plan (to-scale status view) and floor setup pages.
- Leases on **two paths** chosen on one form: a **lease proposal** (a sales quote the customer's portal user approves or declines; the unit is reserved meanwhile) or a **direct lease** (active on save, sales order created directly). Product snapshot; version history; extensions on the same two paths; the first month is invoiced when the lease starts its order, then **monthly on a schedule**. One lease at a time per unit; a company may lease any number of units.
- Bookings: product + price snapshot; only within opening hours and outside unavailable periods; a **sales order per confirmed booking**.
- Customer portal: my bookings, book (review shows the unit on its floor), my leases + extension offers, bell notifications — each gated by a portal feature.

**Out of scope (separately specified or deferred):** credits; payment collection; rent escalation, deposits; uploaded floor-plan backgrounds; non-rectangular geometry; the portal's access, events, invoices, support and extras sections.

**Concerns:**
- The module is large; it ships in seven phases, each independently usable (Implementation Plan).

## Decisions after review

Raised by the review of #7472 and settled by the maintainer (defaults accepted):

- **D1 — Partial months are prorated by days.** Sales has no recurring, period or proration concept. A period shorter than a calendar month is invoiced as quantity = days in period ÷ days in month (4 decimals; sales line quantities are `numeric(18,4)`) at the monthly rate.
- **D2 — Portal bell entries via an additive `notifications` API.** The portal bell already exists (`PortalNotificationBell`, `usePortalNotifications`, `customer_accounts/api/portal/notifications*`) and reads `notifications` rows whose recipient is the portal user, but nothing can create one: `notificationService` checks every recipient against staff `users`. This spec adds `createForCustomerUsers` to the `notifications` module (see Portal notifications), shipped as its own PR before Phase 7.
- **D3 — Early lease end stays.** `lease.end` ends a lease early or at term and reduces the order line to the invoiced months; notice and handover stay outside this module.
- **D4 — Proposals in History.** Proposals (new and extension) live in `LeaseProposal`; the History card lists them as rows with no invoices until approved.
- **D5 — Backoffice booking is an API capability only.** A manager can book on a customer's behalf through the API (`customer_user_id` null); there is no backoffice booking screen in this iteration.
- **D6 — Delete only a never-used building.** A building that ever had a lease or booking is archived, not deleted.
- **D7 — Proposal expiry in days.** A proposal stays open for N days (form field, prefilled from the `proposalExpiryDays` setting, default 14); the respond-by date and the quote's `validUntil` derive from it.

## Overview

Operators of flexible workspace sell one building two ways: units leased for months (private offices, company units, parking spaces, dedicated desks) and units booked by the hour or day (meeting rooms, flex desks). Open Mercato has the CRM, the catalog and sales, but no notion of *where* something is sold, how a building is divided, or which unit is occupied or booked today. This module adds that layer for building managers (backoffice) and for tenants and members (customer portal).

> **Market Reference:**
> - **LibreBooking** (OSS resource booking) — blackouts that collide with reservations offer *delete / skip / reject* and notify affected users. **Adopted:** unavailability cancels bookings and notifies. **Rejected:** *reject* — a manager closing a floor for a leak must win; *skip* leaves bookings in a closed room.
> - **Seatsurfing** (OSS desk booking) — drag-and-drop desks on an uploaded floor-plan image. **Adopted:** drag-and-drop placement. **Rejected (deferred):** image-based geometry — this module stores metres so scale, fit and overlap can be validated; a background image is a later layer on top.
> - **ERPNext real-estate apps** (Frappe) — a scheduler issues a Sales Invoice per lease billing cycle; escalation, proration and deposits on the contract. **Adopted:** scheduled invoicing against the existing sales documents. **Deferred:** escalation, deposits. Partial months are prorated by days (D1).

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
| Lives in `packages/core/src/modules/property_management` (Q2 = A, confirmed by the maintainer) | Official modules are being consolidated into core. |
| Module id `property_management` (Q7, confirmed by the maintainer) | Domain noun; precedent for non-plural ids: `planner`, `sales`, `catalog`, `wms`, `staff`, `inbox_ops`, `data_sync`. Entities, events and commands stay singular. |
| Opening hours in a **small module-owned table** | Opening hours are one open–close window per weekday per building — a basic setting. Planner's rule engine and its `AvailabilityRulesEditor` are bound to planner's own subjects (`member|resource|ruleset`) and call `/api/planner/availability*` directly, so reusing them would need a planner change for no gain. The module stores the windows itself and computes slots with a few lines of its own code. (Supersedes Q3 = B.) |
| Own bookings table, not `resources` (Q4 = B) | `resources` serves staff-schedulable resources; units need geometry, product snapshots and lease/booking exclusivity. |
| Geometry in metres, rectangles only | Validatable (fit, overlap) and drawn to scale; matches the prototype. Non-rectangular shapes deferred. |
| Leasable/bookable is a **product** property stored in a module-owned mapping (`ProductUse`) | Catalog categories are hierarchical and one category can hold both kinds (Open space: flex desk vs dedicated desk); catalog has no such flag and must not gain module-specific columns. Exposed on products via a response enricher (eudr/wms precedent). |
| Leases on **two paths**, both ending in an order | **Lease proposal**: `sales.quotes.create` (one line: the product, quantity = months, unit price = monthly rate) answered by the customer's portal user; approval runs `sales.quotes.convert_to_order`, which deletes the quote and creates the order. **Direct lease**: `sales.orders.create` with the same line, for a lease agreed elsewhere. Either way the lease points to its **order** (never the quote, which does not survive conversion), the first month is invoiced at once, and the scheduler invoices each later month against the order line. The order line carries the product, so invoices agree with the lease version by construction. |
| **Order per confirmed booking** | One `sales.orders.create` per booking (product + price snapshot). Orders without a source quote are a supported path: `orderCreateSchema` has no quote reference, the backoffice creates orders directly (`/backend/sales/documents/create?kind=order`), and `warranty_claims` does the same from code. |
| Settings in a **module-owned table** | `property_management_settings`, one row per organization — the `sales_settings` / `customer_settings` pattern. `moduleConfigService` is tenant-scoped and shared by 15 modules; giving it an organization scope would mean replacing a unique index on `module_configs` and backfilling rows. |
| One lease at a time **per unit**, any number **per company** | A unit's lease terms never overlap; a tenant company can hold several leases (offices, parking). |
| Sales writes **compensate**, they do not roll back | `sales.orders.create` and `sales.invoices.create` commit in their own transactions, so a later failure here cannot undo them. Compound commands follow `warranty_claims`' sequence: sales write → link → on failure delete what was created (see Writes into sales). |
| Portal audience **by permission** | Portal pages, endpoints, live events and bell entries are gated by customer-role features; recipients are resolved by this module (no bridge filters by feature). |
| Unavailability **cancels bookings, flags leases** | Bookings in the period are cancelled with notification; leases are never ended by it — they are flagged "Unit unavailable" until the period ends. |
| Spaces as partitions | Spaces never overlap; resizing never moves units; a layout with any unit outside its space cannot be saved. |
| Bookings: per-unit row lock, not a DB exclusion constraint | Avoids the `btree_gist` extension dependency; overlap is checked inside the booking command under `SELECT … FOR UPDATE` on the unit. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Planner rules and editor for opening hours | Editor bound to planner subjects and API; extending planner's subject enum is a frozen-contract change — for a form of seven open/close times. |
| Units as `resources` resources | Different use case (staff scheduling); would drag capacity units, comments and tags in and still lack geometry. |
| Direct invoices without an order | Invoice lines carry no product reference, so lease ↔ invoice consistency would rely on metadata. |
| One path only (always quote, or always direct) | Operators need both: tenants who negotiate and approve online, and leases signed on paper that must start billing now. |
| Organization scope in `moduleConfigService` | Changes a service and a unique index shared by 15 modules for one module's needs. |
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
| US-H1 … H4, US-I1 … I5, US-J1 … J2 | Customer portal | 7 |

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
| `lib/bookingSlots.ts` (pure) | Bookable windows for a unit and date = the building's opening window for that weekday, minus unavailability ranges, minus confirmed bookings, cut into whole-hour slots — all in building-local time. No opening hours ⇒ whole day. |
| `lib/leasePeriods.ts` (pure) | Calendar-month billing periods for a lease version; first/last periods cut at the lease's start/end dates; quantity per period = 1 for a whole month, days in period ÷ days in month (4 decimals) otherwise (D1). Also the unused quantity of an invoiced period after an early end. |
| `lib/productUse.ts` | Resolves a product's use (`leasable|bookable`) and billing unit; products eligible for a category = direct assignments of the category **and its descendants** (`descendant_ids`). |
| Workers | `property_management.lease_invoicing` (daily, concurrency 1): issues due invoices **in advance** (see Billing), ends leases past `ends_on`, expires unanswered proposals and sends their reminders. `property_management.booking_sweep` (every 15 min): completes past bookings, sends reminders once (`reminder_sent_at`), and reconciles bookings left `pending` by a crash (see Writes into sales). `property_management.unavailability_apply`: cancels bookings for large unavailability sets in chunks of 100. Scheduled through the optional `schedulerService` in `setup.ts` `seedDefaults` (warranty_claims pattern: stable UUID ids, `try/catch`); the CLI `billing:run` runs the same claim path as the worker. |
| Time | **Building-local wall-clock time, no timezone setting.** Opening hours, booking times, lease dates, billing periods and proposal deadlines all mean the building's local time and are stored without a zone (`date`, `time`, `timestamp without time zone`); no form asks for a timezone. "Now" for sweeps, reminders, billing and expiry is the deployment's local clock (`TZ`), which is correct while every building of an installation shares one timezone — the case today. A per-building timezone can be added later as an optional column without changing stored values. |

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
| `property_management.settings.save` | restore the previous row | — |
| `property_management.product_use.set` | restore the previous use; refused while the change would strand units, leases or future bookings | — |
| `property_management.booking.complete` (sweep) | none — time-based | `booking.completed` event |
| `property_management.lease_proposal.remind` (worker) | none — time-based | portal notification three days before `respond_by`, once per proposal (`reminded_at`) |
| `property_management.unavailability.create` (compound) | remove the row; **cancelled bookings are not restored** — the slots may have been rebooked, and customers were already told | booking cancellations, customer notifications, sales order status changes |
| `property_management.unavailability.end` (make available) | re-create the row | — |
| `property_management.lease.create` (direct, compound) | none once saved — the first invoice is issued with it; corrections go through `lease.update` / `lease.end` (credit memo) | creates the lease order (`sales.orders.create`, `metadata.propertyManagementLeaseId`) and issues the first month's invoice; lease is `active` on save |
| `property_management.lease.propose` (compound) | `lease_proposal.withdraw` | creates the sales quote (`sales.quotes.create`, status `sent`, `validUntil` = `respond_by` from `expiresInDays`, `metadata.propertyManagementProposalId`); lease `proposed`, unit reserved; customer notification |
| `property_management.lease.update / delete` | inverse. `delete` is allowed only while no invoice was issued under the lease: it deletes the lease's order (`sales.orders.delete`, after this module checks the order has no invoice or payment — sales does not refuse that itself) or withdraws an open proposal; a lease with invoices is ended, never deleted. `update` on an active lease (dates and rate only — unit and tenant are fixed; moving is a new lease) writes a `corrected` version and updates the **current version's** order line via `sales.orders.lines.upsert` (unit price, quantity = remaining + invoiced months); issued invoices are untouched; undo restores the previous version and line while no invoice was issued since. A proposed lease is edited by withdrawing and proposing again | — |
| `property_management.lease_proposal.approve` (portal) | none — the customer's acceptance; the manager ends or corrects the lease instead | **one transaction** (see Approving a proposal): `sales.quotes.convert_to_order` with the shared `ctx.transactionalEm` (quote deleted, order created), lease → `active` or extension → `extended` version and new `ends_on`, proposal → `approved`; then, after commit, the first invoice of the new term through the billing ledger (immediately for a new lease, on the term's first day for an extension); manager notification. Refused (`409`) after `respondBy`, while the unit is unavailable or taken for the term, or when the quote's lines no longer match the proposal (`quote_changed`) |
| `property_management.lease.end` (early or at term) | revert status and the order line quantity while no credit memo was issued | invoiced periods after the new end date are **credited**: `sales.credit_memos.create` against each such invoice for the unused quantity (days, D1), totals computed with `salesCalculationService` (`documentKind: 'credit_memo'`), recorded on the ledger row; the order line quantity is reduced to invoiced minus credited via `sales.orders.lines.upsert` |
| `property_management.lease.extend` (direct, compound) | delete the extension order and the `extended` version while uninvoiced | creates the extension's order (`sales.orders.create`); `ends_on` and current version move at once |
| `property_management.lease.propose_extension` (compound) | `lease_proposal.withdraw` | creates the extension quote; one open proposal per lease; customer notification |
| `property_management.lease_proposal.withdraw` (manager) | propose again | quote moved to the `canceled` status via `sales.quotes.update`; a new-lease proposal releases the unit; customer notification |
| `property_management.lease_proposal.decline` (portal) | none — the customer's statement; a declined proposal stays approvable until `respondBy` (approval first sets the quote back to `sent`) | quote moved to `rejected` via `sales.quotes.update`; a new-lease proposal releases the unit; manager notification |
| `property_management.lease_proposal.expire` (worker) | none — time-based | quote moved to `canceled`; new lease → `expired`, unit released |
| `property_management.lease_billing.issue` (worker and CLI) | none — an issued invoice is corrected with a credit memo in sales | invoice. Sequence: claim the period — insert its ledger row as `pending` with `claimed_at` (the unique `(lease_version_id, period_start)` key is the claim), or take an existing stale `pending` row with `SELECT … FOR UPDATE SKIP LOCKED` (claims older than 10 minutes only), so the worker and `billing:run` can never both invoice one period → compute the line and totals with `salesCalculationService.calculateDocumentTotals({ documentKind: 'invoice' })` (`sales.invoices.create` stores whatever totals it is given) → `sales.invoices.create` with `orderId`, one line referencing the version's `orderLineId` and the period's quantity, and `metadata.propertyManagementBillingPeriodId` → mark `issued`. A retried claim first looks up an invoice by that metadata key and only creates one if none exists. The invoiced quantity per order line is tracked in this ledger, since sales never increments `invoicedQuantity` |
| `property_management.booking.create` (compound) | cancel the booking and set its order to the cancelled status | creates the booking order (`sales.orders.create`, which computes totals itself); customer notification |
| `property_management.booking.cancel` | none — the customer has been notified and the slot released for others; rebooking is the recovery | notification; the booking's order is moved to the sales order status entry configured as cancelled (`sales.orders.update` with `statusEntryId`), or deleted with `sales.orders.delete` when it has no invoice or payment — checked by this module, since `sales.orders.delete` does not refuse invoiced orders |

Proposals are answered only in the portal: this module never calls `api/quotes/send`, so no public quote link (`/quote/[token]`) exists for them, and sales' own accept route cannot bypass the lease rules.

Child sales commands are dispatched with a scrubbed context (no `request`), as `warranty_claims` does, so the parent's optimistic-lock header never reaches them.

**Approving a proposal — one transaction.** `sales.quotes.convert_to_order` accepts the caller's `ctx.transactionalEm` and deletes the quote as part of the conversion, so approval runs entirely inside one database transaction, exactly as sales' own `api/quotes/accept/route.ts` does:

1. Open a transaction; lock the proposal and the unit (`SELECT … FOR UPDATE`).
2. Re-check: the proposal is still answerable (`sent`, or `declined` before `respond_by`), the unit is available and has no other lease or open proposal overlapping the term, and the quote's lines still match the proposal.
3. Set the quote to `confirmed` and dispatch `sales.quotes.convert_to_order` with the transaction's EntityManager — the order is created and the quote deleted inside the same transaction.
4. Activate the lease (or write the `extended` version and move `ends_on`), store the order and order-line ids, mark the proposal `approved`. Commit.

Any failure rolls the whole approval back: the quote still exists, the proposal keeps its state and the customer can try again. The first invoice is issued after the commit through the billing ledger, whose pending claim makes it retry-safe.

**Other writes into sales — compensation, not rollback.** `sales.orders.create` forks its own EntityManager and commits before it returns, and `sales.invoices.create` commits in its own transaction too, so a failure in this module *after* those calls cannot un-create the sales document. Direct leases, direct extensions and bookings therefore follow the `warranty_claims` replacement-order sequence (`warranty_claims/commands/claims.ts`):

1. **Hold** — in this module's transaction, lock the unit and write the own record in a holding state (booking `pending`, lease `pending_order` for a direct lease or extension). The holding row keeps the slot or term from being taken meanwhile.
2. **Create** — dispatch the sales command with `metadata.propertyManagement…Id` set to the own record's id.
3. **Link** — in a new transaction, store the sales ids and move the record to its final state (booking `confirmed`, lease `active`).
4. **Compensate** — if step 2 fails, delete the holding row and show the sales error. If step 3 fails, dispatch `sales.orders.delete` for the order just created, then undo step 1.
5. **Orphan** — if compensation itself fails, log it, raise the `lease.order_orphaned` / `booking.order_orphaned` staff notification naming the order, and return `500`. The sweep (bookings) or a retry (leases) first looks up an order by the metadata key, and links it instead of creating a second one.

**Events** (`createModuleEvents`, `module.entity.action`, past tense) — frozen once released:
`property_management.building.{created,updated,archived,deleted}`, `.floor.{created,updated,deleted}`, `.space.{created,updated,deleted}`, `.unit.{created,updated,deleted,product_changed}`, `.common_area.{created,updated,deleted}`, `.unavailability.{created,ended}`, `.lease.{created,updated,activated,extended,ended,deleted,invoice_issued,invoice_failed,order_orphaned}`, `.lease_proposal.{sent,withdrawn,approved,declined,expired}`, `.booking.{created,cancelled,completed,order_orphaned}`. These **domain events are always emitted** — for portal and backoffice actions alike (a manager's booking with no `customer_user_id` included) — and none of them is `portalBroadcast`, so search indexing, persistent subscribers and workflows see every change.

**Portal events** are separate, portal-only ids, following the `warranty_claims.claim.portal_status_changed` / `staff.time_report.portal_published` precedent: `property_management.booking.portal_changed`, `.lease.portal_changed`, `.lease_proposal.portal_changed` (payload: the record id and what changed — created, cancelled, reminder, sent, withdrawn, expired, extended, ended). Each has `portalBroadcast: true` and `excludeFromTriggers: true`, and is emitted only through one helper, `emitPortalEvent`, which requires a non-empty `recipientUserIds` and emits nothing otherwise. This matters because the portal stream treats a payload without recipients as organization-wide (`customer_accounts/api/portal/events/stream.ts` `matchesAudience`): a portal event must never leave without a recipient list. Payloads carry ids only; the page refetches through its feature-gated endpoint.

**Notifications** (`notifications.ts`): portal recipients — `property_management.booking.reminder`, `.booking.cancelled`, `.lease_proposal.sent`, `.lease_proposal.reminder`; staff recipients — `.lease_proposal.answered`, `.lease.invoice_failed`, `.lease.order_orphaned`, `.booking.order_orphaned` (sent to holders of `property_management.leases.manage` / `.bookings.manage` via `createForFeature`). Portal notifications are `Notification` rows whose recipient is the customer user (as read by `customer_accounts/api/portal/notifications.ts`), created with the new `createForCustomerUsers` and addressed to the same recipients as the portal events.

### Cross-module touchpoints

| Peer | Mechanism | Owner of the glue | Peer absent |
|------|-----------|-------------------|-------------|
| `catalog` | FK ids (`catalog_category_id`, `catalog_product_id`); `catalogPricingService` for prices; response enricher on `catalog_product` (use, billing unit); CrudForm field widget on spot `crud-form:catalog.product:fields` (`catalog/extension-points.ts`) | this module | catalog is a hard dependency (units cannot exist without a product) — declared in `index.ts` |
| `customers` (CRM) | FK ids (tenant company, contact person, booking person) | this module | hard dependency (core) |
| `sales` | `commandBus.execute` of `sales.orders.create`, `sales.orders.update/delete`, `sales.orders.lines.upsert`, `sales.invoices.create`; `salesCalculationService` (DI) for invoice totals | this module | hard dependency (core) |
| `scheduler` | `schedulerService.register(...)` in `seedDefaults` | this module | soft-optional: `hasRegistration` + `try/catch`; without it the workers can be run from the CLI (`mercato property_management billing:run`) and a banner on the leases page says automatic billing is off |
| `customer_accounts` / portal | portal pages + `page.meta.ts` nav, `defaultCustomerRoleFeatures`, `CustomerUser.customerEntityId` → tenant company, `CustomerRbacService` to resolve event and notification recipients | this module | portal pages simply not reachable |
| `dictionaries` | `property_management.unavailability-reasons` dictionary seeded in `setup.ts` | this module | — |

### Billing (in advance)

- A lease is billed **in advance**, one calendar month at a time, against the order line of the lease version in force for that month.
- The first period is invoiced as soon as the lease gets its order: on save for a direct lease, on approval for a proposal — even when the term starts later. An extension's first period is invoiced on its first day.
- Every later period is invoiced on the organization's invoice issue day of the month it covers (`invoiceIssueDay`, default the 1st), so each invoice is issued at the start of the month it pays for.
- Partial first and last months are prorated by days (D1).
- Ending a lease early credits the unused part of periods already invoiced (`lease.end`); nothing is refunded automatically — the credit memo is the record, payment handling stays in sales.
- The ledger is the source of truth: any started period without a ledger row is due. Leases created before Phase 5 ships therefore get their first and every later due invoice on the worker's first run.

## Data Models

All tables `property_management_*`, UUID PKs, `organization_id` + `tenant_id` on every row, `created_at`, `updated_at` (optimistic locking, default ON), `deleted_at` where soft-deletable. Lengths in metres: `numeric(7,2)`; positions are a rectangle's top-left corner from the floor's top-left. Only the unique fields are listed.

### Building
`name`, `address` (text), `status` (`active|archived`), `archived_at`, `opening_hours_enabled` (bool). Index `(organization_id, status)`.

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

### OpeningHours
`building_id`, `weekday` (0 = Monday … 6 = Sunday), `opens_at`, `closes_at` (`time`, building-local; `closes_at > opens_at`, no overnight windows). Unique `(building_id, weekday)`; a missing weekday means closed that day. Replaced as a set by `building.update`. Ignored when the building's `opening_hours_enabled` is false.

### Unavailability
`subject_type` (`building|floor|space|unit`), `subject_id`, `reason_entry_id` (dictionary), `reason_text`, `starts_at`, `ends_at` (nullable = open-ended), `ended_at` (set when made available early), `cancelled_booking_count`, `apply_status` (`applied|applying`). Index `(organization_id, subject_type, subject_id, starts_at)`. `subject_id` is polymorphic, so the command loads the subject with the caller's `organization_id` before inserting — never trusts the id alone.

### Lease
`reference` (unique per org, `L-YYYY-NNN`, issued from a per-organization counter row locked `FOR UPDATE`), `unit_id`, `customer_company_id`, `primary_contact_person_id`, `status` (`proposed|pending_order|active|declined|withdrawn|expired|ended`), `starts_on`, `ends_on`, `current_version_id`, `sales_order_id` (denormalized from the current version — every version keeps its own order and order line). Leases of one unit (active, about to start, or `proposed` with an open proposal — a proposal reserves the unit) **must not have overlapping terms** (checked under the unit row lock) — so the next tenant's lease can be signed while the current one runs. A company may hold any number of leases on different units. Creating or approving a lease also fails while confirmed bookings fall inside the term. "Unit unavailable" is **derived** (resolver) and returned by the list API, filterable. Index `(organization_id, unit_id, status)`.

### LeaseReferenceCounter
`organization_id` (unique with `tenant_id`), `year`, `last_number`. Locked `FOR UPDATE` when a lease is created; the reference is `L-{year}-{last_number + 1}` zero-padded to 3 digits. Not user-editable.

### PropertyManagementSettings
One row per organization (unique `(organization_id, tenant_id)`): `billing_channel_id` (nullable — no default), `invoice_issue_day` (1–28, default 1), `cancelled_order_status_entry_id` (nullable), `lease_ending_threshold_days` (default 60), `booking_reminder_minutes` (default 60), `proposal_expiry_days` (1–90, default 14). Missing row = defaults. Written by `property_management.settings.save`.

### LeaseVersion (append-only)
`lease_id`, `version_no`, `event` (`activated|corrected|extended`), `catalog_product_id`, `product_name`, `monthly_rate`, `currency_code`, `starts_on`, `ends_on`, `sales_order_id`, `sales_order_line_id`, `effective_from`. The product is copied from the unit's open `UnitProductPeriod` when the lease is created or proposed, and never changes afterwards.

### LeaseProposal
`lease_id`, `kind` (`new|extension`), `sales_quote_id` (until approval — the quote is deleted on conversion), `sales_order_id` (after approval), `starts_on`, `ends_on`, `monthly_rate`, `currency_code`, `message` (encrypted), `expires_in_days`, `respond_by` (= sent date + `expires_in_days`, end of that local day; also the quote's `validUntil`), `status` (`sent|approved|declined|withdrawn|expired`), `answered_at`, `answered_by_customer_user_id`, `reminded_at`. Partial unique: one proposal per lease in status `sent` or `declined` (a time-free predicate); the expiry worker moves both to `expired` once `respond_by` passes, and approval re-checks `respond_by` itself. Shown in the lease History as rows with no invoices until approved.

### LeaseBillingPeriod (idempotency ledger)
`lease_id`, `lease_version_id`, `period_start`, `period_end`, `quantity` (months, 4 decimals), `amount`, `status` (`pending|issued|failed`), `claimed_at`, `sales_invoice_id`, `credited_quantity`, `sales_credit_memo_id`, `attempts`, `last_error`. **Unique `(lease_version_id, period_start)`** — the claim and idempotency key; see `lease_billing.issue` and Billing.

### Booking
`unit_id`, `customer_company_id` (nullable for members), `booked_by_person_id`, `customer_user_id` (nullable — backoffice-made bookings), `starts_at`, `ends_at`, `status` (`pending|confirmed|completed|cancelled`; `pending` only between the hold and the order link, and it already blocks the slot), `cancel_reason` (`customer|manager|unavailability`), `unavailability_id`, `catalog_product_id`, `product_name`, `unit_price`, `quantity`, `billing_unit`, `total_amount`, `currency_code`, `sales_order_id`, `reminder_sent_at`, `notes` (encrypted). Indexes `(organization_id, unit_id, starts_at)`, `(organization_id, customer_user_id, starts_at)`, `(organization_id, status, starts_at)`.

**Booking rules (MVP):** slots start on the hour; an hourly booking is 1–10 whole hours, quantity = hours; a daily booking (flex desk) is one day from opening to closing, quantity 1; a booking never crosses midnight or the building's opening hours; price = `catalogPricingService` price for the product × quantity, snapshotted. Customers may cancel until the booking starts; no cancellation fee in this iteration.

### Encryption (`encryption.ts`)
`Booking.notes`, `LeaseProposal.message` — free text written to or about people. Read through `findWithDecryption`. Building addresses are business addresses, not personal data.

### Custom entities (`ce.ts`)
`property_management:building`, `:unit`, `:lease` declared so operators can add custom fields.

## API Contracts

Standard CRUD (`makeCrudRoute`, zod, `openApi`, `updatedAt` in responses, `pageSize ≤ 100`) for `buildings`, `floors`, `spaces`, `units`, `common-areas`, `product-uses`, `leases`, `bookings` (list + detail; create/cancel are custom). Only non-CRUD contracts are listed.

### `POST /api/property_management/buildings/{id}/floors/layout`
`{ below: int ≥ 0, above: int ≥ 1, floors: [{ number, name, sizeX, sizeY }] }` → `200 { floors }`. `422` with `{ minimumAbove, minimumBelow, blockingFloor }` when a removed floor still holds units. Optimistic lock on the building.

### `GET /api/property_management/floors/{id}/layout?date=YYYY-MM-DD`
One call for the floor plan and setup pages: floor, spaces, units (with product, use, own + inherited availability), common areas, and — when `date` is given — per-unit status (`occupied|available|unavailable|booked|free`, lease end and days left, today's bookings). Expected query count: 6, independent of unit count.

### `POST /api/property_management/unavailabilities?dryRun=true|false`
`{ subjectType, subjectId, reasonEntryId?, reasonText: string(1..200), startsAt, endsAt?, previewToken? }`. Dry run → `200 { units, bookingsToCancel: [{id, unit, startsAt, person}], leasesToFlag: [{id, reference, company, unit}], previewToken }` (`previewToken` = hash of the affected booking ids). Confirm must send the `previewToken`; if the affected set changed since the preview → `409 preview_stale` and the dialog re-previews. Confirm → `201 { id, cancelledBookings, flaggedLeases, applyStatus }`: up to 200 bookings are cancelled in the request; more are queued to `unavailability_apply` (chunks of 100, progress in the top bar) while the unavailability row itself takes effect immediately. Confirm locks the rows of every unit under the subject (`SELECT … FOR UPDATE`, in id order) before inserting the row — the same lock `booking.create` takes — so a concurrent booking either commits first and is cancelled with the rest, or waits and then sees the unavailability and is refused. `409` when the subject is archived. Requires `property_management.availability.manage`.

### `POST /api/property_management/unavailabilities/{id}/end` → `200` (make available now).

### `GET /api/property_management/units/{id}/slots?date=YYYY-MM-DD`
`{ openingHours: [{start, end}] | null, slots: [{ start, end, state: 'free'|'booked' }], price: { amount, currency, billingUnit } }`. Backoffice and portal (portal variant scoped to bookable units).

### `POST /api/property_management/bookings` · `POST …/bookings/{id}/cancel` (backoffice)
Create: `{ unitId, startsAt, endsAt, bookedByPersonId, customerCompanyId?, customerUserId?, notes? }` → `booking.create` (same rules, price snapshot and order as the portal; `customer_user_id` null when the person has no portal account) → `201 { id, salesOrderId }`; `409` slot taken / outside opening hours / unit unavailable. Cancel → `booking.cancel` with `cancel_reason = manager`. Both require `property_management.bookings.manage`. No backoffice booking screen in this iteration (D5).

### `POST /api/property_management/units/{id}/product`
`{ catalogProductId }` → closes the open product period and opens a new one. `409` while the unit has an active lease (product locked); allowed with upcoming bookings.

### `POST /api/property_management/leases` (custom create)
`{ unitId, customerCompanyId, primaryContactPersonId?, startsOn, endsOn, monthlyRate, asProposal: boolean, expiresInDays?: int 1..90 (proposal only; defaults to the `proposalExpiryDays` setting), message? }`. `asProposal: false` → `lease.create` (active, order, first invoice) → `201 { id, salesOrderId }`; `true` → `lease.propose` → `201 { id, proposalId, salesQuoteId }`. `422` if the unit is unavailable for new leases; `409` if another lease or open proposal of the unit overlaps the term. Every referenced id — unit, `customerCompanyId`, `primaryContactPersonId` (which must also belong to that company), the unit's catalog product — is loaded within the caller's organization; anything else is `422`, never a cross-organization reference.

### `POST /api/property_management/leases/{id}/end`
Ends the lease at a date (early or at term); the order line is reduced to the invoiced months.

### `POST /api/property_management/leases/{id}/extensions` · `DELETE …/proposals/{proposalId}`
`{ startsOn, endsOn, monthlyRate, asProposal: boolean, expiresInDays?, message? }` → `lease.extend` or `lease.propose_extension`. `409` when an open proposal exists. `DELETE` withdraws an open proposal (new or extension).

### `GET` · `PUT /api/property_management/settings`
`{ billingChannelId: uuid | null, invoiceIssueDay: int 1..28, cancelledOrderStatusEntryId: uuid | null, leaseEndingThresholdDays: int 1..365, bookingReminderMinutes: int 5..1440, proposalExpiryDays: int 1..90 }`; `GET` returns the organization's row with defaults applied. `PUT` runs `property_management.settings.save` (mutation guards, optimistic lock on the row) and validates that the channel and status entry belong to the caller's organization (`422` otherwise). The organization comes from `resolveSingleOrganizationIdOrDeny` (as `sales/api/settings/document-numbers`), never the body. Requires `property_management.manage`.

### Portal (`requireCustomerAuth` + the feature listed, scoped to the customer user / company)
| Endpoint | Feature | Purpose |
|----------|---------|---------|
| `GET /api/property_management/portal/units?building={id}&date=` | `portal.property_bookings.view` | Bookable units with slots, grouped by floor; excludes unavailable units |
| `GET /api/property_management/portal/bookings?building=&state=` | `portal.property_bookings.view` | My bookings |
| `POST /api/property_management/portal/bookings` | `portal.property_bookings.manage` | `{ unitId, startsAt, endsAt, notes? }` → `201`; `409` slot taken / outside opening hours / unit unavailable |
| `POST /api/property_management/portal/bookings/{id}/cancel` | `portal.property_bookings.manage` | Cancel one of my bookings |
| `GET /api/property_management/portal/leases` | `portal.property_leases.view` | The company's open proposals (new leases first) and active leases (unit, product, size, term, rate, unavailability, open extension proposal) |
| `POST /api/property_management/portal/lease-proposals/{id}/approve` · `/decline` | `portal.property_leases.manage` | Approve (new lease or extension) or decline; a declined proposal may still be approved until `respondBy`; `409` after it |

### Portal access

Portal features follow the existing `portal.<resource>.<verb>` convention and are granted through `defaultCustomerRoleFeatures` (existing tenants: `yarn mercato customer_accounts sync-customer-role-acls`). Reused: `portal.invoices.view` for invoices (the portal's Invoices section, owned elsewhere). The bell needs no feature — it is part of the portal shell for every signed-in user, and each row is addressed to one user. New, because nothing existing covers units, bookings or leases:

| Feature | Grants | `portal_admin` | `buyer` | `viewer` |
|---------|--------|:--:|:--:|:--:|
| `portal.property_bookings.view` | Bookings page, unit list and slots | ✓ (`portal.*`) | ✓ | ✓ |
| `portal.property_bookings.manage` | Book and cancel own bookings | ✓ | ✓ | — |
| `portal.property_leases.view` | My leases page | ✓ | ✓ | ✓ |
| `portal.property_leases.manage` | Approve or decline lease and extension proposals (a company commitment) | ✓ | — | — |

**Recipients.** Neither event bridge filters by feature, so this module resolves recipients before calling `emitPortalEvent`, as `warranty_claims` and `staff` do: booking events go to the booking's `customer_user_id` when that user holds `portal.property_bookings.view`; lease events go to the active customer users of the lease's company (`customer_entity_id`, capped at 100) who hold `portal.property_leases.view` (proposals: `.manage`), checked with `CustomerRbacService.userHasAllFeatures`. An empty list means no portal event and no bell entry — the domain event is emitted regardless. Bell entries use the same list.

Portal scoping: bookings are scoped to the **customer user** (`customer_user_id`) — a member without a company books and sees only their own bookings; leases are scoped to the customer user's company (`CustomerUser.customerEntityId`), never to a body parameter. `GET portal/units` runs a constant 5 queries per request (building + floors/units, opening rules, unavailability, confirmed bookings for the date, prices via `resolvePriceMany`); slots are computed in memory.

Every endpoint that takes an id of another record (unit, company, person, product, sales channel, status entry) loads it within the caller's organization before use; a foreign or missing id is `422`.

Errors use the platform's error envelope; messages are i18n keys, never raw strings.

## Search (`search.ts`)

Fulltext only (no vector) through the query index (`indexer: { entityType }` on every CRUD route):
- `property_management:building` — name, address.
- `property_management:unit` — name, building name, floor name, product name (from the open product period).
- `property_management:lease` — reference, tenant company name, unit name (denormalized at index time; reindexed on `lease.*` and `unit.updated`).

Bookings are not indexed: the Bookings list filters by date, location and status, and its search box runs against the list query.

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
- **New lease** — one form; a *Send as a proposal* checkbox switches between creating an active lease (order + first invoice) and sending a proposal (quote, *Proposal expires after N days*, prefilled from Settings, with the resulting respond-by date shown). The unit picker lists only units free for the term.
- **Lease detail** — product (locked), the sales order (from the approved proposal or created directly), History card (versions, proposals, invoices per version, linked to sales), *Extend lease* with the same checkbox and a live preview of the tenant's card for proposals.
- **Floor plan** — a unit held by an open proposal keeps the available fill and carries a *Proposed* badge (annotation, like *lease ending*).
- **Bookings list** — "Booked as" column (product + price snapshot) and "Order" column (the booking's sales order, marked cancelled with the booking).
- **Settings** — one `CrudForm` over the keys in §Configuration; the sales channel has no default, and a refused lease, proposal or booking links here while it is unset.
- **Small screens** — the backoffice uses the standard shell, whose sidebar collapses on narrow screens; the floor plan and layout drawings keep their scale and scroll horizontally inside their card rather than shrinking below legibility. The portal booking review map shows only the booked unit's label below 640 px (see Portal).
- DS primitives only: `DataTable`, `CrudForm`, `StatusBadge`, `Alert`, `FormField`, `SectionHeader`, `EmptyState`, `LoadingMessage`, `useConfirmDialog`; semantic status tokens; lucide icons; `aria-label` on icon-only buttons.

**Portal** (`frontend/[orgSlug]/portal/…`, nav *Bookings*, *My leases*, each shown only to holders of its `.view` feature): my bookings; book (location switcher, units grouped by floor with product and space, slots within opening hours, prices in the product's `currency_code`); review with a to-scale "Where it is" map (only the booked unit highlighted; below 640 px the other units lose their labels and a caption names where the unit is); confirmation; my leases (open proposals first, with Approve / Decline for holders of `portal.property_leases.manage`; then one card per active lease of the company: unit + product + size, term, rate, current unavailability, expiry warning identical to the backoffice threshold); lease and extension proposals approved or declined there; bell entries for booking reminders, cancellations and extension offers.

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

Per organization, in the module's own `PropertyManagementSettings` row (Data Models), read and written through `GET`/`PUT /api/property_management/settings` — the `sales_settings` pattern: `billingChannelId` (sales channel for lease and booking documents — required before activation/booking; the API returns `422 billing_channel_missing` otherwise), `cancelledOrderStatusEntryId` (sales order status used for cancelled bookings), `leaseEndingThresholdDays` (int, default 60), `invoiceIssueDay` (int 1–28, default 1), `bookingReminderMinutes` (int, default 60), `proposalExpiryDays` (int 1–90, default 14 — prefills the proposal forms). `moduleConfigService` is not used: it is tenant-scoped (Design Decisions).

## Portal notifications (addition to `notifications`)

The portal already shows a bell (`packages/ui/src/portal/components/PortalNotificationBell.tsx`, `PortalNotificationPanel.tsx`, `usePortalNotifications`) and serves list, unread count, mark read, mark all read and dismiss from `customer_accounts/api/portal/notifications*`, reading `notifications` rows where `recipient_user_id` is the portal user. The live refresh exists too (`notifications.notification.created` is `portalBroadcast`). What is missing is a way to create such a row: every `notificationService` method checks recipients against staff `users` (`getScopedNotificationRecipientUserIds`), so a customer user is rejected, and no module writes portal bell entries today — warranty claims, staff time reports and workflows only send live portal events.

**Change (additive, in `packages/core/src/modules/notifications`):**
- `NotificationService.createForCustomerUsers(input: { recipientCustomerUserIds: string[]; type; titleKey; bodyKey?; titleVariables?; bodyVariables?; linkHref?; sourceModule; sourceEntityType?; sourceEntityId?; groupKey?; severity? }, ctx)` — a new optional method on the DI service (BC §9: methods may be added).
- Recipients are validated against `customer_users` (same tenant, same organization, active, not deleted); any id that fails is rejected, exactly as the staff methods reject foreign users.
- Rows reuse `notificationFactory` and the existing table — `recipient_user_id` holds the customer user id; no column, index or migration change (the column has no foreign key).
- In-app only: no email or push channel delivery, because channel preferences (`notification_preferences`) are staff-user settings.
- Emits the existing `notifications.notification.created` / `batch_created` events with `recipientUserIds`, so the open portal bell refreshes through the existing portal stream.
- Unit tests: a customer user of the tenant gets a row; a staff id, a customer of another organization and a deleted customer user are rejected; no channel delivery is attempted. Integration: a row created this way is returned by `GET /api/customer_accounts/portal/notifications` for that user and not for another.

Shipped as its own PR, owned with the `notifications` maintainers, before Phase 7; until it lands, portal users get live portal events but no bell entries.

## Migration & Backward Compatibility

- New module and tables only; no existing table changes.
- **Planner:** not touched — opening hours are module-owned.
- **Catalog (additive):** one response enricher field set (`propertyManagement: { use, billingUnit }`) and one injected form field; no catalog schema change.
- New event ids, notification ids, ACL features (`property_management.view`, `.manage`, `.availability.manage`, `.leases.manage`, `.bookings.manage`; portal `portal.property_bookings.view|manage`, `portal.property_leases.view|manage`) and API routes are new contract surfaces — frozen once released (`BACKWARD_COMPATIBILITY.md`).
- No change to `moduleConfigService` or `module_configs`.
- **Notifications (additive):** one new optional service method, `createForCustomerUsers`; no schema change; existing methods and events unchanged.
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
1. Lease, LeaseVersion, LeaseProposal, LeaseReferenceCounter entities; update, delete; non-overlapping terms per unit, counting open proposals. *Integration:* a lease overlapping another lease or an open proposal on the same unit → 409; one company holding leases on two units → both succeed.
2. PropertyManagementSettings entity, `property_management.settings.save`, settings API and the Settings page. *Integration:* `PUT` with an issue day of 29 → 422; two organizations of one tenant keep separate channels; creating a lease before a channel is set → `422 billing_channel_missing`.
3. Direct path: `lease.create` and `lease.end` with the hold → create order → link → compensate sequence (scrubbed ctx); undo while uninvoiced. *Integration:* a direct lease is active with an order whose line carries the unit's product and the monthly rate; a forced failure after the order is created leaves no order behind; a retry links an existing order instead of creating a second. (The first-month invoice is issued once Phase 5 lands.)
4. Proposal path: `lease.propose`, `lease_proposal.withdraw / expire`, the quote (`sales.quotes.create`), unit reservation and the Proposed badge data. *Integration:* proposing creates a `sent` quote whose line matches the proposal; the unit cannot be leased to another company meanwhile; withdrawing cancels the quote and frees the unit.
5. New lease form with the *Send as a proposal* checkbox; Leases list (status chips incl. *Proposed*, building filter, search) and detail with sales order link and History card.
6. Extensions on both paths (`lease.extend`, `lease.propose_extension`; one open proposal per lease; preview card); `lease_proposal.sent` event. *Integration:* a second proposal while one is open → 409; a direct extension moves `ends_on` and creates the extension order.

### Phase 3: Bookings
1. Booking entity; `booking.create` (unit row lock, overlap check, `pending` hold, product/price snapshot via `catalogPricingService`, `sales.orders.create`, link, compensation), `booking.cancel` (order cancelled). *Integration:* two concurrent bookings of one slot → exactly one succeeds; a forced link failure deletes the order and frees the slot.
2. `units/{id}/slots` without opening hours; backoffice bookings list with "Booked as". *Integration:* changing the unit's product leaves existing bookings' snapshot unchanged.
3. `booking_sweep` worker (complete past bookings; reminders; reconcile stale `pending` bookings by order metadata) registered via scheduler. *Integration:* a `pending` booking older than 15 minutes with a matching order is confirmed; without one it is released.

### Phase 4: Availability and opening hours
1. Unavailability entity, resolver, `unavailability.create` dry-run/confirm with `previewToken` (cancel bookings + notify + order status), the chunked `unavailability_apply` worker, and `end`. *Integration:* making a floor unavailable today cancels its bookings, flags its active leases, blocks new bookings in the window; a stale preview token → 409.
2. `AvailabilitySwitch` + dialog in every list and form. *Playwright:* switch off on the buildings list → dialog → confirm → row shows reason and end date.
3. OpeningHours + the opening-hours editor on the building form (a switch and open/close times per weekday); slots respect hours. *Unit tests:* `bookingSlots.ts` across opening windows, including a day when the clocks change. *Integration:* booking outside opening hours → 409.
4. "Unit unavailable" lease flag + filter chip.

### Phase 5: Lease invoicing
1. `leasePeriods.ts` + LeaseBillingPeriod ledger, with the partial-month rule from D1 (prorated by days). *Unit tests:* periods and quantities for mid-month start/end.
2. `lease_billing.issue` worker computing totals with `salesCalculationService` and issuing `sales.invoices.create` against the lease order line with the pending → invoice → issued sequence; failures recorded + `lease.invoice_failed` staff notification. *Integration:* running the worker twice for one period issues one invoice; a period left `pending` with an existing invoice is reconciled, not re-invoiced; the invoice's totals equal `salesCalculationService`'s for the same line (tax included).
3. History card lists proposals and invoices per version; the first-month invoice on direct create and on approval; the daily sweep ends leases past `ends_on` and expires unanswered proposals. *Integration:* a direct lease and an approved proposal each get their first invoice at once; a proposal past `respondBy` becomes `expired` and its unit is free.
4. Early `lease.end` reduces the order line to the invoiced months; `lease.update` on an active lease writes a `corrected` version and updates the line. *Integration:* ending a 24-month lease after 10 invoices leaves the order line at 10.

### Phase 6: Floor plan status view
1. `floors/{id}/layout?date=` status projection (6 queries). *Integration:* a lease ending in ≤ 60 days returns `leaseEnding` with days left.
2. `FloorPlanCanvas` with legend, building/floor switcher, unit detail drawers, "Edit floor". *Playwright:* hydration smoke; clicking a unit opens its panel.

### Phase 7: Customer portal
0. *(Separate PR, before this phase)* `notifications.createForCustomerUsers` with its tests (Portal notifications).
1. Portal features in `setup.ts` (`defaultCustomerRoleFeatures`), portal nav + my bookings + book (slots, prices) + review with "Where it is" map + confirmation. *Integration:* customer of company A cannot see or book against company B's data; a `viewer` cannot book (403).
2. My leases (open proposals first, then every active lease of the company) + approve / decline for new-lease and extension proposals (re-approve until deadline). *Integration:* a company with two leases sees both; approving a new-lease proposal makes the lease active with an order and a first invoice; approving after `respondBy` → 409; a `buyer` sees the proposal but cannot answer (403); a quote edited in sales after sending → `409 quote_changed`.
3. Portal notifications (reminder, cancellation, proposals) + portal-only `*.portal_changed` events through `emitPortalEvent`, recipients resolved by feature; bell entries through `createForCustomerUsers`. *Unit test:* `emitPortalEvent` with an empty recipient list emits nothing. *Integration:* a proposal event reaches the tenant company's `portal_admin` and not another company's users or a user without `portal.property_leases.view`; a manager's booking for a customer (no `customer_user_id`) emits `booking.created` and no portal event.

### Testing Strategy
Pure libs (geometry, numbering, periods, slots) by unit tests; drag and drop, availability dialog, booking flow and floor plan by Playwright; concurrency tests for booking overlap and billing idempotency. Integration coverage per API path (each test creates its fixtures through the API and cleans up):

| API path | Phase | Covered by |
|----------|-------|------------|
| `buildings` CRUD, `POST buildings/{id}/floors/layout` | 1 | create with 1 below / 3 above → floors −1…2; lowering past a floor with units → 422; delete of a used building → 409 |
| `floors` CRUD (name, size) | 1 | resizing a floor smaller than a unit on it → 422 |
| `spaces` CRUD | 1 | overlapping space → 422; shrinking a space that strands a unit → 422; deleting the default space of a floor with units → 409 |
| `units` CRUD, `POST units/{id}/product` | 1–2 | overlapping unit → 422; product change → new history period; product change with an active lease → 409 |
| `common-areas` CRUD | 1 | common area overlapping a unit → 422 |
| `product-uses` + catalog enricher | 1 | flagged product enriched on `GET /api/catalog/products` |
| `settings` GET/PUT | 2 | issue day 29 → 422; per-organization values |
| `POST leases` (direct and `asProposal`), `leases` list/detail/update/delete, `/end` | 2, 5 | direct → active + order; proposal → quote + reserved unit; overlap with a lease or open proposal → 409; compensation; early end reduces the order line |
| `leases/{id}/extensions` POST, `…/proposals/{id}` DELETE | 2 | direct extension moves `ends_on`; second open proposal → 409; withdraw → quote canceled, portal no longer shows it |
| `unavailabilities` (dry run, confirm), `unavailabilities/{id}/end` | 4 | cancels and flags; stale preview → 409; end → new bookings allowed again |
| `units/{id}/slots` | 3–4 | slots exclude bookings, unavailability and closed hours |
| `bookings` list, `POST bookings`, `bookings/{id}/cancel` (backoffice) | 3 | "Booked as" snapshot unchanged after a product change; a manager's booking without a portal user emits `booking.created` and no portal event; cancel moves the order to the cancelled status |
| `floors/{id}/layout?date=` | 6 | lease ending in ≤ threshold → `leaseEnding` |
| `portal/units`, `portal/bookings` GET, POST, `/{id}/cancel` | 7 | company isolation; `viewer` cannot book; cancelling another user's booking → 404 |
| `portal/leases`, `portal/lease-proposals/{id}/approve` · `/decline` | 7 | two leases listed; approve → active + order + invoice; expired → 409; `buyer` cannot answer; `quote_changed` → 409 |
| CLI `mercato property_management billing:run` | 5 | issues due invoices once; second run issues none; running it while the worker runs never invoices a period twice |

## Edge Cases & Failure Scenarios

| Scenario | Behaviour the user sees |
|----------|-------------------------|
| Opening hours are narrowed while bookings exist outside the new hours | Existing bookings are kept; the save dialog lists them so the manager can cancel individually. New bookings follow the new hours. |
| A space is shrunk so a unit would stick out | Save is disabled; the message names every unit outside the space (US-G4). |
| A floor is resized smaller than its spaces/units | `422` naming what would fall outside; the floor size field shows the error. |
| A unit's product is deleted in the catalog | Snapshots keep leases, bookings and history intact; the unit shows a "product missing" warning and cannot take new leases or bookings until a product is set. |
| A product's use changes from bookable to leasable in the catalog while units have future bookings | The product-use edit is refused with the list of affected units and bookings. |
| The sales command fails while creating a lease or booking | Nothing was created in sales; the lease or booking hold is released; the error is shown. |
| Approval fails part-way (conversion, overlap, lock timeout) | The whole approval rolls back: the quote still exists, the proposal keeps its state, the portal shows the error and the customer can approve again. |
| The customer approves after the deadline | `409 proposal_expired`; the card shows the proposal as expired and suggests contacting the building manager. |
| A proposal's quote is edited in the sales backoffice after it was sent | Approval is refused with `409 quote_changed`; the manager withdraws and proposes again. |
| The unit becomes unavailable while a proposal is open | Approval is refused until it is available again for the term; the proposal is not withdrawn automatically. |
| Linking fails after the sales order was created | The order is deleted (compensation) and the user sees the error; if deleting fails too, staff get an "orphaned order" notification naming the order, and a retry links it instead of creating another. |
| The scheduler module is not installed | No automatic invoices; the leases page shows a banner and the CLI `mercato property_management billing:run` issues due invoices. |
| Two managers make overlapping floors/spaces unavailable | Both rows stand; the effective availability is their union; ending one leaves the other in force. |
| A building is archived while the portal page is open | The next booking attempt fails with `409 location_unavailable`; the location switcher marks it unavailable on reload. |

## Risks & Impact Review

### Data Integrity Failures
- **Double booking** under concurrency — mitigated by the unit row lock + overlap check in one transaction; integration test with parallel requests.
- **Duplicate invoices** from worker retries — unique `(lease_id, period_start)` ledger row claimed as `pending` before the invoice is created; a retry looks the invoice up by its metadata key before creating one.
- **Layout drift** (a unit outside its space) — invariants enforced by commands, not only the UI; space updates re-validate contained units.

### Cascading Failures & Side Effects
- **Unavailability cancels many bookings** — dry run shows exactly what is cancelled; the confirm button states the count; up to 200 cancellations run in the confirm transaction, larger sets in chunks on the `unavailability_apply` worker; notifications emitted after commit.
- **Sales command failure during booking, lease creation or approval** — sales documents commit on their own, so failures after them are compensated (order deleted) rather than rolled back; orphans are reported to staff and re-linked on retry.

### Tenant & Data Isolation Risks
- Portal endpoints derive the company from `CustomerUser.customerEntityId`, never from the request body; every query filters by `organization_id`.

### Migration & Deployment Risks
- New tables only; no other module's code changes.

### Operational Risks
- **Scheduler absent** — invoices not issued; detected by a banner on the leases page and the `billing:run` CLI; documented in setup.
- **Sales channel not configured** — creating or proposing a lease and booking return `422 billing_channel_missing`; settings page links to configuration.

### Risk Register

| Risk | Affected area | Severity | Likelihood | Mitigation | Residual |
|------|---------------|----------|-----------|------------|----------|
| Concurrent double booking | bookings | High | Medium | Row lock + overlap check + test | Low |
| Duplicate lease invoice | lease invoicing, sales invoices | High | Low | Unique ledger key + idempotent worker | Low |
| Unavailability cancels bookings by mistake | availability, bookings, customers | Medium | Medium | Dry-run preview, explicit count on confirm, reason required | Medium (cancellations are not undone) |
| Floor plan slow for large floors | floor plan, layout API | Medium | Low | Single layout endpoint, constant query count, CSS-positioned tiles | Low |
| Worker crash between invoice and ledger update | lease invoicing | High | Low | Pending claim row + reconciliation by invoice metadata key | Low |
| Closing a whole building cancels thousands of bookings | availability worker | Medium | Low | Row takes effect at once; cancellations chunked on a worker with progress | Low |
| Buildings in different timezones in one installation | slots, billing, sweeps | Medium | Low | All values are building-local wall-clock; "now" is the deployment clock, so a building in another timezone would see reminders and expiry shifted — documented limitation; an optional building timezone can be added later without migrating stored values | Low |
| Duplicate reminders on sweep reruns | portal notifications | Low | Medium | `reminder_sent_at` set in the same transaction as the send | Low |
| Orphaned sales order after a failed link | leases, bookings, sales orders | Medium | Low | Compensating delete; metadata lookup on retry and in the sweep; staff notification | Low |
| Portal event reaches the wrong customer | portal, leases, bookings | High | Low | Portal-only event ids emitted solely through `emitPortalEvent`, which refuses an empty recipient list; recipients resolved by company and feature | Low |
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
| packages/core → Encryption | Sensitive fields in `encryption.ts`, `findWithDecryption` | Compliant | `Booking.notes`, `LeaseProposal.message` |
| packages/core → Events / Notifications | `createModuleEvents`, singular past-tense ids | Compliant | Commands & Events |
| catalog AGENTS.md | Prices via `catalogPricingService`, never inline | Compliant | Booking and unit-period price snapshots |
| sales AGENTS.md | Use `salesCalculationService`; scope documents to a channel | Compliant | orders: `sales.orders.create` computes totals; invoices: this module computes them with `salesCalculationService` before `sales.invoices.create`; `billingChannelId` setting |
| sales AGENTS.md (as corrected in #7475) | Quote → Order → Invoice (quote optional) | Compliant | Leases and bookings both use the direct-order path (`orderCreateSchema` has no quote reference; the backoffice and `warranty_claims` create orders directly); leases then invoice against their order |
| queue AGENTS.md | Idempotent workers, `metadata` export, concurrency ≤ 20 | Compliant | Ledger key; concurrency 1 |
| ui AGENTS.md | `CrudForm`, `DataTable`, `apiCall`, `useGuardedMutation` | Compliant | Frontend Architecture Contract |
| root AGENTS.md | Integration tests ship with the feature | Compliant | Per-path coverage table in Testing Strategy |
| customer_accounts | Portal features `portal.<resource>.<verb>` via `defaultCustomerRoleFeatures` | Compliant | Portal access |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Every custom endpoint maps to listed entities |
| API contracts match UI/UX section | Pass | Dry-run availability, slots, layout, portal endpoints |
| Risks cover all write operations | Pass | Booking, billing, unavailability, layout, lease creation, proposals |
| Commands defined for all mutations | Pass | Commands table |
| Cache strategy covers all read APIs | Pass | No module cache in MVP; layout endpoint bounded to 6 queries; revisit if floor plans exceed 200 units |

### Non-Compliant Items
None. Open dependency: portal bell entries need the additive customer-user path in `notifications` (D2), shipped as its own PR.

### Verdict
**Compliant** — in review on #7472.

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
- **Verdict**: Approved at the time; superseded by the review of #7472 below.
- Booking orders without a quote confirmed as the supported direct-order path (maintainer, verified against `orderCreateSchema` and the backoffice document-create page); the sales sign-off gate on Phase 3 and Phase 7 Step 1 removed.

### Review of #7472 — 2026-10-15
- **Reviewer**: fresh-context agent running `om-auto-qa-pr` read-only; findings verified by the author.
- **Changes**: leases bill against an order created directly (no quote — conversion deletes it); settings moved to a module-owned per-organization table; sales writes compensate instead of rolling back; portal pages, endpoints, events and bell entries gated by new `portal.property_bookings.*` / `portal.property_leases.*` features with recipients resolved by the module; one lease at a time per unit, any number per company, portal *My leases*; invoice totals computed with `salesCalculationService`; per-path integration coverage; lease reference counter and search indexing specified; planner import precedent corrected; Open Questions Q1–Q6 added.
- **Lease paths (maintainer, after review)**: a lease is created directly (active, order, first invoice) or as a proposal (sales quote approved or declined by the customer's portal user on My leases; the unit is reserved until answered or expired). Extensions get the same two paths; `LeaseExtensionOffer` became `LeaseProposal`; the draft status is gone. Q4 resolved.
- **Defaults accepted (maintainer)**: Q1–Q6 resolved as D1–D6; proposal expiry in days added as a lease-form field with an organization default (D7).
- **Second QA review (maintainer decisions)**: proposal approval runs in one transaction with `convert_to_order` on the shared EntityManager (compensation only for direct orders, bookings and invoices); opening hours are a module-owned `OpeningHours` table with a simple editor — planner is no longer touched; domain events are always emitted, and portal notifications use separate portal-only `*.portal_changed` events that require explicit recipients.
- **Timezone and portal notifications (maintainer)**: no timezone setting — every date and time is building-local wall-clock, "now" is the deployment clock (multi-timezone installations are a documented limitation); the building's `timezone` column is removed. Portal bell entries come from a new additive `notifications.createForCustomerUsers` (own PR before Phase 7); the portal bell UI and read APIs already exist.
- **Third pass (maintainer: billing in advance; remaining findings)**: billing in advance with a Billing section (first period on order, later periods on the issue day, early end credited with credit memos); ledger claims with `FOR UPDATE SKIP LOCKED` shared by worker and CLI; each lease version keeps its own order; unavailability confirm takes the unit locks; backoffice booking contracts; lease delete only without invoices (module checks before `sales.orders.delete`); no undo for `lease.create`; time-free proposal uniqueness and a `withdrawn` lease status; scoping of referenced ids; missing commands (settings, product use, booking completion, proposal reminders); small-screen guidance; traceability fixes. The `sales/AGENTS.md` correction moved to its own PR (#7475). (The Open Questions list referenced above became "Decisions after review".)
