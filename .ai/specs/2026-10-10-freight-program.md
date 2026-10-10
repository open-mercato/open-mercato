# Freight operations program (Saudi-first land transportation)

## TLDR

Add the commercial half of land transportation to the app: one-time truck orders (spot), freight
contracts with fixed routes and per-route prices, executed trips as billing units, and periodic
trip abstracts (كشف الرحلات) that customers review/approve in the portal before invoicing.
Ships as a new app-local module `freight_operations` with a sales-backed money layer.

## Problem Statement

The platform already ships the operational half of transport (`transport_operations`: vehicles,
drivers, routes, trip schedules, dispatch/complete) but nothing commercial: there is no truck
order, no freight contract, no per-route rate, no executed-trip billing record, and no trip
abstract. A transport company running on this platform today can schedule a trip but cannot
answer "what did this customer buy, what was performed, what do we bill, and did the customer
agree to the bill?" — the exact loop that freight operations in KSA run on (monthly abstracts
reviewed by the customer, then an invoice, then bank-transfer settlement).

The user's product shape (decided 2026-10-10):

1. **Freight first.** Passenger/school transport (B2B schools + B2C parents) is the next program.
2. **Spot orders**: rent a truck for one job — cargo, pickup/drop-off, agreed price, assignment,
   execution, proof of delivery, direct invoice.
3. **Contract freight**: contracts with fixed routes × fixed prices (per trip / ton / km / hour /
   day / round trip / flat monthly with minimum charge), validity, billing cycle, payment terms.
4. **Contract trips**: recorded against a rate line with the price **snapshotted**; optional extra
   charges (waiting, tolls, border, loading).
5. **Trip abstracts with full approval flow**: generate for a period → submit → customer reviews
   in the portal, disputes individual trip lines → staff resolves (accept / adjust / remove /
   reject) → approved → invoice → payments recorded (bank transfer; no gateway).
6. **Per-contract setting `requiresCustomerApproval`**: when off, staff finalize the abstract
   internally and invoice directly — no customer gate. Snapshotted per abstract at generation.
7. **Customer portal**: freight customers view contracts, abstracts (dispute/approve), invoices.
   Staff can record an offline customer approval as the fallback.

## Proposed Solution

### The one hard constraint everything follows from

Code-verified constraints in the core `sales` module:

- `SalesInvoice` has **no customer column** (`packages/core/src/modules/sales/data/entities.ts`) —
  the billing party lives on the `SalesOrder`.
- `sales.payments.create` **requires `orderId`** and recomputes only *order* payment totals;
  invoice `paidTotalAmount`/`outstandingAmount` are written only by explicit input.
- ZATCA preview reads `SalesOrder`/`SalesOrderLine` only (order-level).

Therefore: **a freight invoice is always a sales order → invoice pair**, created via the
**command bus** — the sanctioned cross-module pattern proven by
`warranty_claims/commands/claims.ts` (`commandBus.execute('sales.orders.create', { input, ctx:
scrubbedDispatchContext(ctx) })` + compensating `sales.orders.delete`). Payments are recorded as
`sales.payments.create` (allocation to the invoice) plus an explicit `sales.invoices.update`
totals sync; when the sync fails the abstract carries `invoice_synced_at = null` and the UI shows
a "Resync invoice totals" action — visible degradation, never silent inconsistency.

### Three sanctioned axes of coupling

| Axis | Mechanism | Example |
|---|---|---|
| Billing party | CRM customer **id + snapshot** | `customer_id` + `customer_snapshot` jsonb on every freight document |
| Fleet master data | **id + snapshot** + tolerant scoped reads | `vehicle_id` + `vehicle_snapshot`; pickers read `transport_*` tables via Kysely with `42P01` tolerance |
| Money layer | **command bus** into `sales` | order → invoice → payment → invoice-totals sync |

No cross-module ORM relations. No `requires` on `transport_operations` or `saudi_localization`
(it ships standalone; VAT primitives are imported as pure functions and settings default
gracefully).

### Module

`apps/mercato/src/modules/freight_operations/` — app-local, sibling of `transport_operations`,
`hr_management`, `fleet_management`, `financial`. `requires: ['customers', 'sales', 'configs']`.

### Why the abstract lives in freight, not `sales` or `financial`

The abstract is not an accounting document: it is a per-line negotiation surface (disputes are
per trip) whose lifecycle ends in a sales invoice. `financial` is GL-only today (no AR), and
`sales` has no per-line dispute concept. The freight module owns the abstract; `sales` owns the
money documents it produces. When the financial program reaches its AR phase, the abstract's
invoice link migrates without changing the freight-facing lifecycle.

## Architecture

- Money as `numeric(18,4)` (precision 4 mirrors sales/the financial spec), never floats; VAT via
  `saudi_localization/lib/saudi/vat.ts` (`SAUDI_STANDARD_VAT_RATE`, `roundToHalalas`,
  `computeVatFromNet`, `formatSaudDecimal`).
- Optimistic locking ON for every user-editable entity (`updated_at` + `updatedAt` in responses +
  `CrudForm` auto-derived header + `enforceCommandOptimisticLock` in action commands).
- Action commands: pessimistic lock the aggregate inside `em.transactional`, guard transitions
  with `raiseFreightError(409, …)`, `emitCrudSideEffects` after commit. Money commands
  (`*.invoice`, `payments.record`, `payments.void`, `abstracts.resolve|finalize|
  record_offline_approval`) are **not undoable** — audit log entries instead.
