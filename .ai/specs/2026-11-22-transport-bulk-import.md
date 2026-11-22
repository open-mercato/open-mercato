# Transport bulk driver and vehicle import (Phase 6)

**Status:** Implemented (2026-11-22)
**Module:** `transport_operations`
**Related:** [`2026-11-21-leandispatcher-feature-parity.md`](../plans/2026-11-21-leandispatcher-feature-parity.md)

## TLDR

Add a CSV/XLSX **dry-run → commit** importer for transport drivers and vehicles. The dialog
parses the sheet in the browser, the API re-validates every row with the entity's own create
schema, and only clean rows reach the existing create commands. Both list screens gain an
**Import** action next to **New**.

## Overview

Fleet onboarding was one record at a time: an operator creating a fifty-vehicle fleet had to
open the form fifty times. LeanDispatcher's parity matrix lists bulk driver/vehicle upload as
missing; the freight module already proved the pattern with its order and contract-rate
importers.

The slice is deliberately additive: no new tables, migrations, entities or ACL features. It
reuses `transport_operations.drivers.create` / `transport_operations.vehicles.create`, so an
imported row emits the same CRUD events, indexer entries, uniqueness checks and tenant scope as
a form submission.

## Problem Statement

- The driver and vehicle list screens only offer single-record creation.
- An existing fleet sheet cannot be loaded without hand-entering every row.
- A partially bad sheet must not write half a batch silently, and the operator must see exactly
  which rows were rejected and why.

## Proposed Solution

### Sheet parsing (client)

- The generic, dependency-free CSV/XLSX reader moved from `freight_operations` to
  `@open-mercato/shared/lib/browser/spreadsheet` so both modules share one parser (the freight
  dialogs now import it from there).
- `transport_operations/lib/importRows.ts` maps header aliases onto entity fields, normalizes
  numbers and dates, validates enum values and reports unknown/missing columns.
- `driverImport.ts` and `vehicleImport.ts` define the column sets and downloadable templates.

### Server validation and commit

`POST /api/transport_operations/{drivers|vehicles}/import` accepts:

```json
{
  "mode": "dry-run | commit",
  "rows": [{ "rowNumber": 2, "payload": { "…": "…" } }]
}
```

- Rows are limited to 500 per request.
- Every payload is validated with `createDriverSchema` / `createVehicleSchema`; the dry-run and
  the commit run the same validation, so the preview cannot promise a row the commit rejects.
- `commit` executes one command per valid row
  (`transport_operations.drivers.create` / `transport_operations.vehicles.create`). A failed
  row is reported as `failed` with its error and does not abort the remaining rows. A plate,
  VIN, national id or licence that races against a uniqueness index fails only that row.
- Both routes run `runRouteMutationGuards` and require `transport.write`.

### UI

- `ImportTransportRecordsDialog` is one parameterised dialog for both entities (sheet picker,
  template download, per-row preview, validate/commit buttons, `Cmd/Ctrl+Enter` / `Escape`).
- `ImportDriversDialog` / `ImportVehiclesDialog` supply the entity-specific columns and copy.
- The drivers and vehicles tables refresh their query after a successful commit.

## Architecture

| Layer | File |
|---|---|
| Shared spreadsheet reader | `packages/shared/src/lib/browser/spreadsheet.ts` |
| Row mapping/normalization | `transport_operations/lib/importRows.ts` |
| Driver columns + template | `transport_operations/lib/driverImport.ts` |
| Vehicle columns + template | `transport_operations/lib/vehicleImport.ts` |
| Auth/scope resolver | `transport_operations/lib/routeContext.ts` |
| Dry-run/commit runner | `transport_operations/lib/importRoute.ts` |
| Routes | `transport_operations/api/{drivers,vehicles}/import/route.ts` |
| UI | `transport_operations/components/Import{TransportRecords,Drivers,Vehicles}Dialog.tsx` |

## Data Models

