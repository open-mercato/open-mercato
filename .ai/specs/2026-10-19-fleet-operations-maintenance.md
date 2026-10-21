# Fleet operations: maintenance, fuel, insurance, violations

**Status:** Implemented for the `transport_vehicles` register; master-data consolidation (M4.1) remains gated
**Created:** 2026-10-19
**Module:** `apps/mercato/src/modules/fleet_operations` + financial subscribers + transport/rental/student changes

## TLDR

Fleet depth now exists as its own app-local module rather than a second vehicle register. `fleet_operations` owns preventive schedules, work orders with parts/labor, fuel logs, insurance policies and traffic violations, all keyed by `transport_vehicles.id` (id only, no ORM relation). Completed work orders and recorded insurance premiums post to the general ledger. The module also closes the operational loops: a transport dashboard, trip cancellation, a freight customer-portal abstract response, rental/student invoicing through the sales bridge, and fleet custody approval through the HR engine.

## Decisions

1. **One new module, not a slice of `fleet_management`.** `fleet_operations` references the transport register so it can ship before M4.1's destructive migration; `fleet_management` keeps custody, documents and odometer logs on its legacy table for now. M4.1 remains gated on G7.
2. **Vehicle references are UUIDs.** Every table stores `vehicle_id`; no ORM relation crosses modules. The UI picks from `/api/fleet_management/vehicles` until M4.1 points pickers at the transport register.
3. **Work-order totals are computed at close, not continuously.** Parts and labor lines carry their own totals; the close action recomputes the aggregate from both tables, sets `completed_at`, rolls the linked schedule, and emits `fleet_operations.work_order.completed`. Editing the header cannot set `completed`.
4. **Cost posting is a financial subscriber.** `financial:fleet-work-order-posting` debits `5600` (Vehicle maintenance and repairs) and credits payables for the closed total; `financial:fleet-insurance-posting` debits `5700` (Vehicle insurance) and credits payables for a recorded premium. Both are idempotent through the posting source index. The Saudi CoA gained `5600` and `5700`.
5. **Fuel is a ledger of purchases, not a GL posting.** Fuel cost enters the operational dashboard; posting fuel to inventory/expense needs an accrual policy the pilot has not set.
6. **Violations stay operational.** Driver assignment and a `payrollDeductionRequested` flag are stored; creating the actual HR penalty remains a human step so a violation cannot silently reduce pay.
7. **Approval for custody is generic.** `hr_management.approvals.submit_for_entity` selects the first active workflow for `fleet_vehicle_assignment`. If none exists (or HR is disabled), handover activates immediately, preserving the old behaviour. On a final decision HR emits `hr_management.approval_request.decided`; the fleet subscriber activates or rejects the assignment and writes the handover odometer log. HR never writes fleet tables.
8. **Rental and student invoicing are one-time/period-aware.** A rental stores its sales order/invoice ids and returns them on retry. A student subscription stores the last invoiced period and rejects overlaps; repeating the same period is idempotent.
9. **Freight portal origin is server-pinned.** `POST /api/portal/freight/abstracts/respond` authenticates the customer session, verifies the abstract's `customer_id` belongs to that customer, and passes `origin: 'customer_portal'` — the request body cannot claim it.

## Surfaces

- Entities: `fleet_maintenance_schedules`, `fleet_work_orders`, `fleet_work_order_parts`, `fleet_work_order_labor`, `fleet_fuel_logs`, `fleet_insurance_policies`, `fleet_traffic_violations`.
- APIs: CRUD under `/api/fleet_operations/{maintenance-schedules,work-orders,work-order-parts,work-order-labor,fuel-logs,insurance-policies,traffic-violations}`; `POST /api/fleet_operations/work-orders/complete`; `GET /api/fleet_operations/dashboard-summary`.
- UI: `/backend/fleet/operations` (tabs, summary), dynamic create/edit routes per entity, `/backend/transport/dashboard`, freight portal abstract list/detail.
- Events: `fleet_operations.work_order.completed`, `fleet_operations.insurance_policy.recorded`, `hr_management.approval_request.decided`.
- Transport: `cancellation_reason` column, `POST /api/transport_operations/trips/cancel`, row action.
- Invoicing: `POST /api/vehicle_rentals/contracts/invoice`, `POST /api/student_transport/subscriptions/invoice`; `sales_order_id`/`sales_invoice_id` (plus last invoiced period for student).

## Tests

- `fleet_operations/lib/__tests__/operationsService.test.ts` — totals, schedule roll, fuel efficiency, expiry window, dashboard summary.
- `fleet_operations/__integration__/TC-FLEET-OPS-001.spec.ts` — work order + parts/labor → complete → schedule roll → GL `5600`/`2000`; insurance → GL `5700`.
- `transport_operations/__integration__/TC-TRANSPORT-002-trip-cancel.spec.ts` — scheduled and in-progress cancellation, driver release, repeat rejection.
- `customers/lib/__tests__/phoneCallInteractions.test.ts`, `hr_management/lib/__tests__/approvalTargets.test.ts` updated for the new target.

## Out of scope

- Master-data consolidation (`fleet_management.fleet_vehicles` → `transport_vehicles`) — blocked on G7; the decision record holds the migration plan.
- Telematics ingestion — no provider selected.
- Fuel accrual/GL posting and inventory integration.
- Automatic HR penalty creation from violations.
- Certified bank/WPS or provider-specific payment formats.
- Prorating student subscriptions for partial periods.
