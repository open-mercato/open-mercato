# Freight delivery notes and Bayan Naql waybill references

**Status:** Implemented — Phase 1 (2026-11-21)
**Module:** `apps/mercato/src/modules/freight_operations`
**Related:** [`2026-10-10-freight-program.md`](2026-10-10-freight-program.md), [`2026-10-10-freight-phase-1-spot-orders-and-invoicing.md`](2026-10-10-freight-phase-1-spot-orders-and-invoicing.md), [`../../.ai/plans/2026-11-21-leandispatcher-feature-parity.md`](../plans/2026-11-21-leandispatcher-feature-parity.md)

## TLDR

Add a first-class **delivery note** to freight operations: a numbered, printable transport
document generated from a spot order or a freight trip, carrying the seller, consignee, cargo,
lane, driver and vehicle at the moment of issue. A delivery note can also record the number and
status of the external **Bayan Naql** waybill an operator issues on the TGA platform, so the
external document and the internal delivery record never drift apart.

The slice closes the largest gap between our freight module and LeanDispatcher: today the only
"delivery note" is a free-text `pod_reference` label. It also gives the existing POD fields a
real document to attach to, and a printable receipt the consignee can sign.

**Out of scope here:** direct TGA/Bayan API submission, official TGA/Bayan logos, and a public
share link. Those are separate, externally gated integrations.

## Problem Statement

1. **The transport document is missing.** A freight order can be confirmed, assigned, dispatched,
   delivered and invoiced, but nothing produces the document that travels with the goods. The
   only trace is `freight_orders.pod_reference` / `freight_trips.pod_reference`, an unvalidated
   free-text column (`data/entities.ts:170-174`, `data/entities.ts:537-547`). A customer asking
   for the delivery note receives a string.
2. **Bayan Naql has no home in the model.** KSA land transport runs on a Bayan Naql waybill
   (بيان نقل) issued on the TGA platform. Our system cannot store its number, issue/cancel
   state, or a link to it, so an operator has to keep the two systems in their head.
3. **POD is a bare UUID.** `pod_document_id` is accepted from the request without an attachment
   flow; the delivery note gives the POD a parent document and a receipt action.
4. **There is no printable document at all in freight.** Invoices live in `sales`; the freight
   module produces no HTML/PDF. Operators cannot hand a consignee a signed receipt from the ERP.

## Proposed Solution

### One document, two layers

A single `FreightDeliveryNote` entity holds:

- **The internal delivery note** — number `DN-00001`, status, snapshots, printable layout.
- **The external waybill reference** — `external_waybill_number`, status, timestamps and URL for
  the Bayan Naql document the operator issues separately. Recording the reference is manual in
  this slice; a future adapter can fill the same columns through the TGA API without changing the
  document model.

The internal note is authoritative for "what left and who received it"; the external reference is
authoritative for "what the regulator's platform knows". A delivery note cannot be cancelled while
its external waybill is still recorded as live — the two lifecycles are checked against each other.

### Source of truth

A delivery note is always created from a source, never typed from scratch:

- **Spot order** — `freightOrderId`. The order must be `confirmed`, `assigned`, `in_transit`,
  `delivered`, `completed` or `invoiced` (not `draft`/`cancelled`). Cargo, lane, customer,
  requested dates, price context, and the assigned vehicle/driver are copied.
- **Freight trip** — `freightTripId`. The trip must not be `cancelled`. Lane, customer, vehicle
  and driver are copied; cargo comes from the linked spot order when one exists, otherwise the
  operator supplies a description, quantity and unit at create time.
- If both ids are supplied, the trip must belong to the order.

At **issue**, the note re-reads the current vehicle/driver and seller settings and writes the
snapshots, so a draft created before assignment still issues with the final driver. Issued
snapshots are frozen: editing is allowed only in `draft`.

### State machine

```
draft ──issue──▶ issued ──deliver──▶ delivered
  │                │
  └────cancel──────┴────▶ cancelled
```

- `issue`: requires a driver and a vehicle (id or snapshot) and a seller name. Writes
  `issued_at` and the seller/vehicle/driver snapshots.
