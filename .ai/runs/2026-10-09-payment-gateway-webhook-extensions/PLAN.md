# Execution Plan — Payment gateway webhook extensions

- **Date:** 2026-10-09
- **Slug:** payment-gateway-webhook-extensions
- **Source specs:** `.ai/specs/2026-08-01-payment-gateway-webhook-transport-hooks.md`, `.ai/specs/2026-08-01-payment-gateway-webhook-payment-locator.md`, `.ai/specs/2026-08-01-payment-gateway-webhook-response-formatting.md`, `.ai/specs/2026-08-01-payment-gateway-webhook-body-limits.md`
- **Pre-implementation analysis:** `.ai/specs/analysis/ANALYSIS-2026-08-01-payment-gateway-webhook-extensions.md`
- **Base branch:** `develop`
- **Branch:** `mtytula/payment-gateway-webhook-extensions` (pushed to the `fork` remote; PR in `mtytula/open-mercato` against `develop`)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA (filled by the following commit). The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add the shared webhook extension contracts and bounded byte reader | dispatch | done | b5e7c09d8 |
| 1 | 1.2 | Pass raw locator context and optional exact bytes through the webhook route | dispatch | done | `d74e6db83` |
| 1 | 1.3 | Add the secondary payment locator, candidate snapshot and ambiguity rejection | dispatch:capable | done | `ba928307e` |
| 1 | 1.4 | Add typed webhook outcomes and validated provider response formatting | dispatch:capable | done | self |
| 1 | 1.5 | Document the webhook extensions and mark the specs implemented | inline | todo | — |

## Goal

Extend the generic payment gateway webhook route so form-encoded providers with signed correlation and literal acknowledgements (Tpay) can use it without a provider-owned route, while every existing registration keeps byte-identical behavior.

## Scope

- `packages/shared/src/modules/payment_gateways/types.ts` (optional registration/verifier fields, error class, outcome types).
- `packages/shared/src/lib/webhooks/body.ts` (byte reader).
- `packages/core/src/modules/payment_gateways/api/webhook/[provider]/route.ts` + route tests.
- Docs, create-app agentic reference, `UPGRADE_NOTES.md`, spec status/changelogs.

## Non-goals

