# Tpay Authoritative Transaction Notification Settlement

- **Status:** planned
- **Date:** 2026-07-26
- **Type:** OSS payment-provider settlement capability
- **Provider package:** `@open-mercato/gateway-tpay` (`gateway_tpay`)
- **Hub:** `payment_gateways`
- **Depends on:**
  - `.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md`
  - `.ai/specs/2026-08-01-payment-gateway-webhook-transport-hooks.md`
  - `.ai/specs/2026-08-01-payment-gateway-webhook-payment-locator.md`
  - `.ai/specs/2026-08-01-payment-gateway-webhook-body-limits.md`
  - `.ai/specs/2026-08-01-payment-gateway-webhook-response-formatting.md`

## TLDR

Settle hosted Tpay transactions from the provider's server notification instead of depending on payer return-page polling. The handler parses the exact form body, correlates `tr_id` and `tr_crc`, verifies merchant MD5 and mandatory detached JWS, validates signed amount/currency against the selected stored transaction snapshot, creates a deterministic event, and returns exact `200 text/plain TRUE` only after processing or durable enqueue.

Hosted session/provider foundation and all generic route extensions are separate prerequisites. Scheduled recovery, payment methods, refunds, EUR, and storefront work are separate capabilities.

## Overview

The hosted PLN provider can complete through the payer's return-page status read. That path is not authoritative: the payer may close the page, redirects may fail, and Tpay retries a notification until the merchant returns literal `TRUE`. This capability adds only notification-driven settlement to the existing provider package.

Primary protocol source: <https://docs-api.tpay.com/en/webhooks/>. Tpay documents form-encoded transaction notifications, mandatory `X-JWS-Signature`, public signing/root certificates, merchant MD5, duplicate delivery, no redirects, retry behavior, and the exact success acknowledgement.

## Problem Statement

Safe notification settlement requires dual stored correlation without request scope, merchant MD5 plus detached JWS, raw-byte/certificate/payload bounds, signed amount/currency validation, deterministic duplicate identity, durable queue acknowledgement, and operational acceptance evidence. A provider-owned route is rejected because it would duplicate generic rate limiting, candidate scope, queueing, idempotency, logging, and status synchronization.

## Proposed Solution

Register a Tpay handler on the existing `/api/payment_gateways/webhook/tpay` route using all prerequisite generic capabilities.

| Decision | Rationale |
| --- | --- |
| `tr_id` plus `tr_crc` intersection | Maps signed provider session and merchant correlation to one stored candidate. |
| Safe candidate snapshot | Compares signed correlation/amount/currency without provider ORM access. |
| MD5 and JWS mandatory | MD5 binds tenant merchant fields; JWS authenticates Tpay and exact content. |
| Notification authoritative | Settlement no longer depends on payer navigation. |
| Deterministic identity, no freshness window | Delayed retries remain valid and effects remain at most once. |
| Exact formatter and 64 KiB limit | Tpay receives required acknowledgement while unauthenticated memory is bounded. |

## Architecture

```text
Tpay form POST
  -> generic provider/IP rate limit + 64 KiB bounded read
  -> raw locators: tr_id + UUID tr_crc
  -> generic intersection/candidate credential loop
  -> Tpay handler(body, headers, credentials, safe snapshot)
     -> form + MD5 + JWS + stored amount/currency
     -> normalized event/idempotency key
  -> existing local/async processor
  -> Tpay outcome formatter: TRUE/FALSE
```

Provider files added to the existing foundation:

| Component | Responsibility |
| --- | --- |
| `lib/webhook-handler.ts` | Form validation, dual verification, snapshot comparison, normalized event. |
| `lib/checksum.ts` | Timing-safe documented MD5. |
| `lib/jws.ts` | Certificate URL/fetch/cache/chain policy and detached RS256. |
| notification registration in `di.ts` | Locators, 64 KiB limit, handler, exact response policy. |
| notification locale/docs additions | Merchant Panel URL, health, and operator guidance. |

