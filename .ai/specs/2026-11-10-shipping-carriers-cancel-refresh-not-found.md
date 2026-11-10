# Shipping carriers: 404 for unknown shipments on cancel and tracking refresh

**Status**: Implemented in PR #9232
**Issue**: [#9231](https://github.com/open-mercato/open-mercato/issues/9231)
**Module**: `shipping_carriers` (`packages/core/src/modules/shipping_carriers`)
**Related**: [SPEC-062 — Sales native shipping carrier refactor](./SPEC-062-2026-03-18-sales-native-shipping-carrier-refactor.md)

## TLDR

`POST /api/shipping-carriers/cancel` and `POST /api/shipping-carriers/tracking/refresh` answer `404` with a localized
"Shipment not found" body when the `shipmentId` does not exist or is outside the caller's tenant and organization.
They used to answer `502` "Carrier provider request failed. Try again later." and log a provider upstream error,
although no carrier was called.

## Problem

Both service methods resolve the shipment through `findShipmentOrThrow` in `lib/shipping-service.ts`, which filters by
id, organization and tenant and throws `CarrierShipmentNotFoundError` when no row matches. The two route handlers sent
every non-validation error to `shippingCarrierUpstreamErrorResponse`, which always returns `502`. A lookup miss was
therefore reported as a carrier outage:

- clients and gateways that retry on `5xx` kept retrying a request that can never succeed;
- upstream-error logs and alerts fired with no carrier involved;
- the behavior differed from `GET /api/shipping-carriers/tracking`, which already answers `404` for the same case.

## Proposed Solution

In both handlers, check `error instanceof CarrierShipmentNotFoundError` before the upstream fallback and answer:

```json
HTTP 404
{ "error": "Shipment not found" }
```

The message comes from the new i18n key `shipping_carriers.errors.shipmentNotFound`, added to all five module locales
(`en`, `de`, `es`, `ko`, `pl`) and resolved with `resolveTranslations()` for the request locale. The English text
matches the body of `GET /api/shipping-carriers/tracking`.

The lookup runs before any adapter call, database write or event, so the `404` path has no side effects. On cancel it
also skips the after-success mutation-guard hook, as every other failed cancel does.

Scope is limited to the two routes. Out of scope:

- `GET /api/shipping-carriers/tracking` keeps its current untranslated `404` body.
- All other provider failures on both routes still answer `502`.
- Tenant/organization scoping is unchanged; the lookup filters stay in the service.

## API Contracts

| Route | Case | Before | After |
|-------|------|--------|-------|
| `POST /api/shipping-carriers/cancel` | `shipmentId` unknown or in another tenant/organization | `502` `{ "error": "Carrier provider request failed. Try again later." }` | `404` `{ "error": "<localized Shipment not found>" }` |
| `POST /api/shipping-carriers/tracking/refresh` | same | same | same |

Every other status of both routes (`200`, `401`, `422`, `502`) is unchanged. The OpenAPI response lists of both routes
document the new `404`.

## Migration & Backward Compatibility

This is a change to an existing API route's response for one error case (`BACKWARD_COMPATIBILITY.md`, API routes,
STABLE): no route, request schema or success response changes, and no field is removed.

- **Status change:** the not-found case moves from `502` to `404`. A `404` here is final: the shipment is not visible to
  the caller and repeating the request returns the same answer. Clients that retried these routes on `502` (or on any
  `5xx`) should stop retrying on `404` and treat it like the existing `404` from `GET /api/shipping-carriers/tracking`.
- **Body change:** the `error` string changes from the generic upstream message to the localized shipment-not-found
  message (`shipping_carriers.errors.shipmentNotFound`). It follows the request locale, so clients must branch on the
  status code, not the text.
- **Logging and alerts:** the not-found case no longer logs a provider upstream error. Alerts on that log for these
  routes now only fire for real carrier failures.
- **Cross-organization ids:** another organization's shipment answers the same `404` as an unknown id, so the response
  does not reveal whether the id exists elsewhere.
- **No data migration:** no schema, event, DI, ACL or generated-file change.

Client guidance is in `UPGRADE_NOTES.md` under 0.9.0 → 0.9.1.

## Integration Coverage

- Unit: `api/cancel/__tests__/route.test.ts` and `api/tracking/refresh/__tests__/route.test.ts` —
  `returns 404 instead of an upstream error when the shipment is not found in scope`.
- Integration: `__integration__/TC-SHIP-021.spec.ts` — both routes with an unknown shipment id and with a shipment of
  another organization, English and Polish bodies, and the foreign shipment left unchanged.
- Regression: TC-SHIP-007's unknown-provider cancel case (`>= 400`) still passes.

## Changelog

- 2026-11-10: Spec added for PR #9232.