- Any provider using the new options (Tpay notifications ship separately).
- Changes to body-limit semantics (already implemented by #4512) beyond one side-effect test.
- New metric instruments (telemetry runtime has none for counters).
- Playwright fixture providers (route-level Jest fixtures instead; existing TC-PGWY webhook specs are the regression gate).

## Risks

- Legacy response regression for Stripe/example mock — byte-level tests for no-option registrations.
- False `accepted` — classified only after processing/enqueue resolves; failure-injection tests.
- Cross-tenant selection — intersection, stored-scope credentials, all-candidate verification, ambiguity fails closed.

## External References

None.

## Implementation Plan

### Phase 1 — Webhook extensions

#### 1.1 Add the shared webhook extension contracts and bounded byte reader

- `packages/shared/src/lib/webhooks/body.ts`: add `readBoundedRequestBytes(request, options?) => Promise<Uint8Array>` with the same header preflight/stream limit/cancel semantics; reimplement `readBoundedRequestBody` as `new TextDecoder().decode(await readBoundedRequestBytes(...))` (identical output); export from `packages/shared/src/lib/webhooks/index.ts`.
- `packages/shared/src/modules/payment_gateways/types.ts` (all optional/additive):
  - `WebhookLocatorContext = { rawBody: string | Buffer; headers: Record<string, string | string[] | undefined> }`.
  - `WebhookCandidateSnapshot = { transactionId; paymentId; providerSessionId: string | null; amount: string; currencyCode }`; `VerifyWebhookInput.candidate?: WebhookCandidateSnapshot`.
  - `WebhookResponseOutcome` union (`accepted`, `no_candidate`, `verification_failed`, `verification_unavailable`, `processing_failed`, `payload_too_large`, `rate_limited`), `WebhookHttpResponse = { status; body: string | Record<string, unknown>; contentType?: string }`.
  - `class WebhookVerificationUnavailableError extends Error`.
  - `WebhookHandlerRegistration` + `registerWebhookHandler` options: `readSessionIdHint?(payload, context?)`, `readPaymentIdHint?(payload, context?)`, `rawBody?: 'text' | 'bytes'`, `formatResponse?(outcome) => WebhookHttpResponse`; validate `rawBody` value at registration (`[internal]` error).
- Tests: byte reader (exact bytes incl. invalid UTF-8 preserved, limits), string reader unchanged, registration passthrough/validation, one-argument locator still type-compatible (compile-time usage in test).

#### 1.2 Pass raw locator context and optional exact bytes through the webhook route

- Route: when `rawBody === 'bytes'` read bytes (`readBoundedRequestBytes` when `maxBodyBytes` set, else `new Uint8Array(await req.arrayBuffer())`), wrap as `Buffer`; decode text with non-fatal `TextDecoder` for JSON parse. Otherwise keep the current string read exactly.
- Build `headers` once (existing lowercase normalization) and pass `{ rawBody, headers }` as the second argument to `readSessionIdHint`; handler receives the same `rawBody` value.
- Never derive scope from body/context (unchanged).
- Tests in `packages/core/src/modules/payment_gateways/api/__tests__/webhook-route.test.ts`: one-argument JSON locator unchanged (same payload, string rawBody to handler); form fixture with `rawBody: 'bytes'` locates the session from exact bytes and the handler receives the identical Buffer; mixed-case header lookup; tenant fields in body ignored.

#### 1.3 Add the secondary payment locator, candidate snapshot and ambiguity rejection

- Normalize hints: session hint non-empty string; payment hint must be a canonical UUID (else ignored).
- Query `GatewayTransaction` with `providerKey`, `deletedAt: null`, plus `providerSessionId` and/or `paymentId` (intersection when both), limit 10, newest first; no locator → no candidates.
- For each candidate: resolve credentials with stored scope; call handler with `{ rawBody, headers, credentials, candidate: snapshot }` where snapshot has exactly `transactionId`, `paymentId`, `providerSessionId`, `amount` (stored string), `currencyCode`.
- Verify all candidates; exactly one success selects scope; zero → existing failure; more than one → fail closed (`401` legacy), error log with provider key + count, `reportError` code `payment_gateways.webhook_ambiguous_candidates`; no queue/processing.
- Tests: session-only (Stripe-compatible), payment-only, intersection, mismatched hints → none, malformed UUID ignored, deleted excluded (query filter), limit/order, snapshot fields exact (no scope/metadata), signed amount mismatch rejection continues to next candidate, two tenants, two verified → reject with no enqueue.

#### 1.4 Add typed webhook outcomes and validated provider response formatting

- Classify every route exit into a `WebhookResponseOutcome` after current security/durability decisions: `accepted` only after `processPaymentGatewayWebhookJob` or `queue.enqueue` resolves; `no_candidate` when no candidates; `verification_failed` (incl. ambiguity); `verification_unavailable` when the last verifier error is `WebhookVerificationUnavailableError` and no candidate verified; `processing_failed` when processing/enqueue throws; `payload_too_large`; `rate_limited`.
- No formatter: exact legacy responses (`202 { received: true, queued: true }`, `401 { error: 'Webhook verification failed' }` for all failure outcomes incl. processing failures, `413 { error: 'Webhook payload too large' }`, rate limiter response unchanged, `404` unknown provider).
- Formatter: call with the outcome; validate integer status 200–599, body string or plain object, content type without control characters and matching body family (string → `text/*` default `text/plain; charset=utf-8`; object → JSON); invalid or throwing formatter → generic `500 { error: 'Internal server error' }`, `reportError` code `payment_gateways.webhook_formatter_invalid`. `rate_limited` keeps the rate limiter's response headers.
- One structured info/warn log per request with `providerKey`, `outcome`, `status` (no tenant IDs/body/signatures).
- OpenAPI: provider-neutral possible statuses `200/202/400/401/413/429/500/503`, noting registered providers may define bodies/content types.
- Tests: byte-level legacy responses for each outcome; fixture plain-text formatter for all seven outcomes; enqueue failure never `accepted` (async and local modes); verification-unavailable vs failed; formatter validation matrix (status bounds, body type, content type control chars/mismatch, throw); body-limit overflow with formatter → `payload_too_large` and no locator/credential/verifier calls (also without formatter — side-effect test for the body-limits spec).

#### 1.5 Document the webhook extensions and mark the specs implemented

- `apps/docs/docs/framework/modules/building-gateway-provider.mdx` (+ `payment-gateways.mdx` if it lists registration options): document `rawBody`, locator context, `readPaymentIdHint`, `candidate`, `formatResponse`, `WebhookVerificationUnavailableError`.
- `packages/create-app/agentic/shared/ai/skills/om-integration-builder/references/provider-families.md`: same options briefly.
- `UPGRADE_NOTES.md`: opt-in options and ambiguity hardening.
- Specs: status implemented + implementation changelog entries.
