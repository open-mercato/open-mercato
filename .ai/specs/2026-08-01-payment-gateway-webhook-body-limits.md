# Per-Provider Payment Gateway Webhook Body Limits

- **Status:** planned
- **Date:** 2026-08-01
- **Type:** OSS shared/core webhook resource-bound capability
- **Hub:** `payment_gateways`
- **Consumer:** `.ai/specs/2026-07-26-tpay-full-integration.md`

## TLDR

Let a webhook registration declare a maximum request-body size and enforce it both before and during streaming. Providers that omit the option retain current behavior. This capability only bounds unauthenticated request memory; it does not change locators, verification, candidate scope, queueing, or provider responses.

## Overview

The public payment webhook currently calls `req.text()` without a provider-specific bound. A form provider with a small documented payload can declare a conservative limit, but `Content-Length` alone is untrusted and chunked requests must be stopped while reading.

## Problem Statement

Unauthenticated oversized bodies can consume web-process memory before signature verification. A global breaking limit is not acceptable for existing third-party providers, so the boundary must be optional, additive, and enforced with a framework ceiling.

## Proposed Solution

Add one optional registration field:

```typescript
type WebhookHandlerRegistration = {
  maxBodyBytes?: number
}
```

- Validate at registration: positive safe integer and no greater than a framework maximum.
- When absent, retain current body-read behavior.
- When present, reject a valid declared `Content-Length` above the limit before consuming the stream.
- Regardless of the header, consume bytes incrementally and abort immediately when the configured limit is crossed.
- Accept a body exactly at the limit.
- Never invoke locator, credential lookup, verifier, queue, or idempotency processing after overflow.
- Release/cancel the reader and structured-log only provider, configured limit, and rejection class.

## Architecture

```text
registration lookup + existing rate limit
  -> validate Content-Length if present
  -> bounded stream accumulator
  -> existing parse/locator/verify/queue path
```

The existing provider/IP rate limiter stays before body consumption. Unknown providers retain existing `404`. This capability exposes an internal `payload_too_large` result for later response formatting but retains the current framework error response until that independent capability lands.

## Data Models

No schema, transaction, idempotency, or log-payload model change.

## API Contracts

The route remains `POST /api/payment_gateways/webhook/[provider]`. For a registration with `maxBodyBytes`, overflow returns HTTP `413` using the framework's generic JSON error. Registrations without the option retain current responses. Provider-specific `413` bodies belong to `.ai/specs/2026-08-01-payment-gateway-webhook-response-formatting.md`.

OpenAPI adds provider-neutral `413 Payload Too Large` documentation without provider names or exact provider bodies.

## Internationalization

No user-facing text. The generic error is not localized and contains no provider/tenant enumeration.

## UI/UX

No UI changes. Automated boundary tests qualify the implementation for `skip-qa` when no other contract changes.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Invalid/negative configured limit | Fail registration closed with internal configuration error. |
| Declared length exceeds limit | Return `413` before stream read. |
| Declared length lies below actual chunked body | Stop when actual bytes cross the limit. |
| No `Content-Length` | Enforce during streaming. |
| Invalid `Content-Length` | Ignore it as an optimization signal and enforce actual bytes. |
| Body equals limit | Accept and continue existing path. |
| Stream errors mid-read | Return generic processing error; invoke no verifier. |
| Existing provider omits limit | Preserve current read and response behavior. |

## Rollout and Operations

Land independently; no registration changes are required. Consumers opt in one provider at a time. Rollback removes enforcement after disabling registrations that rely on its overflow classification.

Add counters for declared-length rejection, streamed overflow, stream failure, and accepted body-size histogram without body contents.

## Testing Strategy and Acceptance Criteria

| Surface | Required coverage |
| --- | --- |
| Registration | Absent, exact valid, zero/negative/fractional, and above-framework maximum. |
| Header | Above, equal, below actual, missing, malformed, and duplicate header behavior. |
| Stream | Exact limit, one byte over, multi-chunk over, early cancel, and read failure. |
| Side effects | Locator/verifier/credential/queue/idempotency are not called after rejection. |
| Compatibility | Existing Stripe route behavior passes unchanged without an option. |

Acceptance requires bounded fixture requests to prove exact-limit acceptance and both header/stream rejection, while the complete existing provider suite passes with no registration changes.

## Out of Scope and Follow-up Specifications

- Raw locator context: `.ai/specs/2026-08-01-payment-gateway-webhook-transport-hooks.md`.
- Secondary candidate locator/snapshot: `.ai/specs/2026-08-01-payment-gateway-webhook-payment-locator.md`.
- Provider response formatting: `.ai/specs/2026-08-01-payment-gateway-webhook-response-formatting.md`.
- Tpay's selected 64 KiB limit: `.ai/specs/2026-07-26-tpay-full-integration.md`.

## Risks & Impact Review

### Memory exhaustion

- **Scenario:** Unauthenticated clients stream large/chunked bodies.
- **Severity:** High
- **Affected area:** Web process availability.
- **Mitigation:** Existing rate limit, preflight optimization, enforced streaming limit, immediate cancel, no downstream work.
- **Residual risk:** Providers that do not opt in retain legacy behavior for compatibility.

### Valid provider payload rejection

- **Scenario:** A provider configures a limit below a legitimate notification size.
- **Severity:** Medium
- **Affected area:** Settlement availability.
- **Mitigation:** Explicit per-provider value, exact-boundary tests, size metrics, documented provider envelope.
- **Residual risk:** Provider protocol expansion may require a reviewed limit increase.

## Migration & Backward Compatibility

- `maxBodyBytes` is optional/additive.
- Absence preserves current body read and response behavior.
- No route, verifier, locator, event, queue, DI, schema, or import change.
- `UPGRADE_NOTES.md` documents opt-in semantics; no migration/backfill/tenant action.

## Implementation Plan

1. Add/validate the optional registration field and framework maximum.
2. Implement header preflight plus streaming enforcement/cancel.
3. Add boundary, side-effect, metric, and existing-provider regression tests.
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
| One independently deployable capability | Compliant | Only optional streamed request-body limiting. |
| Public compatibility | Compliant | Existing providers opt out by omission. |
| Resource safety | Compliant | Header and actual stream are both bounded. |
| Integration coverage | Compliant | Boundary and no-side-effect cases are gates. |

### Non-Compliant Items

None identified; architecture review remains required for the public registration option.

### Verdict

Fully compliant — ready for implementation.

## Changelog

### 2026-08-01

- Split per-provider streamed body limiting from the broader webhook transport proposal.
