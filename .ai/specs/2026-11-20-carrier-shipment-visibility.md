# Carrier shipment visibility and repeat-shipment warning

Status: proposed
Issues: #3562, #3563

## TLDR

Show wizard-created carrier shipments in the sales order's existing Shipments tab. Before another carrier shipment is submitted, show the existing shipment count and require an explicit acknowledgement. Implement both features within `shipping_carriers`, using the existing sales injection host and UI primitives.

## Overview

Warehouse operators need to see the results of a carrier dispatch and notice earlier dispatches before repeating one. The current wizard stores `CarrierShipment` records by order ID, while the sales Shipments tab displays only `SalesShipment` rows. The carrier enricher cannot add rows to that list. The wizard neither reads earlier carrier shipments nor warns about them.

Related designs: `implemented/SPEC-045c-payment-shipping-hubs.md` and `SPEC-062-2026-03-18-sales-native-shipping-carrier-refactor.md`. This proposal adds visibility without implementing the latter's sales-shipment linkage or migrations.

## Problem Statement

- #3562: an operator creates a carrier shipment, returns to the order, and cannot see the tracking reference or shipment status.
- #3563: an operator reopens the wizard and creates another shipment without seeing that earlier shipments exist.

Carrier shipment records contain no item quantities. Counting them cannot establish whether an order is fully fulfilled. A quantity-based rejection would therefore invent a business constraint unsupported by the data.

## Proposed Solution

1. Add an authenticated, scoped, read-only `GET /api/shipping-carriers/shipments` alongside the existing POST. Require an order ID, validate pagination, and return minimal carrier shipment summaries and their total count.
2. Inject a read-only `CarrierShipmentsSection` at the existing `detail:sales.order:shipping` host. Use a paginated `DataTable` with carrier, tracking number, localized status, and creation date. Records appear even when the order has no `SalesShipment` rows. Include loading, empty and retryable error states; keep horizontal scrolling inside the section.
3. On the wizard confirmation step, fetch the same order-scoped summary. When records exist, show a warning with the total and an acknowledgement checkbox. Disable submission until it is acknowledged. Recheck before submission so a shipment created in another window is noticed; a changed count clears the acknowledgement and requires another review.
4. A failed check displays a retryable error and prevents the create request until the count can be read. An order change clears results, acknowledgement and pending request state. Cancelled shipments remain visible and count towards the warning: this is dispatch history, not a fulfillment decision.

## Architecture

- The shipping module owns the entity, read endpoint, section and wizard behavior. Sales code is unchanged; the module registers a render widget in its injection table.
- Backend reads use `findWithDecryption` with trusted tenant and organization scope, `deletedAt: null`, deterministic creation-date/ID ordering and a bounded page size. Count and page use the same scope.
- View or manage permission permits reading summaries. POST permission and mutation-guard behavior remain unchanged. An unauthorized injected widget renders nothing and sends no read request.
- Client calls use `apiCall`; the existing wizard retains its `useGuardedMutation` write path. No new command, event, provider call, dependency or global client provider is introduced.
- Responses omit label bytes, tracking-event payloads, addresses, contacts and carrier credentials.

### Frontend Architecture Contract

The existing wizard remains a client island. New `CarrierShipmentsSection` and its thin injection widget are client islands because they load paginated data and retry requests. Shared data contracts and request helpers are server-safe where possible. No changes to the backend shell, app bootstrap, providers or generated frontend conventions are required. Keep the section implementation below 250 lines, load only one page (default 20, maximum 100), and add no new chart/editor dependencies. Verify hydration/interactivity through the real order injection and wizard confirmation paths. Record app build and desktop/mobile evidence before marking implementation complete; do not claim bundle or memory improvements without measurements.

## Data Models

Reuse `CarrierShipment` and its existing `updatedAt`; no entity changes or migrations. This is a read-only projection. Summaries contain `id`, `orderId`, `providerKey`, `carrierShipmentId`, `trackingNumber`, `status`, `createdAt` and `updatedAt`. No new user-editable entity or edit/delete form is introduced.

## API Contracts

`GET /api/shipping-carriers/shipments?orderId=<uuid>&page=1&pageSize=20`

- Requires tenant-bound authentication and a concrete authorized organization, plus either `shipping_carriers.view` or `shipping_carriers.manage` using wildcard-aware RBAC.
- Invalid query: 400; missing authentication/scope: 401; missing permissions: 403.
- Response: `{ items: CarrierShipmentSummary[], total: number, page: number, pageSize: number, totalPages: number }`.
- Stable ordering: `createdAt DESC, id DESC`; `pageSize` between 1 and 100.
- Tenant/organization IDs supplied by a caller never override trusted scope. An order from another scope returns no summaries. Deleted rows are excluded.
- Document the new GET in `openApi`; existing POST request/response and side effects are preserved.