The provider creates no route/worker, queries no `GatewayTransaction`, and imports no core internals.

### Candidate correlation and stored validation

Locators return bounded `tr_id` and canonical UUID `tr_crc`. The generic candidate capability intersects provider key, stored session/payment IDs, and `deletedAt = null`, limited to 10 newest. It resolves credentials from each stored scope and passes a safe snapshot with transaction/payment/session IDs, amount, and currency.

The handler accepts a candidate only when both signatures verify, snapshot IDs match `tr_id`/`tr_crc`, optional `tr_currency` is PLN and equals snapshot currency, `tr_amount` equals snapshot amount, and successful `tr_status` reports `tr_paid` at least equal to expected amount. Tpay does not mark `tr_currency` as always present, so absence is accepted only because the stored transaction/provider foundation is PLN-only.

Parse canonical decimals to minor units without binary floating point. Mismatch rejects before event/idempotency creation and alerts. Overpayment settles only expected local amount and retains bounded operator metadata. Zero/multiple verified candidates fail closed. Notification-before-commit yields retryable `503 FALSE`.

### Form, MD5, and raw-body rules

- Decode the exact bounded `Buffer` once with fatal UTF-8 and parse `URLSearchParams`; never reserialize before signature verification.
- Reject duplicate security fields, missing required fields, invalid lengths/formats, and unexpected notification type.
- Compute lowercase hex `MD5(id + tr_id + tr_amount + tr_crc + notificationSecurityCode)` using decoded lexical values.
- Compare equal-length checksum bytes timing-safely.
- Never log raw body, `tr_email`, card/token fields, JWS bytes, credentials, or security code.

### JWS and certificate boundaries

- Require three compact segments, empty detached-payload segment, and protected `alg = RS256`.
- Require exact HTTPS `x5u` `https://secure.tpay.com/x509/notifications-jws.pem`, with no user info/query/fragment and no redirects in either API mode. Do not infer a sandbox hostname.
- Bound certificate fetch to 2-second connect, 3-second read, and 64 KiB response.
- Bundle reviewed root from `https://secure.tpay.com/x509/tpay-jws-root.pem`; validate leaf dates/chain.
- Cache verified leaf at most one hour and not beyond expiry; force one refresh after verification failure; negative-cache fetch failure 30 seconds.
- Verify RSA-SHA256 over `base64url(protectedHeader) + '.' + base64url(exactRawBodyBytes)`.
- Invalid evidence maps `verification_failed`; certificate dependency unavailability maps `verification_unavailable` for retryable `503 FALSE`.

### Notification identity

```text
eventType: tpay.transaction.settled | tpay.transaction.chargeback
eventId: <tr_id>:<tr_status>:<tr_date>
idempotencyKey: tpay:transaction:<tr_id>:<tr_status>:<tr_date>
```

Identical retries share identity. Existing `WebhookProcessedEvent` uniqueness includes provider, tenant, organization, so duplicates return `TRUE` without repeated effects. Later chargeback stays distinct. No freshness rejection.

Refund identity is not transaction status. A future refund capability persists each immutable `refundId` and proves distinct partial refunds/retries; Tpay documents partial refunds do not change transaction status: <https://docs-api.tpay.com/en/refunds/>.

## Data Models

No schema change.

| Existing model/field | Use |
| --- | --- |
| `GatewayTransaction.providerSessionId` / `paymentId` | Signed `tr_id` / `tr_crc` correlation. |
| `GatewayTransaction.amount` / `currencyCode` | Signed settlement validation snapshot. |
| `gatewayMetadata` / `webhookLog` | Bounded provider details and normalized processing record. |
| `WebhookProcessedEvent` | Scoped duplicate claim. |

No new PII/credentials are persisted. Credentials remain encrypted; certificates are public.

## API Contracts

