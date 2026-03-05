# SPEC-058 — Sales Native Payment Gateway Refactor (No Legacy Bridges)

| Field | Value |
|---|---|
| Status | Draft |
| Author | Codex |
| Created | 2026-03-05 |
| Related | SPEC-044, SPEC-045c, SPEC-045h, sales module |

## Goal

Refactor `sales` to use `payment_gateways` and provider modules as first-class payment execution infrastructure.

This spec explicitly excludes:
- legacy dual-read/dual-write credential bridges
- fallback behavior to legacy payment provider settings
- temporary compatibility shims

## Problem

Current payment execution in `sales` is still dominated by legacy provider settings and provider calculators, while `payment_gateways` already provides:
- adapter contract
- transaction persistence
- webhook ingestion
- status machine
- provider module ecosystem

The system currently duplicates concerns and prevents `sales` from fully benefiting from marketplace-managed integrations.

## Target Architecture

1. `sales` uses `payment_gateways` for all gateway-side payment operations.
2. `SalesPaymentMethod` keeps business-level payment method metadata (name, terms, activation), but credential ownership moves fully to integration credentials.
3. Gateway session lifecycle is linked to concrete `SalesPayment` records (no random detached payment IDs).
4. Gateway status changes become canonical for payment state transitions in `sales` (via events/subscribers/commands).
5. Payment method UI in sales configuration is integration-aware and surfaces provider capabilities from installed provider modules.

## Scope

### In Scope

- Sales command and API refactor for gateway-backed payment flows
- Sales detail/document UI updates to invoke payment gateway sessions
- Removing legacy payment provider settings paths for gateway credentials
- Payment method model/API cleanup for native gateway semantics
- Integration tests for end-to-end sales payment flows via gateway adapters

### Out of Scope

- New gateway provider implementation work
- Shipping carrier implementation changes
- Non-payment sales refactors

## Design

### 1. Data Contract Changes

1. `SalesPayment` must reference `gateway_transactions` linkage explicitly (`gatewayTransactionId` or deterministic lookup by `paymentId` with strict one-to-one enforcement).
2. `SalesPaymentMethod` stores:
   - `providerKey`
   - non-secret method config (capture mode, allowed payment types, display config)
3. Secrets and API keys are read only from `IntegrationCredentials`.

### 2. Command Flow

1. `sales` payment creation command creates a `SalesPayment`.
2. Gateway session creation uses that payment ID and persists `GatewayTransaction`.
3. Capture/refund/cancel operations are delegated through `paymentGatewayService`.
4. Status synchronization updates `SalesPayment` status and amounts through sales commands (not direct entity mutation).

### 3. Webhook and Polling Integration

1. Payment gateway webhook/poller updates emit typed events.
2. Sales subscriber(s) consume these events and apply command-based state transitions.
3. Subscribers must be idempotent and safe for retries.

### 4. UI and API Surfaces

1. Sales document payment section supports:
   - create gateway session
   - capture/refund/cancel actions
   - gateway status display
2. Sales payment method config page:
   - shows installed payment integrations
   - edits non-secret method config only
   - links to integration credentials detail page

### 5. Legacy Removal

1. Remove sales runtime dependence on `providerSettings` for secrets.
2. Remove legacy fallback paths in gateway execution.
3. Keep only one canonical credential source: `IntegrationCredentials`.

## API Paths Affected

- `POST /api/sales/payments` and related sales payment mutation endpoints
- `POST /api/payment-gateways/sessions`
- `POST /api/payment-gateways/capture`
- `POST /api/payment-gateways/refund`
- `POST /api/payment-gateways/cancel`
- `GET /api/payment-gateways/status`

## Integration Test Coverage (Required)

1. Create sales payment -> create gateway session -> transaction linked to same `SalesPayment`.
2. Capture from gateway endpoint updates `SalesPayment` captured state and amounts.
3. Refund flow updates `SalesPayment` refunded state and amounts.
4. Webhook-driven success/failure transitions update sales payment status.
5. Payment method config uses integration credentials only (no providerSettings secret dependency).
6. Tenant isolation across all sales + payment gateway operations.
7. UI flow: sales document payment action triggers gateway session and renders status.

All tests must be self-contained and clean up created records.

## Migration & Backward Compatibility

This refactor intentionally drops legacy bridge requirements for payment credentials and execution paths.

Required before merge:
1. release note that sales payment gateway path is now integration-native only
2. migration script or documented admin procedure to move active credentials into integration credentials before rollout
3. explicit cutover checklist in rollout docs

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Incomplete credential migration before cutover | Payment failures | Pre-cutover validator + blocking health checks |
| Divergent sales/payment statuses | Financial inconsistency | Command-driven transitions + invariant tests |
| Webhook ordering/retries | Wrong final status | Idempotency keys + monotonic transition rules |

## Changelog

| Date | Change |
|---|---|
| 2026-03-05 | Initial draft created for sales-native payment gateway refactor |