## UI/UX and Internationalization

The Shipments tab gains a separately titled Carrier shipments section beneath the existing sales shipment list. It shows a localized empty state when no dispatch exists. Long tracking numbers wrap or scroll within the table's boundary. Use `StatusBadge` with semantic variants and localized status labels, `LoadingMessage`, `ErrorMessage`, `Button` and `Checkbox`.

The wizard's confirmation step shows a warning such as “This order already has {count} carrier shipment(s). Check the order before creating another.” The acknowledgement says “I have checked the existing shipments and want to create another.” All copy ships in en/pl/de/es/ko. Retain keyboard access and the existing guarded submit flow.

## Resolved assumptions (autonomous defaults)

| Question | Default | Rationale |
|---|---|---|
| Reject by shipped quantity or warn? | Warning and explicit acknowledgement. | Requested alternative in #3563; carrier records lack line quantities. |
| Global carrier shipment list? | Defer the optional global page. | #3562 requires order visibility; the order section solves the reported invisibility directly. |
| Cancelled dispatches? | Display and count them. | An earlier dispatch is useful context; acknowledgement still permits a replacement. |
| Read failure during confirmation? | Show retry and prevent submission until checked. | Prevents an unreadable count being treated as zero. |
| Records created in another window? | Recheck immediately before submission. | Changed count invalidates the earlier acknowledgement. This is a warning workflow, not a database concurrency/quantity guarantee. |

No high-stakes assumption or schema rollout is introduced. These defaults are posted on the design PR for override; the initiating instruction requests autonomous completion.

## Implementation Plan

### Phase 1: Scoped summaries

- Add the validated read endpoint and minimal shared response types.
- Add endpoint regressions for auth, permissions, query validation, tenant/organization/deletion scoping, stable ordering and pagination.

### Phase 2: Order visibility and wizard warning

- Build the injected paginated section and register it on the existing sales host.
- Add the confirmation warning, acknowledgement, pre-submit recheck and retry behavior with regression tests.
- Add translations for all five locales.

### Phase 3: Verification

- Add self-contained Playwright coverage for GET summaries and the real order/wizard paths, using mock carrier fixtures and cleanup.
- Run generation, package builds, translation checks, typecheck, unit tests and app build in the configured order. Review the final diff, design-system use and compatibility. Capture desktop/mobile evidence, with limitations recorded explicitly.

## Integration Coverage

New `TC-SHIP-021` covers authenticated GET summaries, denied access, invalid queries, order filtering, scoped/deleted fixtures and pagination without external carrier services. New `TC-SHIP-022` creates an order plus carrier shipment via the mock carrier, verifies the record appears in the order Shipments tab without a sales-shipment row, then verifies the wizard warning and acknowledgement gate. Fixtures are created per test and removed in `finally`. Unit/component tests additionally cover stale responses, order changes, failed reads, changed totals on recheck and preserving the existing create/mutation-guard path.

## Migration & Backward Compatibility

The GET method and injection registration are additive. No existing endpoint, response key, event, ACL feature, entity column, import path, discovery contract or provider behavior is removed or renamed. POST remains callable by integrations without an acknowledgement field; the acknowledgement is an administrative UI decision only. Uninstalling the module removes the section through normal injection discovery. No migration, data repair or backfill is required.

## Risks & Impact Review

| Risk | Severity | Mitigation and residual limit |
|---|---|---|
| Shipment metadata from another tenant or organization | High | Trusted scope on every read/count; denied and cross-scope regressions. |
| Duplicate dispatch due to stale history | Medium | Pre-submit count recheck and renewed acknowledgement. Concurrent submissions can still race; existing idempotency is unchanged and no quantity guarantee is advertised. |
| Carrier service unavailable | Low | Listing reads local records; no provider call. |
| Long references widen the order page | Low | Host-local overflow boundary and mobile test. |
| History check temporarily unavailable | Medium | Retryable error; no create until the check succeeds. |

## Final Compliance Report

Design review: module isolation, scoped/decrypted reads, existing injection/DataTable/mutation primitives, additive contracts, minimal data projection and five-locale coverage are specified. No production dependency or database change. Implementation, runtime performance, full validation and browser evidence remain pending until the separate implementation PR executes this plan.

## Changelog

### 2026-11-20

- Proposed order-level carrier shipment visibility and the explicit repeat-dispatch warning requested by #3562 and #3563.
