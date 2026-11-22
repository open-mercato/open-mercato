# Transport live tracking and routing estimates (Phase 4)

**Status:** Implemented (2026-11-22) — positions, live board, routing adapter; geofencing remains
**Module:** `transport_operations`
**Related:** [`2026-11-21-leandispatcher-feature-parity.md`](../plans/2026-11-21-leandispatcher-feature-parity.md)

## TLDR

Add the data and UI foundation for LeanDispatcher's "Eagle Eye" board:

- a provider-agnostic telematics ingestion endpoint that stores vehicle positions;
- a live tracking page with a Leaflet/OpenStreetMap map, latest position per vehicle, active
  freight trip, last-seen time and late-trip flag;
- a routing estimate endpoint with a local Haversine fallback and an optional OSRM provider.

No telematics vendor, map key or routing key is required to run the slice. A provider only needs
to POST normalized positions.

## Problem Statement

The transport register knows which vehicles and trips exist but not where they are. The fleet
dashboard is counters only. Without a position store and a board, a dispatcher cannot answer
"where is this truck now, and which trip is it on?"

## Proposed Solution

### Positions

- `transport_vehicle_positions` is append-only telemetry: vehicle, optional driver/trip,
  latitude, longitude, speed, heading, recorded time, source and raw payload.
- `POST /api/transport_operations/tracking/positions` accepts one position or a batch of up to
  500, behind `transport.telematics.ingest`. Every vehicle id is verified in the caller's
  tenant/organization before any row is written.
- The endpoint is the provider seam: a telematics adapter normalizes its payload into this shape
  and posts it with an API key holding the ingest feature. No provider-specific code lives in the
  transport module.
- `DELETE /api/transport_operations/tracking/positions?id=` is an administrative correction
  behind `transport.admin`.

### Live board

`GET /api/transport_operations/tracking` returns every vehicle with its latest position (lateral
join), driver name and active freight trip. An active trip whose source order's requested
delivery time has passed is flagged `late`.

`/backend/transport/tracking` renders:

- a Leaflet map over OpenStreetMap with one marker per positioned vehicle and a popup carrying
  plate, driver, trip and speed;
- counters for vehicles, positioned vehicles and active trips;
- a DataTable with the same data and the late flag.

The page refreshes every 15 seconds.

### Routing estimate

`POST /api/transport_operations/tracking/estimate` takes origin/destination coordinates and
returns distance/duration/provider.

- Local provider: great-circle distance × a road factor, at a configurable average speed. Always
  available, labelled `local`.
- OSRM-compatible provider: enabled by `OM_ROUTING_OSRM_URL`; any timeout/error falls back to the
  local estimate instead of failing the request.
- The provider interface is the seam for Google Routes or another provider later; no key ships in
  the repo.

## Architecture

- Positions are stored by a command (`transport_operations.positions.record`) so the write has a
  single audited path and emits `transport_operations.vehicle.position_recorded`.
- The tracking read is a scoped lateral join; the freight trip join is a tolerant raw-SQL read so
  the board still works when `freight_operations` is disabled.
- The map component is dynamically imported with `ssr: false`; Leaflet is browser-only.
- No new external dependency beyond the Leaflet copy already installed in the workspace.

## Data Models

| Entity | Table | Purpose |
|---|---|---|
| `TransportVehiclePosition` | `transport_vehicle_positions` | Append-only telemetry sample |

## API Contracts

| Method | Path | Feature |
|---|---|---|
| POST | `/api/transport_operations/tracking/positions` | `transport.telematics.ingest` |
| DELETE | `/api/transport_operations/tracking/positions?id=` | `transport.admin` |
| GET | `/api/transport_operations/tracking` | `transport.tracking.view` |
| POST | `/api/transport_operations/tracking/estimate` | `transport.read` |

## UI

- `/backend/transport/tracking` — map, counters, table, late badge.
- OpenStreetMap tiles are fetched by the browser; a deployment can swap the tile URL/provider.
- Empty state explains that no positions have been received.

## Integration Coverage

- Unit: `lib/__tests__/routing.test.ts` — Haversine, local estimate, OSRM parse, OSRM failure
  fallback.
- `TC-TRANSPORT-014-tracking`: record a position, read it on the board, estimate Riyadh–Dammam,
  then delete the position and vehicle.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A vehicle position is written for another tenant’s vehicle | High | Vehicle ids are checked against the scoped register inside the command | None known |
| Telemetry volume grows unbounded | Medium | Append-only table with a vehicle/time index; a retention worker is not shipped yet | Disk growth until retention is added |
| External map tiles expose vehicle positions to a third party | Medium | Only a map view loads tiles; no position is sent in the tile URL (only the viewport) | The map viewport/zoom is visible to the tile provider |
| OSRM unavailable | Low | Local Haversine fallback with a `local` provider label | Distance/ETA is approximate |
| Driver positions look live after the feed stops | Medium | `recorded_at` is shown; the UI does not claim live beyond the last sample | A stale marker stays until a newer sample arrives |
| Geofencing/alerts not implemented | Medium | The position store and late flag are the foundation; geofence entities are a follow-up | No automatic geofence breach notification |

## Final Compliance Report

- Tenant/organization scope on the command, reads and administrative delete.
- No cross-module ORM relation; the freight join is tolerant raw SQL.
- All user-facing strings through six-locale i18n; Arabic authored.
- Additive migration + snapshot; no existing API or schema contract changed.
- Integration test ships with the change.

## Changelog

- **2026-11-22** — Initial implementation: position entity/API, live Leaflet board, late flag,
  SOS alerts panel, local/OSRM routing estimate, unit and integration coverage. Geofences,
  retention and provider adapters remain.
- **2026-11-22 (validation)** — `TC-TRANSPORT-014` passes; the routing unit tests pass;
  `yarn typecheck`, `yarn lint`, `yarn i18n:check-sync` and `yarn build:app` are green.
