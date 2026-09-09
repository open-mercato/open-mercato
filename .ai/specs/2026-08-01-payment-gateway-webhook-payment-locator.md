# Payment Gateway Webhook Secondary Payment Locator and Candidate Snapshot

- **Status:** planned
- **Date:** 2026-08-01
- **Type:** OSS shared/core webhook candidate capability
- **Hub:** `payment_gateways`
- **Depends on:** `.ai/specs/2026-08-01-payment-gateway-webhook-transport-hooks.md`
- **Consumer:** `.ai/specs/2026-07-26-tpay-full-integration.md`

## TLDR

Add an optional payment-ID locator, intersect it with the existing provider-session locator, fail closed when more than one stored candidate verifies, and pass a safe stored transaction snapshot to provider verification. This lets a provider validate signed correlation, amount, and currency without querying core entities or receiving tenant scope from the request.

## Overview

The generic route currently queries up to 10 transactions by provider key and provider session ID, then tries candidate credentials. Form gateways can supply a second merchant correlation value, and some must compare signed settlement data with the stored transaction before producing an event. The existing `VerifyWebhookInput` has body, headers, and credentials only.

## Problem Statement

A provider must not query `GatewayTransaction` directly, trust payload scope, or settle a signed but amount-mismatched notification. The route already owns stored candidate selection, so it should expose only the provider-neutral fields needed to validate a candidate and explicitly reject ambiguity.

## Proposed Solution

Add an optional locator and optional safe snapshot to the existing registration/verifier contract:

```typescript
type WebhookCandidateSnapshot = {
  transactionId: string
  paymentId: string
  providerSessionId: string | null
  amount: string
  currencyCode: string
}

type VerifyWebhookInput = {
  rawBody: string | Buffer
  headers: Record<string, string | string[] | undefined>
  credentials: Record<string, unknown>
  candidate?: WebhookCandidateSnapshot
}

type WebhookHandlerRegistration = {
  readPaymentIdHint?: (
    payload: Record<string, unknown> | null,
    context?: WebhookLocatorContext,
  ) => string | null
}
```

All additions are optional. The snapshot deliberately excludes tenant ID, organization ID, payer data, metadata, and credentials.

## Architecture

```text
session hint + optional payment hint
  -> validate/normalize hints
  -> providerKey + deletedAt=null + locator intersection
  -> max 10 newest candidates
  -> candidate-scoped credential resolution
  -> verifier(body, headers, credentials, safe candidate snapshot)
  -> exactly one verified candidate selects stored tenant/org scope
```

Selection rules:

- A session hint maps to `providerSessionId`.
- A payment hint must be a canonical UUID and maps to `paymentId`.
- If both are present, query their intersection; never union them.
- Require at least one locator; limit to 10 candidates ordered newest first.
- Resolve credentials separately using each candidate's stored organization/tenant, but do not place those scope IDs in the snapshot.
- Verification may compare the raw signed values with snapshot amount/currency/correlation before returning an event.
- Continue through all bounded candidates after a verification failure. Exactly one successful verifier selects its stored scope.
- Zero successes fails closed. More than one success is an ambiguity and fails closed; never accept the first verified candidate silently.

## Data Models

No schema change. The query uses existing indexed `GatewayTransaction.providerSessionId` and `GatewayTransaction.paymentId`, plus stored `amount` and `currencyCode` copied into a non-persisted snapshot.

## API Contracts

The public webhook route, auth, response, rate limit, queue payload, and OpenAPI are unchanged by this capability. Only optional registration/verifier inputs and internal candidate selection semantics change.

## Internationalization

No user-facing text. Ambiguity and correlation failures use structured logs with transaction IDs only where safe; no credentials, payer data, raw bodies, or scope enumeration in responses.

## UI/UX

No UI changes. The implementation is `skip-qa` when automated route tests cover the compatibility and security cases.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Existing provider has only session locator | Query/verification behavior stays compatible, except explicit ambiguity now rejects. |
| Both hints match one transaction | Pass its safe snapshot to verification. |
| Hints refer to different transactions | Intersection returns none; perform no mutation. |
| Payment hint is malformed/non-UUID | Treat as no valid payment hint; provider requiring it fails closed. |
| Candidate signature passes but signed amount differs | Provider rejects using snapshot; try remaining bounded candidates. |
| Two candidates verify | Reject ambiguity, alert, and select no scope. |
| Request includes tenant/org IDs | Ignore them; they never enter snapshot or scope selection. |
| Candidate is deleted | Exclude it before credential resolution. |

