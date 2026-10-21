# Fleet master-data ownership

**Status:** implemented (2026-10-20) — `transport_operations` is the single register; `fleet_vehicles` dropped
**Created:** 2026-10-19
**Applies to:** `fleet_management`, `transport_operations`, `hr_management`, and the modules that read fleet data (`freight_operations`, `vehicle_rentals`, `student_transport`)

## Problem

The repository currently has three registers for the same real-world things:

| Concept | Registers |
|---|---|
| Vehicle | `fleet_management.fleet_vehicles`, `transport_operations.transport_vehicles` |
| Driver | `hr_management.hr_driver_profiles` (employment/document record), `transport_operations.transport_drivers` (dispatch record) |
| Driver-to-vehicle work | `fleet_vehicles` custody assignments, `transport_trip_schedules` |

`freight_operations`, `vehicle_rentals` and `student_transport` already read `transport_vehicles` / `transport_drivers` by raw SQL with a tolerated missing table and store id + snapshot. `fleet_management` is the outlier: it owns a second vehicle table and its custody, documents and odometer rows reference that table.

Two registers guarantee drift: the same plate can be edited in one and not the other, a vehicle can be assigned in `fleet_management` while scheduled in `transport_operations`, and an expiry alert can fire for one copy only. Every new capability (maintenance, fuel, insurance, violations, telematics) would have to choose a register or write to both.

## Decision

**`transport_operations` is the single operational register for vehicles and drivers.**

- `transport_vehicles` and `transport_drivers` are the source of truth for identity, availability and dispatch.
- `fleet_management` keeps what is genuinely its own: custody assignments, vehicle documents, odometer logs. Those rows reference `transport_vehicles.id` (id + snapshot), never a second vehicle table.
- `hr_management.hr_driver_profiles` remains the employment, licence and medical-certificate record. It is linked to the operational driver by `employee_id`. The two are not merged: HR answers "who is employed and compliant", transport answers "who is assigned today".
- No cross-module ORM relations. References are ids plus snapshots, reads are scoped and tolerant of a missing peer table, matching the pattern already used by the freight/rental/student modules.

## Migration plan (executed as M4.1, one PR)

1. Add nullable `transport_vehicle_id` to `fleet_vehicles` and backfill it by normalised plate + VIN within the same tenant/organization. Unmatched rows are reported, not guessed.
2. Add the same reference to `fleet_vehicle_documents`, `fleet_vehicle_assignments` and `fleet_vehicle_odometer_logs`, backfilled from their vehicle row's new reference.
3. Switch every `fleet_management` read/write to resolve the transport vehicle by id; keep the legacy `fleet_vehicle_id` column nullable during the transition.
4. Freeze `fleet_vehicles` writes (new vehicles are created in `transport_operations`; the fleet screen becomes a view over the transport register).
5. After a verified backfill and one release of dual-read, drop `fleet_vehicles` and the legacy columns in a separate migration.
6. Update the freight/rental/student reference pickers to the same register (they already read `transport_*`; verify no screen still lists `fleet_vehicles`).

## Acceptance

- One vehicle list drives fleet custody, transport dispatch, freight orders, rentals and school transport.
- Creating a vehicle in either screen produces exactly one row in `transport_vehicles`.
- A plate/VIN uniqueness violation is refused at the database, not only in a form.
- Assignment/schedule overlap checks read the same register.
- The migration reports unmatched legacy rows instead of silently dropping them.

## Rollback

The legacy tables and columns are retained until step 5. Before the drop, reverting means switching the reads back to `fleet_vehicles`; after the drop, restore from the pre-migration backup. Step 5 is the only irreversible operation and ships as its own release with a verified backup.

## Execution record (2026-10-20)

The owner approved the full consolidation, including the drop. Implementation details:

- `transport_vehicles` gained `sequence_number`, `color`, `vehicle_type`, `current_odometer` and `notes`; `vin` became nullable and `capacity` defaults to `0` because the fleet register never captured either. A partial unique index now enforces `sequence_number`.
- The migration copies every `fleet_vehicles` row into `transport_vehicles`. An unmatched row keeps its **own id**, so every child `vehicle_id` stays valid without an update; a row whose plate matches an existing active transport vehicle is merged into that vehicle's id and the three child tables are repointed. `assigned` maps to the transport `active` status; custody is derived from open assignment rows.
- `fleet_management` no longer has a `FleetVehicle` entity or table. Its vehicles API reads `transport_vehicles` through scoped raw SQL and writes through the `transport_operations.vehicles.*` commands, so validation, events, indexing and optimistic locking stay in the owning module. The fleet vehicle form and list keep their endpoint and response shape.
- The handover, return and approval-subscriber paths update the register's odometer by scoped SQL and write the fleet odometer log; they no longer mutate a vehicle entity.
- The pre-migration backup is `.mercato/backups/m4.1-fleet-before.sql` (all five affected tables, PostgreSQL `COPY` data). The migration's `down()` recreates the legacy table from the register as a best-effort local rollback; the backup is the reliable rollback.
- Verified locally after `yarn db:migrate`: `fleet_vehicles` absent, 10 transport rows, 6 assignments and 8 odometer logs with zero orphaned vehicle references, and all three transport vehicle unique indexes declared `CREATE UNIQUE INDEX` in `pg_indexes`.

## Changelog

- 2026-10-20 — executed M4.1: data copied/merged, child references repointed, `fleet_vehicles` dropped, fleet read/write paths moved to `transport_operations`.