No schema changes. The importer writes the existing `transport_drivers` and `transport_vehicles`
rows through their commands, including the existing partial unique indexes.

## API Contracts

Both endpoints are additive and versionless, like the existing transport CRUD routes.

| Method | Path | Feature |
|---|---|---|
| POST | `/api/transport_operations/drivers/import` | `transport.write` |
| POST | `/api/transport_operations/vehicles/import` | `transport.write` |

Response:

```json
{
  "ok": true,
  "mode": "dry-run | commit",
  "summary": { "total": 3, "valid": 2, "invalid": 1, "created": 2, "failed": 0 },
  "rows": [
    { "rowNumber": 2, "status": "valid | invalid | created | failed", "errors": [] }
  ]
}
```

Driver columns: `fullName`, `nationalId`, `licenseNumber`, `licenseExpiry`, `phone` (required),
`status` (optional enum). Employee/user links are not imported; they are UUIDs and remain
editable on the form.

Vehicle columns: `plateNumber`, `make`, `model`, `year` (required); `vin`, `sequenceNumber`,
`capacity`, `color`, `vehicleType`, `currentOdometer`, `status`, `telematicsDeviceId`, `notes`
(optional).

Dates accept ISO (`2027-06-30`) and day-first (`30/06/2027`) spellings and are normalized to
ISO date strings before command execution.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Partially bad sheet writes a confusing subset | Medium | Dry-run is mandatory in the dialog; commit reports per-row status; failed rows do not abort the batch | A caller can POST `commit` directly; the report names every failure |
| Duplicate plate/VIN/national id/licence | Medium | Existing commands pre-check and the partial unique indexes are the backstop; per-row failure message names the field | Two simultaneous commits can race; the index still rejects one |
| Malformed `.xlsx`/CSV | Low | Client parser throws a readable error before any request | An operator can still send arbitrary JSON by API; zod and commands reject it |
| Cross-tenant write | High | Auth/scope resolver mirrors the CRUD routes and telematics ingestion; commands scope by tenant/organization | None known |
| Freight importer regression from the parser move | Medium | Implementation is byte-for-byte equivalent; its unit tests moved with it and still run | Freight dialog imports now resolve through the shared package |
| Large batch blocks the request | Low | Hard cap of 500 rows per request | Import of thousands of rows needs several files; acceptable for the fleet onboarding use case |

Backward compatibility: additive routes and UI. The shared spreadsheet reader is a new utility;
the freight module's imports were updated internally, with no contract or behavior change.

## Validation

Executed 2026-11-22:

- `yarn generate` — all generators completed; 768 API paths emitted.
- `yarn typecheck` — green.
- `yarn lint` — 0 errors (19 pre-existing warnings in unrelated files).
- `yarn i18n:check-sync` — all module dictionaries in sync (en, pl, es, de, ko).
- Unit: `driverImport` + `vehicleImport` (8 tests) and the relocated shared `spreadsheet` suite (7 tests) pass; the touched freight parser suites still pass (14 tests total in the app run).
- `yarn workspace @open-mercato/shared build` — 294 entry points, built successfully.
- `TC-TRANSPORT-015-bulk-import` ships with the change; it was not executed in this session because it needs the live app and Playwright harness.

Coverage: dry-run vs commit, invalid-row skipping, and list visibility for both entities.

## Final Compliance Report

- No direct ORM relationship between modules; transport uses its own entities and commands.
- No new user-facing strings outside the six module dictionaries.
- No hard-coded status colours or arbitrary Tailwind values in the new dialogs.
- Tenant and organization scope resolved on the server; the client cannot choose them.
- `transport_drivers`/`transport_vehicles` continue to use optimistic-locking-friendly
  `updatedAt` in their list/detail surfaces; the importer creates new records only.

## Changelog

- **2026-11-22** — Initial implementation: shared spreadsheet reader, generic row mapper,
  driver/vehicle import routes with dry-run/commit, import dialogs on both list screens,
  six-locale i18n, unit tests and TC-TRANSPORT-015.