## Rollout and Operations

Land after raw locator context and before a provider that needs dual correlation. Existing registrations require no changes. Rollback is safe until a consumer uses the payment hint/candidate snapshot. Add counters for no candidate, malformed secondary hint, verification rejection, and verified ambiguity.

## Testing Strategy and Acceptance Criteria

| Surface | Required coverage |
| --- | --- |
| Source compatibility | Existing handler and locator compile without optional fields. |
| Query | Session-only, payment-only, intersection, wrong/malformed UUID, deleted candidate, order, limit 10. |
| Snapshot | Exact ID/amount/currency fields; no scope/PII/metadata leakage. |
| Verification | Candidate credentials/snapshot align; signed amount mismatch rejects. |
| Scope | Request scope ignored; two tenants use only their stored candidate credentials. |
| Ambiguity | Zero, one, and multiple verified candidates produce fail/accept/fail deterministically. |

Acceptance requires a two-tenant fixture to locate one transaction by both hints, validate signed amount from the safe snapshot, and prove wrong-scope and multiple-verification cases cannot select a tenant or emit a lifecycle event.

## Out of Scope and Follow-up Specifications

- Raw locator context: `.ai/specs/2026-08-01-payment-gateway-webhook-transport-hooks.md`.
- Body limit: `.ai/specs/2026-08-01-payment-gateway-webhook-body-limits.md`.
- Response formatting: `.ai/specs/2026-08-01-payment-gateway-webhook-response-formatting.md`.
- Tpay-specific correlation/signatures: `.ai/specs/2026-07-26-tpay-full-integration.md`.

## Risks & Impact Review

### Cross-tenant selection

- **Scenario:** Attacker locators or payload scope select a victim transaction.
- **Severity:** Critical
- **Affected area:** Payment state and downstream settlement.
- **Mitigation:** Validated intersection, stored credentials, safe snapshot, no request scope, bounded full-candidate verification, fail-closed ambiguity.
- **Residual risk:** Shared merchant credentials can verify more than one candidate; the route rejects and alerts.

### Candidate data exposure

- **Scenario:** Provider code receives excessive transaction or tenant data.
- **Severity:** High
- **Affected area:** Module boundaries and sensitive data.
- **Mitigation:** Frozen minimal snapshot fields, no metadata/scope/PII, internal-only delivery, type/shape tests.
- **Residual risk:** Transaction/payment IDs remain identifiers; provider code already needs them for correlation.

## Migration & Backward Compatibility

- Optional `readPaymentIdHint` and `VerifyWebhookInput.candidate` are additive.
- Existing session locator, verifier input fields, route, response, event, queue, DI, schema, and import paths remain.
- Ambiguity rejection hardens an undefined unsafe edge; regression tests cover normal existing providers.
- `UPGRADE_NOTES.md` documents optional fields; no migration/backfill/tenant action.

## Implementation Plan

1. Add minimal optional types and source-compatibility tests.
2. Add validated intersection query, safe snapshot construction, and all-candidate ambiguity handling.
3. Add two-tenant/amount-correlation route tests and structured metrics.
4. Run `yarn generate`, affected shared/core tests/builds, and all configured validation commands.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule | Status | Notes |
| --- | --- | --- |
| One independently deployable capability | Compliant | Secondary correlation and its required safe-candidate validation form one selection capability. |
| Tenant scope | Compliant | Stored candidate credentials select scope; request scope is absent. |
| Module boundary | Compliant | Minimal snapshot avoids provider ORM access. |
| Compatibility | Compliant | All public input additions are optional. |

### Non-Compliant Items

None identified; protected type/route architecture approval remains required.

### Verdict

Fully compliant — ready for implementation after raw locator context.

## Changelog

### 2026-08-01

- Split secondary payment correlation, safe candidate validation, and ambiguity handling from other webhook hooks.