- Route: `POST /api/payment_gateways/webhook/tpay`; public callback, no user session.
- Content type: `application/x-www-form-urlencoded`.
- Required header: `X-JWS-Signature`.
- Required fields: `id`, `tr_id`, `tr_date`, `tr_crc`, `tr_amount`, `tr_paid`, `tr_desc`, `tr_status`, `tr_error`, `tr_email`, `md5sum`, `test_mode`.
- Optional `tr_currency`, when present, must be PLN.

| Outcome | Status | Content type | Body |
| --- | ---: | --- | --- |
| Verified and processed or durably enqueued | 200 | `text/plain; charset=utf-8` | `TRUE` |
| Candidate not committed, certificate dependency unavailable, or processing unavailable | 503 | `text/plain; charset=utf-8` | `FALSE` |
| Invalid MD5/JWS, amount/currency/correlation mismatch, or ambiguity | 400 | `text/plain; charset=utf-8` | `FALSE` |
| Request over 64 KiB | 413 | `text/plain; charset=utf-8` | `FALSE` |
| Rate limited | 429 | `text/plain; charset=utf-8` | `FALSE` |

Exact requirements live in `gateway_tpay` README/operator docs and tests. The static generic route OpenAPI stays provider-neutral, listing possible types/statuses without promising Tpay fields, header, or literals.

## Internationalization

Add notification URL help, verification/health state, and operator guidance to English, Polish, German, and Spanish catalogs. `TRUE`/`FALSE` are protocol tokens, not localized. Internal errors use `[internal]`.

## UI/UX

No new component. Existing integration form shows callback help and existing payment/transaction UI reflects canonical events. The implementation PR requires manual payment-path QA; this spec PR remains `skip-qa`.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Notification before commit | `503 FALSE`; retry settles once. |
| Identical duplicate | `200 TRUE`; one lifecycle effect. |
| Locators disagree | No candidate/mutation. |
| Signed amount/currency mismatch or underpayment | `400 FALSE`, no claim, alert. |
| Overpayment | Settle expected amount; bounded operator metadata. |
| Multiple candidates verify | Reject/alert ambiguity. |
| MD5/JWS mismatch | `400 FALSE`; no job/claim. |
| Certificate timeout/rotation | Refresh once; `503 FALSE`; metric. |
| Async enqueue fails | `503 FALSE`; retry safe. |
| Worker throws after claim | Existing release-on-failure permits retry. |
| Unknown status | Never map to captured; log/alert. |

## Rollout and Operations

Land hosted provider and four generic prerequisites, configure final non-redirecting callback, use Tpay's test tool, prove one notification-only sandbox capture, then enable one production tenant and observe duplicate retry. Rollback disables new sessions but leaves handler/adapter for in-flight settlement. No migration rollback.

Metrics: received/verified/rejected/duplicate/processed, body/rate rejection, certificate fetch/cache/chain/latency, candidate absence/ambiguity, amount/currency mismatch/overpayment, enqueue/worker failure, unknown status. Alert on sustained certificate/queue failures, ambiguity, mismatch, or callback rejection.

## Testing Strategy and Acceptance Criteria

Fixtures create/clean tenant, organization, credentials, payment, transaction; HTTP/certs are deterministic; sandbox tests are credential-gated.

| Surface | Required coverage |
| --- | --- |
| Form | Required/optional, duplicate/malformed/oversize/invalid UTF-8. |
| MD5/JWS | Valid plus altered fields, alg/segments/signature/date/chain/origin/path/redirect/timeout/oversize. |
| Candidate | Two locators, safe snapshot, wrong scope, zero/one/multiple verification. |
| Amount | PLN present/absent, non-PLN, exact, under/over/mismatch, canonical decimal. |
| Identity | Duplicate once; later chargeback distinct; delayed retry accepted. |
| Queue/response | Local/async, failures, exact bytes for every outcome. |
| E2E | Sandbox captures by notification with return-page polling disabled. |

