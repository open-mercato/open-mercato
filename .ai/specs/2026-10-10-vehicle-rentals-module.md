# Vehicle rentals module (buildable)

## TLDR

Add a `vehicle_rentals` app-local module: contracts that hire a bus or truck out with or without a
driver, handover/return checks that record the odometer at both ends, and mileage-based billing where
the kilometres past the contract's allowance are charged at the contract's extra-km rate.

## Overview

Rental types `with_driver` / `without_driver`; client types `b2b` / `b2c`; billing periods `daily` /
`weekly` / `monthly`. A rental is billed in whole periods, and the included mileage scales with the
*billed* periods. Two check documents — a handover and a return — carry the odometer readings and the
condition notes; the return computes the usage, the extra kilometres and the final amounts.

## Problem Statement

The platform schedules trips (`transport_operations`) and bills sold transport (`freight_operations`),
but nothing hires a vehicle out by the day. The rental office tracks this on paper: which bus went out,
with which driver, what the odometer read at both ends, and what the extra kilometres cost.

## Proposed Solution

### Entities

- `RentalContract` (`rental_contracts`) — `rental_number` (partial unique per org+tenant),
  `status` (`draft|active|completed|cancelled`), `rental_type`, `client_type`, `duration_type`,
  customer id + snapshot, vehicle id + snapshot, driver id + snapshot, planned and actual windows,
  the three rates, `included_km`, `extra_km_rate`, `odo_start_km`/`odo_end_km`/`usage_km`/`extra_km`,
  the amount columns (`rental_amount_net`, `extra_km_amount_net`, `total_net_amount`, `tax_rate`,
  `tax_amount`, `total_gross_amount`), currency, handover/return stamps, notes, standard
  scope/timestamps/soft-delete.
- `RentalVehicleCheck` (`rental_vehicle_checks`) — `kind` (`handover|return|inspection`), odometer,
  fuel level, damage flag, condition notes, checked-at/by. One live check of each kind per rental
  (partial unique index); `handover`/`return` are written by their commands, `inspection` covers
  anything recorded in between.
- `RentalDocumentSequence` (`rental_document_sequences`) — the per-scope number counter, upserted
  under a row lock like freight's sequence.

### Commands

`vehicle_rentals.contracts.{create,update,delete}` plus `handover`, `return`, `cancel`, and
`vehicle_rentals.checks.record`.

- `create` allocates the rental number and computes the amounts from the window and rates; status
  `draft`.
- `handover`: draft → active. Requires a rentable vehicle (tolerant fleet read), a driver for a
  `with_driver` rental, and no rental or fleet-board overlap for the window; writes the handover check.
- `return`: active → completed. Requires the closing odometer ≥ the handover reading; recomputes the
  amounts with the actual window and the actual mileage; writes the return check.
- `cancel`: draft or active → cancelled.

### Money

`numeric(18,4)` throughout, VAT through the Saudi primitives (`roundToHalalas`,
`computeVatFromNet`) so a rental document and its eventual invoice agree to the halala.

### API

`GET/POST/PUT/DELETE /api/vehicle_rentals/contracts` (filters `status`, `rentalType`, `clientType`,
`durationType`, `customerId`, `vehicleId`, `search`, `ids`), action routes
`contracts/{handover,return,cancel}`, `GET/POST /api/vehicle_rentals/checks`,
`GET /api/vehicle_rentals/reference/transport`, `GET /api/vehicle_rentals/dashboard-summary`.

### UI

`/backend/rentals` (KPIs), `/backend/rentals/contracts` (list, create, detail, edit) with the
handover and return dialogs and the checks timeline on the detail. Features: `rentals.read`,
`rentals.manage`, `rentals.handover`, `rentals.checks.manage`, `rentals.admin`.

### Integration coverage (ships with this module)

`TC-RENTAL-001-handover-return-and-extra-km` — a return before the handover is refused; handover
opens the rental and writes its check; a closing odometer below the opening one is refused; the
return closes the rental and bills the mileage past the allowance; a second rental on the same vehicle
for an overlapping window is refused. Unit tests pin the period and amount arithmetic.

## Architecture

Coupling: the fleet data is read tolerantly by table name (`42P01` → absent), snapshots travel on the
rental, and no `requires` is declared on `transport_operations` — the same three axes the freight
program uses. No cross-module ORM relations.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Fleet module absent | Medium | Tolerant reads degrade to manual vehicle/driver entry; snapshots keep the record readable | Pickers empty until fleet master data exists |
| Overlapping rentals | High | Contract-vs-contract overlap query inside the handover transaction + the fleet board check | A rental created after the check but before commit is serialized by the row lock |
| Period rounding disputes | Medium | Periods are whole and documented (`ceil` per day/week/month); the included mileage scales with them | A mid-period extension bills a further whole period by design |

## Final Compliance Report

- Tenant/org scoping on every table and read; no cross-tenant exposure.
- Optimistic locking on the contract (commands enforce the version header).
- All user-facing strings via i18n (6 locales; Arabic authored first-class).
- Integration test ships with the module; unit tests pin the arithmetic.

## Changelog

- 2026-10-10: Initial spec (module implemented in the same change).
