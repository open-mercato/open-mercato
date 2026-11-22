# Driver workspace PWA (Phase 3)

**Status:** Implemented (2026-11-22) — core workflow; checklist and automated notifications remain
**Module:** `freight_operations` + `transport_operations`
**Related:** [`2026-11-21-leandispatcher-feature-parity.md`](../plans/2026-11-21-leandispatcher-feature-parity.md)

## TLDR

Ship a mobile-first driver workspace as a PWA rather than a native app: a staff user linked to a
`transport_drivers` record signs in normally and opens `/backend/driver` to see their assigned
freight orders and trips, start and deliver work with a POD reference, record rest breaks, and
raise SOS.

This is the first working driver surface. It deliberately uses the existing staff auth/session
instead of introducing a second driver identity system.

## Problem Statement

LeanDispatcher's driver app is the largest experience gap: drivers currently have no screen at
all. Staff must call the driver, the driver cannot update execution status, and there is no
record of rest breaks or an emergency alert.

## Proposed Solution

### Identity

- `transport_drivers.user_id` (nullable, unique per organization/tenant) links a driver record to
  a staff user.
- The driver form gains a **Driver login user** relation picker over `/api/auth/users`.
- A driver with no linked user still exists as master data; they just cannot sign in.
- Access is gated by a new `freight.driver_app` feature. It does not depend on `freight.read`, so
  a driver role can be granted the workspace without the rest of the freight module.

### Work list

`GET /api/freight_operations/driver/work` resolves the driver by the authenticated user id,
scoped by tenant and organization, and returns:

- orders assigned to the driver with status `assigned`, `in_transit` or `delivered`;
- freight trips assigned to the driver with execution status `planned`, `dispatched`,
  `in_transit` or `delivered`;
- the currently open rest break, if any.

### Actions

`POST /api/freight_operations/driver/actions` accepts a discriminated union:

| Action | Command | Guard |
|---|---|---|
| `order_dispatch` | `freight_operations.orders.dispatch` | order.driverId = current driver |
| `order_deliver` | `freight_operations.orders.deliver` | order.driverId = current driver |
| `trip_start` | `freight_operations.trips.start` | trip.driverId = current driver |
| `trip_deliver` | `freight_operations.trips.deliver` | trip.driverId = current driver |
| `rest_start` / `rest_end` | new `freight_operations.driver.*` commands | driver record |
| `sos` | `freight_operations.driver.sos` | driver record |

Existing order/trip commands keep their optimistic locking and status guards. The driver PWA
sends the record's `updatedAt` as the expected-version header.

### Rest breaks and SOS

- `freight_driver_rest_breaks` records `driver_id`, optional `trip_id`, `started_at`,
  `ended_at`; an open break blocks a second `rest_start`.
- `freight_driver_alerts` records an SOS with optional trip/order, latitude/longitude and note.
- Events: `freight_operations.driver.rest_started|rest_ended|sos`.
- The PWA asks the browser for a location when SOS is opened and includes it when available;
  the alert is sent even if geolocation is denied or times out.

### PWA shell

- `/backend/driver` is a mobile-first page (`max-w-lg`), large touch targets, a fixed SOS bar.
- A client bootstrap injects `/driver.webmanifest` and registers `/driver-sw.js`; the service
  worker is install/activate-only (no offline caching yet), which is enough for an installable
  shell.
- The page is guarded by `requireAuth` + `freight.driver_app`.

## Architecture

- No new auth realm: the staff session is reused. The driver identity is resolved by raw SQL from
  `transport_drivers.user_id`, tolerant of the transport module being absent.
- The work list reads freight orders/trips through the encrypted-read helper with explicit
  tenant/organization scope.
- Driver actions execute the existing command handlers through the command bus; no second state
  machine is introduced.
- New freight entities are append-only/short-lived operational records.

## Data Models

| Entity | Table | Purpose |
|---|---|---|
| `TransportDriver` | `transport_drivers` | Add `user_id` + partial unique index |
| `FreightDriverRestBreak` | `freight_driver_rest_breaks` | Rest break with open/closed timestamps |
| `FreightDriverAlert` | `freight_driver_alerts` | SOS alert with optional location |

## API Contracts

- `GET /api/freight_operations/driver/work` — assigned orders/trips + open break.
- `POST /api/freight_operations/driver/actions` — driver action union.
- Both require the staff session and `freight.driver_app`.
- Existing staff order/trip endpoints remain unchanged.

## UI

- `/backend/driver` — driver workspace with order/trip cards, start/deliver, rest break, SOS.
- Delivery dialog collects POD reference and receiver name; Cmd/Ctrl+Enter submits, Escape
  cancels.
- SOS dialog collects a note and optional geolocation.
- Driver form (`/backend/transport/drivers`) gains the login-user picker.

## Integration Coverage

- `TC-FREIGHT-013-driver-pwa`: staff user linked to a driver; assigned order visible; dispatch,
  deliver, rest start/end and SOS all succeed through the driver API.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A driver user sees another driver’s work | High | Every action resolves the driver from the session and checks `driverId`; the work query filters by the resolved driver | None known |
| A staff user with the feature but no driver link | Medium | API answers 403 with a clear message; the page shows it | Admin must link the record |
| Geolocation is denied or slow | Low | 5s timeout; SOS still sends without coordinates | Dispatcher sees no location for that alert |
| Rest breaks are not tied to a trip | Low | `trip_id` is optional; the PWA picks the active trip when available | A break can be recorded between trips |
| No checklist templates yet | Medium | The work list and delivery flow are usable without them; checklist is a follow-up | LeanDispatcher checklist parity is incomplete |
| PWA installability without offline caching | Low | Manifest + activate-only SW; not an offline app | Drivers need connectivity |

## Final Compliance Report

- Tenant/organization scope on every query and action; driver ownership checked per record.
- No cross-module ORM relations; transport identity is a tolerant read.
- Optimistic locking preserved through the existing commands.
- All strings through six-locale i18n; Arabic authored.
- Additive migrations; existing staff APIs unchanged.
- Integration coverage ships with the change.

## Changelog

- **2026-11-22** — Initial implementation: driver user link, PWA workspace, order/trip
  start/deliver, rest breaks, SOS, manifest/service worker, integration test. Checklist
  templates and push/notification wiring remain.
- **2026-11-22 (validation)** — `TC-FREIGHT-013` passes against the local dev server;
  `yarn typecheck`, `yarn lint`, `yarn i18n:check-sync` and `yarn build:app` are green.
