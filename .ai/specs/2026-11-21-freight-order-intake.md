# Freight order intake: bulk import and customer portal orders

**Status:** Implemented (2026-11-21)
**Module:** `apps/mercato/src/modules/freight_operations`
**Related:** [`2026-11-21-leandispatcher-feature-parity.md`](../plans/2026-11-21-leandispatcher-feature-parity.md), [`2026-10-10-freight-program.md`](2026-10-10-freight-program.md)

## TLDR

Add the two missing order-intake paths from the LeanDispatcher comparison:

1. **Bulk order import** — upload a CSV/XLSX of orders for one customer, validate every
   row with the single-order schema, then commit only the rows the preview called valid.
2. **Customer portal orders** — an authenticated portal customer submits a transport
   order; staff see it in an **External orders** review queue, approve it into the normal
   order lifecycle, or reject it with a reason.

Both paths create ordinary `FreightOrder` rows; the existing confirm/assign/dispatch/
deliver/complete/invoice lifecycle is untouched.

## Problem Statement

The freight module can create orders only through the staff form. LeanDispatcher's
operators batch-create orders from spreadsheets and let customers raise orders themselves.
Without those paths, an operator re-types a customer's sheet and a customer has to phone or
email the order — exactly the manual work the product is meant to remove.

## Proposed Solution

### Bulk import

- A sheet is scoped to **one customer** chosen in the import dialog; the sheet therefore
  carries cargo, lane, dates, truck type, quantities, amount and notes, but not a customer
  column on every row.
- Header aliases accept the spellings a transport office uses (`Cargo`, `Pickup`, `To`,
  `Price`, …). Unknown headers are reported, not silently dropped.
- The client parser normalizes dates (`YYYY-MM-DD` and `DD/MM/YYYY` → ISO instant),
  numbers (`12,000` → `12000`), booleans (`yes/no`) and enums (truck type, cargo unit).
- `POST /api/freight_operations/orders/import` runs the same `createOrderSchema` the single
  order route uses in both `dry-run` and `commit` modes. A row that fails validation is
  reported with its Zod path; commit creates only valid rows through
  `freight_operations.orders.create`, sequentially, and reports per-row `created`/`failed`.
- No partial silent write: the commit response names every created, failed and invalid row.

### Customer portal orders

- A portal user with `portal.freight.orders.create` submits cargo/lane/dates/truck type/
  quantities/notes. The server derives the customer id and snapshot from the authenticated
  `CustomerAuthContext` — never from the request body.
- The order is created as a **draft** with `source = 'customer_portal'` and
  `submitted_at = now`, through a dedicated command
  (`freight_operations.orders.submit_external`) that allocates the normal order number.
  The price starts at zero; staff set the commercial amount during review.
- The portal presents a draft external order as **Submitted**; the underlying status stays
  `draft` so no duplicate state machine is introduced.
- Staff review lives at `/backend/freight/external-orders`: orders filtered by
  `source = customer_portal` and `status = draft`.
  - **Approve** runs the existing `confirm` command (draft → confirmed).
  - **Reject** runs the existing `cancel` command with a required reason; the order becomes
    `cancelled` and disappears from the queue while remaining visible in the full list.
- The portal list returns only the authenticated customer's `customer_portal` orders, with
  the raw lifecycle status mapped for display.

## Architecture

- Entity additions: `freight_orders.source` (`staff|customer_portal`, default `staff`) and
  `freight_orders.submitted_at` (nullable), added by one additive migration; existing rows
  default to `staff`.
- No new order statuses: draft/confirmed/assigned/in_transit/delivered/completed/invoiced/
  cancelled remain the only states. Approval reuses `confirm`; rejection reuses `cancel`.
- The portal route authenticates with `getCustomerAuthFromRequest`, checks
  `CustomerRbacService`, and builds a `CommandRuntimeContext` exactly like the existing
  abstract-response route.
- The command emits the normal CRUD side effects plus
  `freight_operations.order.submitted`.
- Bulk import is a normal authenticated staff route behind `freight.orders.manage` and
  runs through the route mutation guard.

## Data Models