Acceptance requires notification-only sandbox capture, tampered MD5/JWS/amount rejection, pre-commit retry success, and one captured event across duplicates.

## Out of Scope and Follow-up Specifications

- Hosted provider/session/status: `.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md`.
- Generic route capabilities: listed prerequisites.
- Scheduled recovery: `.ai/specs/2026-08-01-tpay-status-reconciliation.md`.
- Channels, direct BLIK/aliases, cards/3DS/tokenization/wallets, refunds/cancel/capture, EUR/POS, storefront/portal.

## Risks & Impact Review

### Forged cross-tenant settlement

- **Severity:** Critical
- **Mitigation:** Locator intersection, stored credentials/snapshot, dual signatures, amount/currency, fail-closed ambiguity.
- **Residual risk:** Shared credentials can verify multiple candidates; reject/alert.

### Certificate dependency outage

- **Severity:** High
- **Mitigation:** Exact URL, bundled root, bounds/cache/refresh, retryable outcome, fallback status read, alerts.
- **Residual risk:** Settlement delayed, never accepted unverified.

### False success acknowledgement

- **Severity:** Critical
- **Mitigation:** `TRUE` only after sync completion/durable enqueue; failure-injection tests.
- **Residual risk:** Queue durability follows configured implementation contract.

### Signed amount mismatch

- **Severity:** Critical
- **Mitigation:** Safe snapshot and canonical comparison before event/claim.
- **Residual risk:** Overpayment needs operator decision; local amount not inflated.

### Notification/commit race

- **Severity:** Medium
- **Mitigation:** Retryable `503 FALSE`, deterministic identity, integration test.
- **Residual risk:** Provider timing external; reconciliation is separate recovery.

## Migration & Backward Compatibility

- Adds notification files/registration to existing Tpay foundation; implementation changes no shared/core/UI files.
- Consumes optional generic prerequisites; their existing-provider defaults remain unchanged.
- Existing routes, adapter signatures, events, queues, DI keys, database fields, and registries stay stable.
- Existing hosted sessions remain status-readable; no migration/backfill; enable per tenant after callback setup.

## Implementation Plan

1. Add form/checksum/JWS modules and reviewed bundled root.
2. Register locators, snapshot validation, limit, typed errors, handler, formatter.
3. Add event identity, bounded logs/metadata, locales/docs, metrics/alerts.
4. Add protocol/scope/amount/idempotency/queue/response tests.
5. Validate sandbox; run `yarn generate`, affected tests/builds, integration/full gate, and payment-path QA.

One provider PR delivers this capability after prerequisites.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/ui/AGENTS.md`
- `.ai/skills/om-integration-builder/SKILL.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule | Status | Notes |
| --- | --- | --- |
| One independently deployable capability | Compliant | Only authoritative Tpay transaction notification settlement. |
| Provider/core boundary | Compliant | Generic hooks/safe snapshot; no route/entity duplication. |
| Tenant/credential safety | Compliant | Stored candidate credentials plus dual verification. |
| Idempotency/durability | Compliant | Deterministic key; `TRUE` after durable work only. |
| Protocol/security | Compliant | Raw body, MD5/JWS, cert/amount validation. |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Stored data available to verifier | Pass | Candidate prerequisite supplies minimal snapshot. |
| API/OpenAPI ownership | Pass | Exact contract in provider docs; generic OpenAPI neutral. |
| Scope cohesion | Pass | Hosted provider, four generic hooks, reconciliation separate. |

### Non-Compliant Items

None identified. All prerequisites must land before implementation.

### Verdict

Fully compliant — ready for implementation after prerequisites.

## Changelog

### 2026-08-01

- Narrowed original proposal to authoritative transaction notification settlement.
- Split hosted foundation, four generic webhook capabilities, and reconciliation.
- Defined dual-signature/certificate, snapshot/amount, identity, response, rollout, and acceptance contracts.

### 2026-07-26

- Initial Tpay production-integration proposal.