- `deliver`: requires `receivedByName` plus a POD document id or reference. Writes
  `delivered_at`.
- `cancel`: requires a reason; refused while `externalWaybillStatus = 'recorded'`.
- Delete: `draft` only. Issued/delivered documents are cancelled, never deleted.

Every transition enforces the platform optimistic lock (`updatedAt` + the expected-version
header) and runs inside a pessimistic-locked transaction, mirroring the order/trip commands.

### Numbering

Reuses `FreightDocumentSequence` with a new kind `delivery_note` and a tenant setting
`deliveryNoteNumberPrefix` (default `DN`). The partial unique index on
`(organization_id, tenant_id, note_number)` is the backstop.

## Architecture

- New entity in `freight_operations/data/entities.ts`; no cross-module ORM relation.
- Source reads are scoped queries on the module's own `FreightOrder`/`FreightTrip`.
- Seller snapshot comes from `saudi_localization` VAT settings through the existing
  `readSaudiVatSettings` helper (pure import, no hard dependency; defaults to empty).
- Vehicle/driver snapshots come from `lib/transportReference.ts` at issue, with the stored
  order/trip snapshot as the fallback when `transport_operations` is disabled.
- Commands follow the existing `registerCrudCommands` + action-command pattern; events follow
  `events.ts`; indexing follows `commands/entities.ts`.
- No new production dependency: the print layout is a React page and the browser's print dialog.

## Data Models

| Entity | Table | Purpose |
|---|---|---|
| `FreightDeliveryNote` | `freight_delivery_notes` | Printable transport delivery note + external waybill reference |

Fields (all tenant/organization scoped, `created_at`/`updated_at`/`deleted_at`):

- Identity: `id`, `note_number`, `status`, `created_by`
- Source: `freight_order_id`, `freight_trip_id`, `order_number_snapshot`, `trip_number_snapshot`
- Parties: `customer_id`, `customer_snapshot`, `seller_snapshot`
  (`sellerName`, `vatRegistrationNumber`, `commercialRegistrationNumber`)
- Consignee: `consignee_name`, `consignee_phone`, `consignee_address`, `received_by_name`,
  `received_by_id_number`
- Route: `origin`, `destination`, `requested_pickup_at`, `requested_delivery_at`
- Cargo: `cargo_description`, `cargo_quantity`, `cargo_unit`, `cargo_weight_kg`,
  `cargo_volume_m3`, `cargo_hazardous`, `cargo_refrigerated`, `seal_number`
- Execution: `vehicle_id`, `driver_id`, `vehicle_snapshot`, `driver_snapshot`
- Delivery: `issued_at`, `delivered_at`, `pod_reference`, `pod_document_id`, `pop_reference`,
  `pop_document_id`
- External waybill: `external_waybill_number`, `external_waybill_status`
  (`not_recorded|recorded|cancelled`), `external_waybill_url`, `external_waybill_recorded_at`,
  `external_waybill_cancelled_at`, `external_waybill_notes`
- Lifecycle: `cancellation_reason`, `cancelled_at`, `notes`

State enums are CHECK constraints in the migration, matching the module's existing text-enum
convention (`freight_orders_status_check` etc.).

## API Contracts

