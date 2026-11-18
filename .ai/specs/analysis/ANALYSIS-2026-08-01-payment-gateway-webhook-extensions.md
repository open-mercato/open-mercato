# Pre-Implementation Analysis: Payment Gateway Webhook Extensions

- **Specs:**
  - `.ai/specs/2026-08-01-payment-gateway-webhook-transport-hooks.md`
  - `.ai/specs/2026-08-01-payment-gateway-webhook-payment-locator.md`
  - `.ai/specs/2026-08-01-payment-gateway-webhook-body-limits.md`
  - `.ai/specs/2026-08-01-payment-gateway-webhook-response-formatting.md`
- **Analyzed against:** `origin/develop` @ `d75ebf48f` (2026-10-09)
- **Consumer:** `.ai/specs/2026-07-26-tpay-full-integration.md`

## Executive Summary

All four capabilities are additive to `WebhookHandlerRegistration` / `registerWebhookHandler` (`packages/shared/src/modules/payment_gateways/types.ts:252-375`) and the single generic route `packages/core/src/modules/payment_gateways/api/webhook/[provider]/route.ts`. **Body limits are already implemented** by #4512 (registration validation, header preflight + streamed limit, `413`, OpenAPI, unit tests, `UPGRADE_NOTES.md`). The other three specs are implementable but leave four mechanisms undefined (raw-bytes opt-in, verification-unavailable error type, ambiguity outcome, metrics facility). Recommendation: **ready after the targeted spec edits below**; implement as one PR.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Type definitions (2) | `WebhookHandlerRegistration` and `VerifyWebhookInput` gain optional fields only. | None | Keep every addition optional. |
| 2 | Function signatures (3) | `registerWebhookHandler` options gain optional keys; `readSessionIdHint` gains an optional second parameter. | None | Existing one-argument callbacks compile unchanged (test). |
| 3 | API route URLs (7) | No route/response change for registrations without new options. Ambiguity rejection changes behavior only when more than one candidate verifies (today: first verified wins). | Warning | Accepted by the payment-locator spec as hardening; document in `UPGRADE_NOTES.md`. |
| 4–13 | Events, spots, schema, DI, ACL, notifications, CLI, generated, import paths, auto-discovery | Untouched. | None | — |

### Missing BC Section

Present in all four specs.

## Spec Completeness

### Incomplete Sections

| Spec | Gap | Recommendation |
|------|-----|---------------|
| transport-hooks | "Registrations that request raw context" get exact bytes as `Buffer`, but no request mechanism exists; the route cannot detect a two-parameter callback reliably. | Add optional `rawBody?: 'text' \| 'bytes'` (default `'text'`). `'bytes'` passes the same `Buffer` to the locator context and `VerifyWebhookInput.rawBody`; `'text'` keeps today's decoded string for both. JSON parsing for the first locator parameter stays on the decoded text. |
| transport-hooks | No byte reader exists (`readBoundedRequestBody` returns a decoded string). | Add `readBoundedRequestBytes` in `packages/shared/src/lib/webhooks/body.ts`; reimplement the string reader on top of it with identical output. |
| response-formatting | "Typed bounded external verification dependency outage" has no type. | Export `WebhookVerificationUnavailableError` from `@open-mercato/shared/modules/payment_gateways/types`; only instances of it map to `verification_unavailable`. |
| response-formatting | Legacy responses for `no_candidate` / `processing_failed` / `verification_unavailable` not stated. | Without a formatter every one of them keeps today's JSON `401 { error: 'Webhook verification failed' }`; `413`, `429` (rate limiter response incl. headers), and `404` stay byte-identical. |
| response-formatting | Rate-limit headers with a formatter. | Keep the rate limiter's `Retry-After`/rate-limit headers on the formatted `rate_limited` response; the formatter controls status/body/content type only. |
| payment-locator | Outcome for "more than one candidate verifies" not mapped. | Map to `verification_failed` (legacy `401`), log at error level with provider key and candidate count, and `reportError` with code `payment_gateways.webhook_ambiguous_candidates`. |
| payment-locator | Snapshot `amount` format. | Pass the stored numeric string unchanged (`GatewayTransaction.amount`, `numeric(18,4)`, e.g. `"12.3400"`); document it. |
| all | "Counters" required, but `TelemetryRuntime` exposes only `recordHistogram` and spans (`packages/shared/src/lib/telemetry/runtime.ts:29-60`). | Emit one structured log per request with stable fields (`providerKey`, `outcome`, `candidateCount`, `bodyBytes`) and no secrets; skip new metric instruments. |
| body-limits | Status `planned`, but implemented by #4512; side-effect test missing. | Set status implemented, reference #4512, add a route test proving locator/verifier/credentials are not called after overflow. |

## AGENTS.md Compliance

| Rule | Location | Fix |
|------|----------|-----|
| Integration tests for affected API paths | All four specs ask for fixture providers. | Fixture providers registered inside route-level Jest tests (`packages/core/src/modules/payment_gateways/api/__tests__/webhook-route.test.ts` pattern). The existing Playwright webhook specs (`TC-PGWY-006/010/011/013`, mock provider) run as the regression gate. A Playwright fixture provider would require new example-module registrations in both app and template; not justified. |
| `reportError` on swallowed catches | Route `catch` (`route.ts:136-139`) logs only. | Route keeps logging verification failures (expected, unauthenticated noise) and reports only ambiguity, formatter failures, and processing failures. |
| Keep standalone agentic content in sync (lesson) | `packages/create-app/agentic/shared/ai/skills/om-integration-builder/references/provider-families.md` documents `readSessionIdHint`. | Add the new optional options there and in `apps/docs/docs/framework/modules/building-gateway-provider.mdx`. |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Legacy response regression (Stripe, example mock) | Providers retry or stop retrying incorrectly. | Byte-level tests for no-option registrations: status, body, content type for 202/401/413/429/404. |
| False `accepted` | Provider stops retrying before durable work. | Classify `accepted` only after `processPaymentGatewayWebhookJob` / `queue.enqueue` resolve; failure-injection tests in both queue modes. |
| Cross-tenant selection with dual locators | Wrong tenant settles. | Intersection only, UUID validation, stored-scope credentials, verify all candidates, fail closed on ambiguity; two-tenant tests. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Verifying all candidates instead of first match | Up to 10 verifier calls per request. | Candidate limit stays 10; rate limit stays in front. |
| Bytes reader divergence | Text providers receive different strings. | String reader becomes a thin decode of the byte reader; existing body tests unchanged. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- Raw-bytes opt-in mechanism (resolved by `rawBody: 'text' | 'bytes'`).
- Verification-unavailable error type (resolved by `WebhookVerificationUnavailableError`).

### Important Gaps

- Ambiguity outcome mapping, snapshot amount format, rate-limit headers with formatter, metrics facility (resolved above).

## Remediation Plan

### Before Implementation

1. Apply the spec edits above (transport-hooks, payment-locator, response-formatting, body-limits status).

### During Implementation

1. One PR, order: shared byte reader + transport context → payment locator + snapshot + ambiguity → typed outcomes + formatter → body-limit side-effect test → docs/agentic references/`UPGRADE_NOTES.md`.

### Post-Implementation

1. Tpay notification spec consumes `rawBody: 'bytes'`, `readPaymentIdHint`, `candidate`, `maxBodyBytes`, and `formatResponse`.

## Recommendation

Ready to implement after the spec edits.