- Module-local pure state machine (`lib/abstractState.ts`) for the abstract, NOT HR's approvals
  engine (its target list is closed and its semantics are an internal quorum, not a single
  external customer decision with per-line disputes).
- Numbers: `FreightDocumentSequence` per kind, locked in-transaction, unique index as backstop
  (sales `salesDocumentNumberGenerator` pattern).
- Trip lock: partial unique index on abstract lines
  `(organization_id, tenant_id, trip_id) WHERE is_billable AND deleted_at IS NULL` — a trip can be
  billable in at most one live abstract; a DB-level invariant, not just a code rule.

## Data Models

| Entity | Table | Purpose |
|---|---|---|
| `FreightOrder` | `freight_orders` | Spot truck order (cargo, pickup/drop-off, agreed price, assignment, execution, POD, sales links) |
| `FreightContract` | `freight_contracts` | Priced agreement (validity, billing cycle, payment terms, `requires_customer_approval`) |
| `FreightContractRoute` | `freight_contract_routes` | Rate lines: lane + basis + rate + minimum charge + waiting rules + effective dates |
| `FreightTrip` | `freight_trips` | Executed trip as billing unit; price snapshot; `billing_status` lock flags |
| `FreightTripCharge` | `freight_trip_charges` | Trip extras (waiting/toll/border/loading/…) |
| `FreightTripAbstract` | `freight_trip_abstracts` | كشف الرحلات: period, status, approval mode stamps, totals, sales links, paid/outstanding |
| `FreightTripAbstractLine` | `freight_trip_abstract_lines` | Per-trip line snapshot + dispute/resolution fields |
| `FreightPayment` | `freight_payments` | Bank-transfer payments against the abstract/invoice |
| `FreightDocumentSequence` | `freight_document_sequences` | Per-kind numbering counters |

Full field lists: Phase 1/2/3 specs.

## API Contracts

Staff routes under `/api/freight_operations/...` (CRUD via `makeCrudRoute`; action routes via the
mutation-guard + command-bus pattern):

- Orders: CRUD + `confirm|assign|dispatch|deliver|complete|cancel|invoice`
- Contracts: CRUD + `activate|suspend|resume|terminate`; contract routes (rate lines) CRUD
- Trips: CRUD + `dispatch|start|deliver|exclude|cancel|set-charges`; charges read
- Abstracts: CRUD + `generate|submit|resubmit|resolve|finalize|record-offline-approval|invoice|cancel`
- Payments: list/record/void (+ `resync`)
- `dashboard-summary`, `settings`, `reference/transport`

Portal routes under `/api/freight_operations/portal/...` (customer auth): contracts, abstracts
(+ respond/approve), invoices.

## Integration Coverage

Per phase, in the phase specs. All API paths listed above are covered by Playwright
`TC-FREIGHT-*` specs shipped with the same change, plus unit tests for pricing/halala math,
numbering, availability, and the abstract state machine.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Invoice requires an order (core constraint) | High | Always create the order→invoice pair; asserted by tests | Sales UI shows an order+invoice pair per freight invoice (intended; `externalReference` explains it) |
| Core does not recompute invoice totals on payment | High | Explicit sync + `invoice_synced_at` + Resync action | Crash between writes leaves a visible flag, never a silent mismatch |
| Abstract vs trip concurrency | High | Pessimistic locks + `billing_status` guard + partial unique index | — |
| `transport_operations` absent | Medium | Snapshots + tolerant reads; free-text fallback | Manual entry of fleet data |
| Channel scoping (sales MUST rule) | Medium | `settings.salesChannelId` passed when configured; documented on the settings screen | Orders created without a channel until configured |
| Invoice-level ZATCA QR unavailable | Medium | Order-level QR available via existing preview (Phase 4 proxy) | Not ZATCA-clearance-ready; stated out of scope |

## Final Compliance Report

- Tenant/org scoping on every table and read; no cross-tenant exposure.
- No cross-module ORM relations; coupling via id+snapshot / command bus / tolerant reads.
- Optimistic locking on all user-editable entities.
- All user-facing strings via i18n (6 locales; Arabic authored first-class).
- RTL-safe logical utilities only; money formatted with Western digits (ZATCA requirement).
- Integration tests ship with each phase.

## Roadmap (explicitly out of scope here)

Passenger/school transport program: students + guardians, B2C parent subscriptions, B2B school
contracts, route templates with stops and morning/evening legs, seat capacity and boarding
manifests, parent portal, per-student monthly billing reusing the abstract/approval machinery.
Also deferred: ZATCA signing/clearance, credit memos as the correction path, payment gateways,
freight-trip mirroring onto the fleet board.

## Changelog

- 2026-10-10: Initial program spec (phases 0-4 scoped; Phase 1/2/3 buildable, Phase 4 follow-up).
- 2026-10-10 (later): staff screens shipped for contracts (+ rate lines), trips (+ charges), abstracts
  (+ per-line disputes) and payments, with URL-driven list filters, `navHidden` create pages and a
  `notes`/POD projection addition. Rate lines gained `vehicle_type_id`, `equipment_type` and the
  driver-incentive pair, plus a spreadsheet importer (`ImportContractRatesDialog` +
  `api/contract-routes/import`) that validates a dry run before committing. Integration coverage:
  `TC-FREIGHT-008` (import + projections) and `TC-FREIGHT-009` (staff list filters).
