# Payment Gateway Webhook Typed Outcomes and Response Formatting

- **Status:** planned
- **Date:** 2026-08-01
- **Type:** OSS shared/core webhook acknowledgement capability
- **Hub:** `payment_gateways`
- **Consumer:** `.ai/specs/2026-07-26-tpay-full-integration.md`

## TLDR

Model generic webhook route outcomes and let a registration format their HTTP status, body, and content type. Existing providers that omit the formatter keep their exact JSON `202`/`401` behavior. This capability changes acknowledgement presentation only; it does not change body reading, locators, candidate scope, verification algorithms, queue durability, or payment effects.

## Overview

The generic route returns JSON `202` after local processing or async enqueue and JSON `401` for every verification failure. Some providers require a literal plain-text acknowledgement and retry otherwise. Copying the route would duplicate critical controls.

## Problem Statement

The route needs provider-configurable responses without exposing provider protocol in core, acknowledging before durable work, conflating invalid evidence with a transient verification dependency, or changing existing providers.

## Proposed Solution

Add typed internal outcomes and one optional formatter:

```typescript
type WebhookResponseOutcome =
  | 'accepted'
  | 'no_candidate'
  | 'verification_failed'
  | 'verification_unavailable'
  | 'processing_failed'
  | 'payload_too_large'
  | 'rate_limited'

type WebhookHttpResponse = {
  status: number
  body: string | Record<string, unknown>
  contentType?: string
}

type WebhookHandlerRegistration = {
  formatResponse?: (outcome: WebhookResponseOutcome) => WebhookHttpResponse
}
```

- `accepted` occurs only after synchronous processing succeeds or async enqueue is durable.
- Invalid/malformed signature/correlation uses `verification_failed`; a typed bounded external verification dependency outage uses `verification_unavailable`.
- Missing candidate and downstream processing/enqueue failures remain distinct retryable outcomes.
- Rate limiting and optional body-limit rejection use the formatter after registration lookup.
- Unknown-provider `404` remains framework-owned because no formatter exists.

### Formatter validation

Validate at request time before constructing a response:

- integer status from 200 through 599;
- body is a string or plain JSON object;
- content type contains no control characters and matches the selected body family;
- output contains no headers/cookies/redirect location beyond the modeled fields.

Invalid formatter output fails closed with a generic `500`, structured log, and no provider/tenant details.

## Architecture

```text
existing route control flow
  -> classify one typed outcome
  -> registration.formatResponse? validated response : exact legacy response
```

The core contains no provider names, form fields, expected literal bodies, or provider retry schedule. Queue/idempotency/service behavior determines outcomes and remains canonical.

## Data Models

No schema, transaction, webhook log, or idempotency change.

## API Contracts

The route remains `POST /api/payment_gateways/webhook/[provider]`.

- Without a formatter, exact current JSON `202` acceptance and JSON `401` verification failure are frozen, including content type.
- With a formatter, the provider can map every modeled outcome to a validated response.
- OpenAPI remains provider-neutral: it documents that registered providers may define content types/bodies for `200`/`202`, `400`/`401`, `413`, `429`, `500`, and `503`. Exact provider fields, headers, and bodies live in provider documentation, not this static generic route definition.

No new route or provider-supplied OpenAPI mutation is introduced.

## Internationalization

No user-facing text. Generic internal failures are non-enumerating and provider response strings are protocol tokens, not localized copy.

## UI/UX

No UI changes. Byte-level response and compatibility tests qualify the implementation for `skip-qa` if no other contract changes.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Existing provider omits formatter | Preserve exact response status/body/content type. |
| Synchronous processor succeeds | Format `accepted` only after completion. |
| Async enqueue fails | Format `processing_failed`, never `accepted`. |
| Signature is invalid | Format `verification_failed`. |
| Certificate service times out | Typed verifier error maps to `verification_unavailable`. |
| Rate limit rejects | Format `rate_limited`; no body/verification work. |
| Body-limit capability rejects | Format `payload_too_large`; no verifier work. |
| Formatter returns invalid status/body/content type | Generic `500`, structured log, no secret/detail leak. |
| Provider is unknown | Existing framework `404`; no formatter invocation. |