Staff routes (all `requireAuth`; read `freight.read`, write `freight.delivery_notes.manage`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/freight_operations/delivery-notes` | Paged list; filters `status`, `freightOrderId`, `freightTripId`, `customerId`, `search`, `ids` |
| POST | `/api/freight_operations/delivery-notes` | Create a draft from `freightOrderId` or `freightTripId` |
| PUT | `/api/freight_operations/delivery-notes` | Update consignee/notes/cargo overrides while `draft` |
| DELETE | `/api/freight_operations/delivery-notes` | Soft-delete a draft |
| POST | `/api/freight_operations/delivery-notes/issue` | `draft → issued`, snapshot seller/vehicle/driver |
| POST | `/api/freight_operations/delivery-notes/deliver` | `issued → delivered` with POD |
| POST | `/api/freight_operations/delivery-notes/cancel` | `draft|issued → cancelled` with reason |
| POST | `/api/freight_operations/delivery-notes/record-waybill` | Record/cancel the external Bayan Naql number |

Responses follow `makeCrudRoute` (`{ items, total, page, pageSize }`) and the action routes return
`{ ok, deliveryNoteId }` with the platform error shape. The list projection returns
`updatedAt` for optimistic locking.

Events: `delivery_note.created|updated|deleted` (CRUD) plus
`delivery_note.issued|delivered|cancelled|waybill_recorded` (lifecycle).

## UI

- **Order detail** (`/backend/freight/orders/[id]`): a "Delivery notes" section listing the
  order's notes with Create / Issue / Print / Record delivery / Cancel / Record waybill actions.
- **Trip detail** (`/backend/freight/trips/[id]`): the same section for trip sources.
- **List** (`/backend/freight/delivery-notes`): status/source/customer filters and row actions.
- **Detail** (`/backend/freight/delivery-notes/[id]`): document fields, delivery/POD card,
  external waybill card, and a **Print** action that renders an A4 layout with the seller,
  consignee, cargo, lane, driver/vehicle and signature line. The layout carries the note
  "This is a delivery note, not a tax invoice" and does not use TGA/Bayan logos.
- All strings go through the six module locale dictionaries; Arabic is authored.

## Integration Coverage

- Unit: state-machine transitions, issue-content validation, number formatting, waybill/cancel
  interaction.
- Integration `TC-FREIGHT-010-delivery-notes`: create an order and a vehicle/driver fixture →
  create a note → issue → record a waybill → deliver with POD → cancel refused while waybill is
  live → cancel waybill → cancel note; a second organization cannot read the note.
- UI paths listed above are exercised by the same spec through the API and a smoke assertion on
  the list/detail payloads; Playwright UI coverage is added with the page implementation.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| The internal note is mistaken for a TGA-approved Bayan Naql document | High | Print layout says "not a tax invoice"; external waybill fields are visibly separate; spec and UI label the external reference "recorded manually" | Operators must still issue the real waybill on Bayan until the adapter ships |
| Delivery note diverges from the order after issue | Medium | Issued snapshots are frozen; editing is draft-only; issue re-snapshots current driver/vehicle | An order changed after issue does not rewrite the document (intended) |
| Cancelling a note while the external waybill is live | High | `cancel` refuses with 409 `waybill_active` until the waybill is recorded as cancelled | An operator can still omit the external reference entirely |
| Source order/trip is deleted after note creation | Low | Source ids are stored with number snapshots; the note remains printable | The detail link goes to a missing record; the document still stands |
| Attachments are not uploaded in this slice | Medium | `pod_document_id`/`pop_document_id` accept ids from the attachments module; the UI records a reference first | A future attachment picker fills the ids; the printed receipt already works |
| New sequence kind breaks the existing check constraint | Medium | Migration drops and recreates `freight_document_sequences_kind_check` with `delivery_note`; snapshot updated | Migration must run before the first note in a deployed environment |

## Final Compliance Report

- Tenant/organization scoping on every table, read and action; no cross-tenant access.
- No cross-module ORM relationships; seller settings and fleet data are pure/tolerant reads.
- Optimistic locking on the entity and every mutating action.
- All user-facing strings via i18n (six locales); Arabic authored first-class.
- No new production dependency.
- Backward compatible: additive table, additive ACL feature, additive routes, additive settings
  key with a default. No existing contract changes.
- Migration + snapshot ship with the change; `yarn db:migrate` is not run by the agent.

## Changelog

- **2026-11-21** — Initial spec and implementation. Internal delivery note + manual Bayan Naql
  reference; print layout; POD receipt; order/trip integration; list/detail screens; six-locale
  i18n; unit tests and `TC-FREIGHT-010`. Validation: `yarn generate`, `yarn db:generate` (only the
  freight migration), `yarn typecheck`, `yarn lint`, `yarn i18n:check-sync`, and the freight unit
  tests are green. The integration spec is authored but not executed here because the new
  migration has not been applied to the local database. Direct TGA/Bayan API submission and public
  share links remain out of scope.
