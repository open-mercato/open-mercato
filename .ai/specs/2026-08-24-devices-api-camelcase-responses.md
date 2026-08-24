# Devices API camelCase Responses

## TLDR

The `devices` module returns raw database column names (`device_id`, `last_seen_at`, `client_app_version`, …) from `GET /api/devices`, `GET /api/devices/admin/devices` and `GET /api/devices/admin/devices/:id`, while every sibling module returns camelCase. This spec makes camelCase the canonical response shape on all three routes and keeps each snake_case key alongside it as a documented, deprecated alias for one minor version, so no existing consumer breaks while the platform convention is restored.

Scope is limited to the response serialization of those three GET routes and the first-party UI that reads them, per [issue #5513](https://github.com/open-mercato/open-mercato/issues/5513). Route URLs, HTTP methods, request bodies, query parameters, sorting, filtering, ACL features, commands, events, database schema and the push-token secrecy rule are unchanged.

## Problem Statement

Both device list routes declare `list.fields: deviceListFields` and no `transformItem`, so the CRUD factory hands the query engine's raw projection straight to the client:

```
id, tenant_id, organization_id, user_id, device_id, platform,
client_app_version, os_version, locale, push_provider,
push_token_updated_at, last_seen_at, created_at, updated_at
```

The admin detail route has the same problem for a different reason: its local `serializeDevice()` helper maps entity properties onto hand-written snake_case keys.

Every other module transforms the projection before serializing — `sales/orders` returns `orderNumber` / `customerEntityId`, `warranty_claims` returns `claimNumber` / `awaitingStaffReply`, `wms/inventory/balances` and the `eudr` routes do the same through their own `transformItem`. A client written against the platform convention therefore reads `undefined` for every field on this one module. The devices module is also the module a mobile client integrates against first, which is exactly the audience least likely to discover the inconsistency from the codebase.

`deviceListSortFieldMap` already accepts camelCase sort fields (`lastSeenAt`, `createdAt`, `updatedAt`), so the request side of the contract is *already* camelCase — only the response side disagrees with itself.

## Proposed Solution

- Add `transformDeviceListItem` to `api/deviceList.ts` and wire it as `list.transformItem` on both list routes. It reads each column under either spelling, normalizes timestamps to ISO strings, and emits camelCase keys.
- Extract the admin detail serializer into `api/deviceSerialization.ts` as `serializeDeviceDetail`, emitting the same camelCase keys, so both surfaces share one casing decision and the serializer becomes unit-testable outside a route module.
- Keep every snake_case key alongside its camelCase counterpart as a deprecated alias, produced by a single shared helper (`toDeprecatedSnakeCaseAliases`) so removing the bridge later is a one-site change.
- Document both spellings in the OpenAPI item schemas (`deviceListItemSchema`, `deviceDetailItemSchema`), with each deprecated key describing the canonical key that replaces it.
- Migrate the first-party consumers — the devices admin list and edit pages, and the push-notifications send page's device picker — to the canonical keys.
- Cover the change with module unit tests and a new integration spec that pins both the camelCase contract and the alias bridge.

## Overview

`transformItem` is the established mechanism for this in the CRUD factory: the list handler applies it to every raw item before custom-field decoration, translation overlay, access logging and serialization, and the paged export path reuses the transformed items. Using it here means the fix is one option on each route rather than a bespoke response wrapper, and it matches how `warranty_claims`, `eudr`, `wms` and the `sales` line routes already solve the same problem.

The transform spreads the raw record before overlaying the camelCase keys, so anything the projection carries beyond the declared field set (custom-field keys, columns added later) survives rather than being silently dropped by a hand-built object.

Two behaviors are deliberately **not** changed:

- **`push_token` stays out of every response.** It is absent from `deviceListFields` and never read by either serializer; the tests assert its absence under both spellings.
- **The `exportScope=full` branch of the CRUD factory still bypasses `transformItem`** (it serializes `rawItems` through `normalizeFullRecordForExport`). That is framework-wide behavior shared by every module using `transformItem`, so a devices-local fix would be the wrong place to change it. The paged export path — the one a UI export button uses — does go through the transform.

## Acceptance Criteria

1. `GET /api/devices` returns `id`, `tenantId`, `organizationId`, `userId`, `deviceId`, `platform`, `clientAppVersion`, `osVersion`, `locale`, `pushProvider`, `pushTokenUpdatedAt`, `lastSeenAt`, `createdAt`, `updatedAt`.
2. `GET /api/devices/admin/devices` returns the same camelCase key set.
3. `GET /api/devices/admin/devices/:id` returns `item` with `id`, `userId`, `deviceId`, `platform`, `clientAppVersion`, `osVersion`, `pushProvider`, `pushTokenUpdatedAt`, `lastSeenAt`, `createdAt`, `updatedAt`.
4. Every snake_case key previously returned by those three routes is still present and holds the same value as its camelCase counterpart.
5. The detail response does not grow `tenant_id` / `organization_id` keys it never carried.
6. Timestamp columns serialize as ISO strings under both spellings.
7. `push_token` / `pushToken` is absent from every list and detail response.
8. Sorting (`sortField=lastSeenAt|createdAt|updatedAt`), the `?platform=` / `?userId=` filters, self-serve user scoping, admin org scoping and the advanced-filter hardening on the self list are unchanged.
9. The OpenAPI document describes both spellings, marking the snake_case keys as deprecated aliases.
10. The devices admin list page, the devices edit page (including its optimistic-lock header source) and the push-notifications device picker read the canonical camelCase keys.
11. Unit tests cover the list transform and the detail serializer; an integration spec covers both list routes and the detail route, asserting the camelCase contract and the alias bridge.

## Architecture

| File | Change |
|------|--------|
| `packages/core/src/modules/devices/api/deviceList.ts` | Adds `transformDeviceListItem`, `toDeprecatedSnakeCaseAliases` and the shared `toRecord`/`readString`/`toIso` readers; `deviceListItemSchema` gains the camelCase keys and describes the snake_case ones as deprecated |
| `packages/core/src/modules/devices/api/deviceSerialization.ts` | New. `serializeDeviceDetail` + `deviceDetailItemSchema` for the admin detail route |
| `packages/core/src/modules/devices/api/route.ts` | `list.transformItem: transformDeviceListItem` |
| `packages/core/src/modules/devices/api/admin/devices/route.ts` | `list.transformItem: transformDeviceListItem` |
| `packages/core/src/modules/devices/api/admin/devices/[id]/route.ts` | Uses the shared serializer and detail schema instead of its local copies |
| `packages/core/src/modules/devices/backend/devices/page.tsx` | Row type, column accessors and cell readers use camelCase |
| `packages/core/src/modules/devices/backend/devices/[id]/page.tsx` | Detail type, header fields, `initialValues` and `optimisticLockUpdatedAt` use camelCase |
| `packages/core/src/modules/push_notifications/backend/push_notifications/send/page.tsx` | Device picker reads `deviceId` / `pushProvider` |

## Migration & Backward Compatibility

`BACKWARD_COMPATIBILITY.md` § 7 (API Route URLs, STABLE) states that response fields MUST NOT be removed and that a retired surface keeps working for at least one minor version. Renaming a response key is a removal plus an addition, so the deprecation protocol applies even though the module shipped inside the current release window.

The change therefore ships as a **bridge, not a rename**:

1. **No removal in this release.** Every snake_case key a 0.7.0 client reads is still returned, with an identical (now normalized) value.
2. **Deprecated in place.** `toDeprecatedSnakeCaseAliases` carries an `@deprecated` JSDoc naming the replacement keys, and the OpenAPI item schemas describe each alias as "Deprecated alias for `<camelCaseKey>`; removed in the next minor release."
3. **Bridge lifetime.** The aliases are removed no earlier than the next minor release. Removal is a single-site change (drop the alias spread from `transformDeviceListItem` and `serializeDeviceDetail`, and the deprecated keys from the two schemas) and is guarded by `TC-DEV-007`, which asserts the aliases today so their removal cannot land unnoticed.
4. **Documented.** `UPGRADE_NOTES.md` carries a `0.7.0 → 0.7.1` entry with the full key mapping and the client action.

Request-side contracts are untouched: query parameters, sort field names, request bodies and the `PUT`/`DELETE`/`POST` response shapes (`{ id, deviceId, revived }`, `{ ok: true }`) were already camelCase and are unchanged. Database columns keep their snake_case names — this is a serialization change only, with no migration.

The one visible difference for a caller that already read the snake_case keys is normalization: a timestamp column that previously serialized as whatever the query engine produced now always serializes as an ISO-8601 string under both spellings.

## Test Plan

**Unit** — `packages/core/src/modules/devices/__tests__/response-casing.test.ts`

- The list transform emits every camelCase key and maps values from the raw projection.
- The deprecated aliases mirror their camelCase source exactly.
- Date columns normalize to ISO strings; camelCase input is tolerated.
- Keys beyond the declared projection (e.g. `cf_*`) survive the transform.
- `push_token` never becomes `pushToken`.
- Both item schemas parse their serializer's output.
- The detail serializer emits camelCase with ISO timestamps, keeps its aliases, nulls absent optional columns, and does not invent `tenant_id` / `organization_id`.

**Integration** — `packages/core/src/modules/devices/__integration__/TC-DEV-007.spec.ts`

- Self list, admin list and admin detail all expose the camelCase key set for a freshly registered device, and never expose the push token.
- Every deprecated snake_case alias mirrors its camelCase source on both the list and the detail route.

Existing `TC-DEV-001`, `TC-DEV-005` and `TC-DEV-006` continue to assert the snake_case keys and are left unchanged: for the duration of the bridge they are the regression proof that no 0.7.0 consumer broke.