## Rollout and Operations

Land independently with a fixture formatter and full default regression suite. Providers opt in later. Rollback requires disabling formatter consumers first.

Add counters by provider and outcome, formatter validation failure, and emitted status family. Never label metrics with tenant IDs, raw bodies, signatures, or credentials.

## Testing Strategy and Acceptance Criteria

| Surface | Required coverage |
| --- | --- |
| Default | Byte-level current success/failure/rate-limit behavior for existing provider. |
| Outcomes | All seven classifications, including invalid versus unavailable verification. |
| Durability | No accepted outcome before synchronous completion or durable enqueue. |
| Validation | Status bounds, body type, content type controls/mismatch, thrown formatter. |
| Security | Response/logs never expose verification detail, credentials, or tenant scope. |
| OpenAPI | Provider-neutral possible responses only; no consumer-specific exact body. |

Acceptance requires a fixture provider to emit custom plain-text responses for every outcome while Stripe/default responses remain byte-compatible and enqueue failure can never be acknowledged as accepted.

## Out of Scope and Follow-up Specifications

- Raw locator context: `.ai/specs/2026-08-01-payment-gateway-webhook-transport-hooks.md`.
- Secondary candidate locator/snapshot: `.ai/specs/2026-08-01-payment-gateway-webhook-payment-locator.md`.
- Body limits: `.ai/specs/2026-08-01-payment-gateway-webhook-body-limits.md`.
- Tpay's exact acknowledgement table/provider docs: `.ai/specs/2026-07-26-tpay-full-integration.md`.

## Risks & Impact Review

### False success acknowledgement

- **Scenario:** Route tells a provider to stop retrying before work is durable.
- **Severity:** Critical
- **Affected area:** Payment settlement availability/correctness.
- **Mitigation:** Outcome emitted after processor/enqueue success only; failure injection in both queue modes.
- **Residual risk:** External queue durability depends on the configured queue implementation's contract.

### Existing response regression

- **Scenario:** Outcome refactor changes Stripe/third-party status/body/content type.
- **Severity:** High
- **Affected area:** All payment webhooks.
- **Mitigation:** Explicit no-formatter legacy branch and byte-level regression tests.
- **Residual risk:** Future refactor could merge paths; tests remain the gate.

### Malicious/invalid formatter

- **Scenario:** Third-party registration emits unsafe status, content type, or body.
- **Severity:** High
- **Affected area:** Public callback behavior/log safety.
- **Mitigation:** Narrow output type, runtime validation, no arbitrary headers/redirects, generic fail-closed response.
- **Residual risk:** A valid plain-text body is provider-controlled by design.

## Migration & Backward Compatibility

- Formatter and outcome types are optional/additive.
- Existing response bytes, route, verifier, locator, queue, event, DI, schema, and imports remain stable without a formatter.
- Typed verifier-unavailable classification is internal/additive; existing thrown errors continue as verification failure unless explicitly marked.
- `UPGRADE_NOTES.md` documents opt-in behavior; no migration/backfill/tenant action.

## Implementation Plan

1. Introduce internal outcome classification and optional response types/registration field.
2. Refactor route exits to classify only after current security/durability decisions.
3. Add output validation, provider-neutral OpenAPI possibilities, metrics, and safe failure.
4. Add fixture/custom and byte-level legacy regression tests in local/async modes.
5. Run `yarn generate`, affected shared/core tests/builds, and all configured validation commands.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/queue/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule | Status | Notes |
| --- | --- | --- |
| One independently deployable capability | Compliant | Only typed outcome-to-response acknowledgement behavior. |
| Durability/idempotency | Compliant | Accepted follows processor or durable enqueue. |
| Public compatibility | Compliant | No-formatter responses are byte-frozen. |
| Provider neutrality | Compliant | Static OpenAPI/core contain no consumer protocol. |

### Non-Compliant Items

None identified; architecture review remains required for public registration/route behavior.

### Verdict

Fully compliant — ready for implementation.

## Changelog

### 2026-08-01

- Split typed outcomes and provider acknowledgement formatting from other webhook hooks.
