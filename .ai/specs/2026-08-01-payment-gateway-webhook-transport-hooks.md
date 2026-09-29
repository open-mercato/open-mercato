# Payment Gateway Webhook Raw Locator Context

- **Status:** planned
- **Date:** 2026-08-01
- **Type:** OSS shared/core framework capability
- **Hub:** `payment_gateways`
- **Consumers:** `.ai/specs/2026-08-01-payment-gateway-webhook-payment-locator.md`, `.ai/specs/2026-07-26-tpay-full-integration.md`

## TLDR

Let the existing optional webhook session locator inspect the exact raw request body and normalized headers in addition to its current parsed-JSON payload. Existing one-argument JSON locators and handler inputs retain their current behavior. This capability only exposes transport context; it does not add another locator, body limit, response formatting, provider parsing, or status behavior.

## Overview

The generic webhook route already passes `rawBody` to provider verification, but `readSessionIdHint` receives only parsed JSON. A form-encoded provider cannot derive its provider session ID, so the route selects no transaction even though the verifier could understand the body.

## Problem Statement

Provider-owned routes would duplicate the generic route's security controls. The session locator needs additive access to raw transport data while preserving source and runtime compatibility for every current JSON provider.

## Proposed Solution

Extend only the existing locator callback:

```typescript
type WebhookLocatorContext = {
  rawBody: string | Buffer
  headers: Record<string, string | string[] | undefined>
}

type WebhookHandlerRegistration = {
  readSessionIdHint?: (
    payload: Record<string, unknown> | null,
    context?: WebhookLocatorContext,
  ) => string | null
}
```

The second parameter is optional. Existing one-argument callbacks continue compiling and receiving the same parsed JSON value.

## Architecture

```text
request
  -> existing body read and JSON-safe parse
  -> readSessionIdHint(parsedJson, optional raw context)
  -> existing bounded providerSessionId candidate query
  -> existing credential verification/queue/status path
```

- Reuse the existing `VerifyWebhookInput.rawBody: string | Buffer` contract rather than inventing another byte type.
- Preserve exact bytes as `Buffer` for registrations that request raw context; pass the same value to locator and verifier without reserialization.
- Decode provider form data once with a fatal UTF-8 decoder inside that provider; malformed encoding fails verification.
- Normalize headers consistently with current verifier input and treat names case-insensitively.
- Never parse tenant/organization scope from the new context.
- Shared/core code remains provider-neutral and contains no provider-specific field names.

## Data Models

No schema or query change. Existing `GatewayTransaction.providerSessionId` candidate selection remains unchanged.

## API Contracts

The route remains `POST /api/payment_gateways/webhook/[provider]`. Status codes, response bytes, rate limiting, body behavior, candidate limit, queue payload, and OpenAPI remain unchanged in this capability.

## Internationalization

No user-facing text. Internal malformed-context errors use structured, non-secret logging.

## UI/UX

No UI or user workflow changes. An implementation with regression tests qualifies for `skip-qa` if no other API/database/UI behavior changes.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Existing JSON locator | Receives identical JSON and works without accepting a second parameter. |
| Form body | Provider sees exact bytes and can derive a session hint. |
| Invalid UTF-8 | Provider rejects before parsing; route fails closed through existing behavior. |
| Missing/empty session hint | Existing no-candidate behavior remains. |
| Request includes tenant fields | Ignore them; stored transaction and credentials remain the only scope source. |
| Mixed-case signature header | Normalized header lookup remains deterministic. |

## Rollout and Operations

Land before form-provider consumers. No provider migration or configuration is required. Rollback is safe until a raw-context registration is enabled; disable that consumer before reverting. Add no new metrics beyond existing webhook/verification logs.

## Testing Strategy and Acceptance Criteria

| Surface | Required coverage |
| --- | --- |
| Source compatibility | Existing one-argument locator compiles unchanged. |
| Runtime compatibility | Existing JSON payload, handler body, headers, candidate query, queue, and response are unchanged. |
| Raw context | Fixture form locator receives exact bytes and normalized headers. |
| Failure | Malformed body and empty hint fail closed without request scope use. |

Acceptance requires the complete existing Stripe webhook suite to pass without registration changes and a fixture provider to locate a form-encoded session from exact raw bytes while every other route behavior stays unchanged.

## Out of Scope and Follow-up Specifications

- Secondary payment locator/candidate validation: `.ai/specs/2026-08-01-payment-gateway-webhook-payment-locator.md`.
- Streamed body limits: `.ai/specs/2026-08-01-payment-gateway-webhook-body-limits.md`.
- Typed outcomes/provider responses: `.ai/specs/2026-08-01-payment-gateway-webhook-response-formatting.md`.
- Tpay protocol: `.ai/specs/2026-07-26-tpay-full-integration.md`.

## Risks & Impact Review

### Existing locator regression

- **Scenario:** Passing raw context changes a current locator's input or handler body.
- **Severity:** High
- **Affected area:** Existing payment webhooks.
- **Mitigation:** Optional second parameter, unchanged first parameter, same raw value to verifier, and byte/runtime regression tests.
- **Residual risk:** Future refactors could reserialize the body; exact-byte fixture remains a gate.

### Request-scope confusion

- **Scenario:** A provider treats raw tenant fields as trusted scope.
- **Severity:** Critical
- **Affected area:** Cross-tenant payment status.
- **Mitigation:** Route scope derivation remains unchanged; documentation/tests reject request scope.
- **Residual risk:** Third-party verifier code can parse arbitrary fields, but it cannot select route scope without verified stored candidates.

## Migration & Backward Compatibility

- The locator's second parameter and new context type are optional/additive.
- Existing callback signature, import path, route, responses, event IDs, DI keys, queue, and schema remain stable.
- No deprecation, migration, backfill, or tenant action.
- `UPGRADE_NOTES.md` documents the optional raw context for third-party providers.

## Implementation Plan

1. Add the optional context type/callback parameter and compatibility test.
2. Preserve/pass exact raw input and normalized headers without changing the legacy branch.
3. Add fixture form locator and full Stripe route regression tests.
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
| One independently deployable capability | Compliant | Only raw locator/header context is added. |
| Public compatibility | Compliant | Optional parameter; legacy payload/runtime unchanged. |
| Tenant scope | Compliant | Scope derivation is not changed or exposed. |
| Integration coverage | Compliant | Stripe regression and exact-byte fixture are merge gates. |

### Non-Compliant Items

None identified; architecture review remains required for the protected shared callback type.

### Verdict

Fully compliant — ready for implementation.

## Changelog

### 2026-08-01

- Split raw locator/header context from the broader webhook transport proposal.