| Entity | Table | Change |
|---|---|---|
| `FreightOrder` | `freight_orders` | Add `source` (text enum, default `staff`), `submitted_at` (timestamptz, nullable) |

No other table changes. `FreightOrder.updated_at` continues to drive optimistic locking.

## API Contracts

Staff:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/freight_operations/orders/import` | `dry-run` or `commit` a batch of orders for one customer |
| GET | `/api/freight_operations/orders?source=customer_portal&status=draft` | External-order review queue feed |
| POST | `/api/freight_operations/orders/confirm` | Approve a submitted order |
| POST | `/api/freight_operations/orders/cancel` | Reject a submitted order with a reason |

Portal (customer auth, no staff bearer token):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/portal/freight/orders` | List the customer's submitted orders |
| POST | `/api/portal/freight/orders` | Submit a new order for staff review |

The portal POST requires `portal.freight.orders.create`; the GET requires
`portal.freight.view`. Buyer portal roles receive the create feature by default.

## UI

- Orders list toolbar: **Import orders** opens the customer picker, file picker, template
  download, per-row validation preview, and a two-step Validate → Import flow.
- `/backend/freight/external-orders`: order number, customer, lane/cargo, requested
  pickup, submitted date and an "Awaiting review" badge; row actions View / Approve /
  Reject (reason dialog).
- `/[orgSlug]/portal/freight/orders`: the customer's order list with a status badge and a
  **Request an order** dialog covering cargo, lane, dates, truck type, quantities, hazard/
  refrigeration flags and notes.
- All strings in six locales; Arabic authored first-class.

## Integration Coverage

- Unit: `lib/__tests__/orderImport.test.ts` (header aliases, date/number/enum/boolean
  normalization, missing columns, template headers).
- `TC-FREIGHT-011-order-import`: dry-run reports two valid and one invalid row; commit
  creates exactly the two valid orders and the list returns them for the selected customer.
- `TC-FREIGHT-012-portal-orders`: a portal user submits orders, the staff queue sees the
  source, staff approve moves the portal status to `confirmed`, and a rejected order shows
  as `cancelled` in the portal.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Customer-submitted order carries a zero price and is invoiced before staff edit it | High | Approval only moves draft → confirmed; invoicing requires completed, and the staff edit form is available while draft/confirmed | Staff can approve without setting a price; the order total is zero until edited |
| Portal user is linked to the wrong customer entity | High | Customer id comes from the authenticated session, never the request body; the portal list filters by the same ids | A mislinked portal account still sees that customer's orders |
| Bulk import commits a partially valid batch | Medium | Dry-run is the mandatory preview; commit re-validates with the same schema and reports each row; invalid rows are never attempted | A valid row can fail at command level (e.g. numbering contention) and is reported as `failed` |
| Import sheet uses a locale-specific date format | Medium | Parser accepts ISO, `YYYY-MM-DD` and day-first `DD/MM/YYYY`; anything else is a row error before writing | US month-first dates are interpreted day-first by design |
| Source column changes existing list contracts | Low | Additive column with a default; existing staff-created rows read `staff`; list projection and OpenAPI are additive | None |
| No notification when a customer submits an order | Medium | The queue is a dedicated screen and the event is emitted for future subscribers | Staff must open the queue; Phase 3 adds notifications |

## Final Compliance Report

- Tenant/organization scoping on every read and write; portal reads are scoped by the
  authenticated customer entity ids.
- No cross-module ORM relations; portal auth and RBAC use their public services.
- Optimistic locking: the import creates new rows; staff actions reuse the locked order
  commands; portal submission is create-only.
- All user-facing strings via i18n (six locales); Arabic authored.
- Additive migration + snapshot included; no existing column or API contract changed.
- Integration tests ship with the change.

## Changelog

- **2026-11-21** — Initial spec and implementation: bulk order import with dry-run/commit,
  customer portal order submission, external-order review queue, source/submitted-at
  columns, six-locale i18n, unit and integration coverage.
- **2026-11-21 (validation)** — `TC-FREIGHT-011` and `TC-FREIGHT-012` pass against the local dev
  server after applying the source/submitted-at migration; `yarn typecheck`, `yarn lint`,
  `yarn i18n:check-sync`, the freight unit tests and `yarn build:app` are green.
