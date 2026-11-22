# Customer tracking link and driver ratings (Phase 5, core)

**Status:** Implemented (2026-11-22)
**Module:** `freight_operations`
**Related:** [`2026-11-21-leandispatcher-feature-parity.md`](../plans/2026-11-21-leandispatcher-feature-parity.md)

## TLDR

Give customers two post-booking surfaces without requiring a portal account:

1. a **public tracking link** (`/track/<token>`) that shows the non-sensitive status of one
   order and refreshes automatically;
2. **driver rating** on delivered portal orders, stored against the order and shown to staff
   through the API and to the customer in the portal list.

SMS/WhatsApp automation and public document downloads remain separate provider-gated work.

## Problem Statement

A customer with a tracking link currently has nowhere to go: the only status surface is staff
telephony. Delivered orders also have no feedback loop, so the fleet cannot measure driver
quality.

## Proposed Solution

### Tracking token

- `freight_orders.tracking_token` is a nullable, globally unique, URL-safe random token
  (`randomBytes(24).toString('base64url')`).
- Tokens are generated at staff and portal order creation. Existing orders get one on demand
  through `POST /api/freight_operations/orders/tracking-link`.
- The order detail exposes **Copy tracking link**, which copies
  `${origin}/track/${token}`.
- `GET /api/freight_operations/public/tracking?token=...` is unauthenticated, returns
  `Cache-Control: no-store`, and exposes only:
  order number, status, cargo description, lane, requested dates, delivery/completion times,
  driver name, vehicle plate, delivery-note number and updated time.
  It never returns the customer identity, prices, POD recipient or any other order details.
- `/track/[token]` is a standalone public page (no portal shell, no auth) with a status
  timeline and 30-second refresh.

### Driver rating

- `freight_driver_ratings` stores one rating per delivered order: driver, customer, 1–5 stars,
  optional comment, tenant/organization, timestamps.
- `POST /api/portal/freight/ratings` authenticates the customer, checks the order belongs to
  them and is delivered/completed/invoiced, and creates or updates the rating.
- The portal order list returns `driverRating` and renders stars, or a **Rate driver** dialog
  for delivered orders that have not been rated.
- `freight_operations.driver.rated` is emitted for future reporting.

## Architecture

- The public tracking route is a capability-token read: the token itself authorizes one order,
  and the response is deliberately reduced.
- The rating write goes through `freight_operations.driver.rate`, which re-checks ownership and
  status server-side; the portal route only adds authentication and the customer id.
- No cross-module ORM relations; the public route reads only freight tables.

## Data Models

| Entity / column | Table | Purpose |
|---|---|---|
| `FreightOrder.tracking_token` | `freight_orders` | Public tracking capability |
| `FreightDriverRating` | `freight_driver_ratings` | One rating per order |

## API Contracts

| Method | Path | Auth |
|---|---|---|
| POST | `/api/freight_operations/orders/tracking-link` | staff `freight.orders.manage` |
| GET | `/api/freight_operations/public/tracking?token=` | public, token |
| POST | `/api/portal/freight/ratings` | customer `portal.freight.rate` |
| GET | `/api/portal/freight/orders` | customer `portal.freight.view` (now includes `driverRating`) |

## UI

- Order detail: **Copy tracking link**.
- Public `/track/[token]`: status card, lane/cargo/dates, driver/vehicle, delivery note,
  progress timeline.
- Portal orders: rating stars or **Rate driver** dialog with the shared `Rating` primitive.

## Integration Coverage

- `TC-FREIGHT-016-public-tracking`: staff mints a token; the public endpoint returns the order
  status with no auth; an invalid token is 404.
- `TC-FREIGHT-017-driver-rating`: a portal customer submits an order, staff execute it, the
  customer rates the driver, and the portal list returns the rating.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Tracking token leaks order data | High | 192-bit random token, minimal response, no customer/pricing/POD identity | Anyone with the link can see the status until the link is rotated (rotation UI not shipped) |
| Token guessed or enumerated | Low | 24 random bytes base64url; unique index; no sequential ids | — |
| Customer rates a driver on someone else’s order | High | Command re-checks `order.customerId` against the authenticated customer id | — |
| Duplicate ratings per order | Medium | Partial unique index on `(organization_id, tenant_id, order_id)`; command updates the existing row | A customer cannot leave a second independent review |
| Public page indexed by search engines | Low | `navHidden` and no links from public pages; a `noindex` meta is a follow-up | Links could still be shared/indexed by third parties |

## Final Compliance Report

- Tenant/organization scope on staff and portal writes; the public route is scoped by the
  unguessable token and returns a minimal projection.
- All user-facing strings via six-locale i18n; Arabic authored.
- Additive migrations + snapshots; no existing contract changed.
- Integration tests ship with the change.

## Changelog

- **2026-11-22** — Tracking tokens + public status page + copy action; driver ratings with portal
  submission and list display; `TC-FREIGHT-016` and `TC-FREIGHT-017`.
- **2026-11-22 (validation)** — `TC-FREIGHT-015`, `TC-FREIGHT-016` and `TC-FREIGHT-017` pass;
  the new freight and transport unit suites pass; `yarn typecheck`, `yarn lint`,
  `yarn i18n:check-sync` and `yarn build:app` are green. Lint surfaced a conditional
  `useCallback` in `FreightOrderDetail` (tracking-link action), now moved above the
  loading/error early returns.
