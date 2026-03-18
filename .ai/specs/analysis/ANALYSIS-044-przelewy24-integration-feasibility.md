# ANALYSIS-044 — Przelewy24 Integration Feasibility

| Field | Value |
|-------|-------|
| **Related Spec** | SPEC-044 (Payment Gateway Integrations) |
| **Provider** | Przelewy24 (P24) |
| **Date** | 2026-02-24 |
| **Verdict** | Feasible with adapter contract gaps. ~70% of the `GatewayAdapter` interface maps cleanly; 30% requires no-op stubs or P24-specific workarounds. |

---

## Executive Summary

Przelewy24 is a Polish payment aggregator supporting bank transfers, BLIK, cards, Apple Pay, Google Pay, installments, and BNPL. SPEC-044 defines a `GatewayAdapter` contract modeled primarily around card-centric gateways (Stripe, PayU) that use authorize-then-capture flows. P24 operates on a fundamentally different model: **immediate settlement with redirect-based authentication**. This creates friction in 3 of the 7 adapter methods but does not block integration.

The core transaction flow (register → redirect → webhook → verify) maps well to `createSession()` + `verifyWebhook()`. The main gaps are around `capture()`, `cancel()`, and advanced P24 features (BLIK codes, OneClick tokenization, installments, marketplace split payments) that have no representation in the current adapter contract.

---

## 1. Adapter Method Compatibility

### Full Compatibility

| Adapter Method | P24 Mapping | Notes |
|----------------|-------------|-------|
| `createSession()` | `POST /api/v1/transaction/register` → redirect via token | Clean fit. P24 returns a token; redirect URL is `{baseUrl}/trnRequest/{token}`. Spec already shows this correctly in section 9.3. |
| `verifyWebhook()` | Parse notification + `PUT /api/v1/transaction/verify` | **Good fit but unique**: P24 is the only provider requiring an outbound HTTP call (verify) inside `verifyWebhook()`. This is correctly noted in the spec. Signature uses SHA384. |
| `mapStatus()` | `verified` → `captured`, `error` → `failed`, `pending` → `pending` | Very simple mapping. P24 has only ~3 terminal statuses vs Stripe's 10+. |
| `getStatus()` | `GET /api/v1/transaction/by/sessionId/{sessionId}` | Available in P24 REST API. Returns transaction status for polling fallback. |

### Partial Compatibility (Requires No-Op or Workaround)

| Adapter Method | Issue | Recommendation |
|----------------|-------|----------------|
| `capture()` | **P24 has no authorize-then-capture flow.** Payments are settled immediately upon customer bank authentication. There is no "authorized but not captured" state. | Return `{ captured: true, capturedAmount: <original amount>, gatewayStatus: 'verified' }` immediately. The adapter should check if the transaction is already verified and return success without calling any P24 API. This is a **no-op stub**, not an error. |
| `refund()` | **Partially compatible.** P24 supports full and partial refunds via `POST /api/v1/transaction/refund`, but with a **hard 180-day window**. After 180 days, refunds are impossible. The adapter contract has no way to express time-limited refund availability. | Implement normally but add metadata: `{ refundWindowExpiresAt: <180 days from payment> }`. Throw a descriptive error if refund is attempted after window closes. Consider adding `refundDeadline?: Date` to `RefundResult` in the adapter contract (backward-compatible addition). |
| `cancel()` | **P24 transactions cannot be cancelled** once the customer is redirected. There is no void/cancel API. A session that was never completed simply expires. | Return `{ cancelled: false, gatewayStatus: 'not_supported' }` if the transaction is already in progress. If the session hasn't been used (still pending), it will expire naturally. The core status machine already handles `pending → expired`. |

### Not Applicable

| Feature | Status |
|---------|--------|
| `paymentMethodTypes` filter in `createSession()` | P24 hosts its own payment method selector (bank chooser, BLIK tab, card tab). The merchant cannot pre-filter which methods appear via the REST API. This parameter will be **ignored** by the P24 adapter. |
| `captureMethod: 'manual'` setting | Not applicable. P24 always captures immediately. If a merchant configures manual capture for a P24 payment method, the adapter should log a warning and proceed with auto-capture behavior. |

---

## 2. Status Machine Gaps

The SPEC-044 unified status machine defines 10 statuses. P24 only uses 3 of them naturally:

| Unified Status | P24 Usage | Notes |
|----------------|-----------|-------|
| `pending` | Yes | After `register`, before customer completes payment |
| `captured` | Yes | After successful `verify` (P24 calls this "verified") |
| `failed` | Yes | Payment error or bank rejection |
| `expired` | Yes | Session timeout (P24 token has limited validity) |
| `refunded` | Yes | After successful refund |
| `partially_refunded` | Yes | After partial refund |
| `authorized` | **Never** | P24 has no authorization-only state |
| `partially_captured` | **Never** | No partial capture support |
| `cancelled` | **Never** | No cancellation mechanism |
| `unknown` | Fallback | For any unmapped P24 status |

**Impact**: The status machine works correctly — unused statuses simply never occur. No changes needed to the core module. The `authorized → captured` transition path is skipped entirely; P24 goes directly `pending → captured`.

---

## 3. P24 Features NOT Covered by SPEC-044

These are P24 capabilities that have no representation in the current `GatewayAdapter` contract. They represent future enhancement opportunities, not blockers for the initial integration.

### 3.1 BLIK Payments (High Value)

| Aspect | Detail |
|--------|--------|
| **What** | BLIK is Poland's dominant mobile payment — 6-digit code from banking app |
| **Gap** | The adapter contract has no mechanism for "customer enters a code on the merchant site" flow. `createSession()` assumes redirect-based checkout. |
| **Impact** | BLIK still works via P24's hosted payment page (customer picks BLIK after redirect). But the more modern **BLIK Level 0** flow (code entered on merchant site, no redirect) is not possible. |
| **Effort to add** | Would require a new adapter method like `createDirectPayment()` or a `flow: 'redirect' \| 'direct'` option on `createSession()`. Medium contract change. |

### 3.2 OneClick / Tokenization (Medium Value)

| Aspect | Detail |
|--------|--------|
| **What** | P24 CardVault saves card aliases; BLIK aliases enable no-code BLIK payments. |
| **Gap** | The adapter contract has no concept of saved payment instruments, token storage, or returning customer flows. |
| **Impact** | First-time payments work fine. Returning customer UX is suboptimal — they must re-enter details every time. |
| **Effort to add** | Requires new contract surface: `tokenize()`, `chargeToken()`, and a token storage entity. Large contract change, cross-cutting with Stripe's saved cards feature. Should be designed as a separate spec. |

### 3.3 Marketplace / Split Payments (Medium Value)

| Aspect | Detail |
|--------|--------|
| **What** | P24 Marketplace API supports split payments to sub-merchants with configurable commission. |
| **Gap** | `CreateSessionInput` has no fields for split/payout configuration (sub-merchant IDs, commission rates, payout distribution). |
| **Impact** | Single-seller e-commerce works. Multi-vendor marketplace scenarios cannot use P24's native split payment feature. |
| **Effort to add** | Add optional `splits?: Array<{ merchantId: string, amount: number }>` to `CreateSessionInput`. Medium contract change, must be designed to also support Stripe Connect. |

### 3.4 Installments / BNPL (Low-Medium Value)

| Aspect | Detail |
|--------|--------|
| **What** | "Przelewy24 Raty" (installments), PayPo (buy-now-pay-later), Spingo (B2B deferred). |
| **Gap** | No representation of installment plans or BNPL in the adapter contract. These are payment method types that P24 offers on its hosted page. |
| **Impact** | Installments/BNPL work if the customer selects them on P24's hosted page after redirect. The merchant has no control over which installment plans are shown or terms offered. |
| **Effort to add** | Minimal for basic support — these work transparently via redirect. Advanced control (pre-selecting installment terms) would require contract additions. |

### 3.5 Multi-Currency (Low Value for P24)

| Aspect | Detail |
|--------|--------|
| **What** | P24 supports 50+ currencies for card payments. Bank transfers are PLN-only. |
| **Gap** | No gap in the contract — `currencyCode` is already in `CreateSessionInput`. |
| **Impact** | Works correctly. P24 will accept the currency and handle conversion. The merchant should be aware that bank transfer methods will only be available for PLN transactions. |
| **Effort to add** | None — already supported. |

### 3.6 Express Checkout (Ekspres P24) (Low Value)

| Aspect | Detail |
|--------|--------|
| **What** | Streamlined checkout with pre-filled buyer data from P24's database. |
| **Gap** | The adapter contract passes customer data in `createSession()` but has no concept of "let P24 provide customer data back." |
| **Impact** | Standard checkout works. Express checkout (where P24 auto-fills customer info) is not leveraged. |
| **Effort to add** | Would require a callback/enrichment mechanism to push buyer data back from P24 to the order. Low priority. |

---

## 4. Implementation Challenges

### 4.1 Verify-Inside-Webhook (Unique to P24)

P24 is the only provider in SPEC-044 where `verifyWebhook()` must make an **outbound HTTP call** (the verify transaction step). For Stripe/PayU, webhook verification is purely cryptographic (signature check on the request body).

**Risk**: The webhook endpoint is expected to respond quickly (< 5s). If the verify call to P24 is slow or fails, the webhook response could timeout.

**Mitigation**: The spec already enqueues webhooks to a worker queue (section 12.1). Move the verify call to the worker, not the webhook handler. Modify the P24 adapter so that `verifyWebhook()` only validates the notification signature (SHA384), and the actual `PUT /verify` call happens in the worker after dequeuing. This requires adding an optional `postProcess(event)` hook to the adapter contract or handling it within the worker's provider-specific logic.

### 4.2 No Official Node.js SDK

| Provider | Official SDK | Status |
|----------|-------------|--------|
| Stripe | `stripe` npm package | Mature, well-maintained |
| PayU | No official Node SDK | Raw HTTP (same as P24) |
| Przelewy24 | No official Node SDK | Raw HTTP with Basic Auth |

**Impact**: The P24 adapter must use raw `fetch()` calls. This is the same approach used for PayU in the spec. Not a blocker, but increases maintenance burden (manual request construction, error parsing, response type definitions).

**Mitigation**: Create a thin P24 API client class within the adapter module (`lib/p24-client.ts`) that encapsulates authentication, base URL switching (sandbox/production), and typed request/response interfaces.

### 4.3 Signature Computation (SHA384)

P24 uses SHA384 hashes for transaction signing and webhook verification. The signature format is:

```
SHA384(JSON string of {sessionId, merchantId, amount, currency, crc})
```

This is straightforward using Node.js `crypto` module but differs from:
- Stripe: HMAC-SHA256 (handled by SDK)
- PayU: MD5 (simpler but weaker)

**Impact**: Low. Standard crypto operation.

### 4.4 Basic Auth for API Calls

P24 REST API uses HTTP Basic Authentication (`posId:apiKey` base64-encoded). This is simpler than PayU's OAuth2 flow but different from Stripe's Bearer token.

**Impact**: Low. Straightforward implementation.

### 4.5 Amount Handling

P24 expects amounts in **grosz** (1/100 PLN) as integers, same as Stripe's cents model. The adapter contract uses decimal amounts (`number`), so conversion is: `Math.round(amount * 100)`.

**Impact**: None. Same pattern as Stripe/PayU. Already shown correctly in the spec.

---

## 5. What Works Out of the Box

These features require **zero** spec changes or workarounds:

1. **Basic payment flow**: Register → redirect → webhook → verify → captured
2. **Full refunds**: Via `POST /api/v1/transaction/refund`
3. **Partial refunds**: Same endpoint with specific amount
4. **Status polling**: Via `GET /api/v1/transaction/by/sessionId/{sessionId}`
5. **Webhook notifications**: P24 sends POST to configured `urlStatus`
6. **Sandbox/production toggle**: Different base URLs
7. **Multi-tenant isolation**: `organizationId`/`tenantId` in session metadata
8. **Provider settings encryption**: Standard `SalesPaymentMethod.providerSettings`
9. **Integration marketplace registration**: `integration.ts` convention file
10. **UMES extensions**: Gateway status badge, enricher, column injection — all provider-agnostic

---

## 6. Recommended Adapter Contract Changes

These are backward-compatible additions that would improve P24 support without breaking existing providers:

| Change | Type | Benefit | Backward-Compatible |
|--------|------|---------|:---:|
| Add `capabilities` property to `GatewayAdapter` | New field | Allows core to know which features a provider supports (capture, cancel, refund, tokenize). UI can hide "Capture" button for P24. | Yes |
| Add `refundDeadline?: Date` to `RefundResult` | New optional field | P24 can communicate the 180-day refund window | Yes |
| Add `postVerify?(event): Promise<void>` to `GatewayAdapter` | New optional method | P24's verify-after-webhook flow without blocking the webhook handler | Yes |
| Add `supportedCurrencies?: string[]` to provider registration | New optional field | P24 can declare PLN/EUR; UI filters available methods by order currency | Yes |

### Proposed `capabilities` Declaration

```typescript
interface GatewayAdapterCapabilities {
  authorize: boolean        // false for P24
  capture: boolean          // false for P24
  cancel: boolean           // false for P24
  refund: boolean           // true
  partialRefund: boolean    // true
  partialCapture: boolean   // false for P24
  tokenize: boolean         // future: true when OneClick is added
  recurring: boolean        // false for bank transfers, true for cards (P24-specific)
}

interface GatewayAdapter {
  readonly providerKey: string
  readonly capabilities: GatewayAdapterCapabilities
  // ... existing methods
}
```

This allows the core module and UMES widgets to conditionally show/hide actions based on provider capabilities. Without this, the "Capture" and "Cancel" buttons would appear for P24 payments and do nothing useful.

---

## 7. Effort Estimate

| Component | Effort | Notes |
|-----------|--------|-------|
| P24 adapter (core flow) | Small | `createSession`, `verifyWebhook`, `mapStatus`, `getStatus` |
| P24 API client wrapper | Small | `lib/p24-client.ts` — auth, base URL, typed requests |
| No-op stubs for `capture`/`cancel` | Trivial | Return immediate success/not-supported |
| Refund implementation | Small | Single API call with 180-day check |
| Settings schema + Zod validators | Trivial | 5 fields: merchantId, posId, apiKey, crc, sandbox |
| i18n (en + pl) | Trivial | Provider label, error messages, status labels |
| `integration.ts` marketplace file | Trivial | Standard convention file |
| `capabilities` adapter contract addition | Small | Optional — improves UX but not required for launch |
| Integration tests (mocked P24 API) | Small-Medium | 6-8 test cases per the spec's per-provider matrix |
| **Total** | **~2-3 days** | Assuming core `payment_gateways` module exists |

---

## 8. Dependencies and Prerequisites

| Prerequisite | Status | Blocking? |
|--------------|--------|:---------:|
| Core `payment_gateways` module (SPEC-044 §6) | Not built | **Yes** |
| Integration Marketplace foundation (SPEC-045a) | Not built | **Partial** — P24 can work without marketplace, but `integration.ts` and credential storage won't function |
| UMES widget injection (SPEC-041 Phase 1) | Not assessed | No — P24 works via API; UI extensions are optional |
| P24 merchant account (sandbox) | Required | Yes — need `merchantId`, `posId`, `apiKey`, `crc` for testing |
| Public webhook URL for testing | Required | Yes — P24 must reach our server; use ngrok in dev |

---

## 9. Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|:----------:|:------:|------------|
| `capture()` no-op confuses users | Medium | Low | Add `capabilities` to adapter; core hides capture button for P24 |
| 180-day refund window missed | Low | High | Store `refundDeadline` in `GatewayTransaction.gatewayMetadata`; warn in UI |
| P24 verify call fails in webhook flow | Medium | High | Move verify to worker (async); retry with backoff |
| No Node.js SDK — breaking API changes | Low | Medium | Pin P24 API version in client; integration tests catch regressions |
| BLIK Level 0 requested but not supported | Medium | Medium | Document limitation; BLIK works via redirect (standard P24 page) |
| Restricted business categories | Low | Medium | Document in integration marketplace description |
| Polish-market focus limits adoption | Low | Low | Expected — P24 is intentionally a Poland/CEE-focused provider |

---

## 10. Verdict and Recommendations

### Can We Fully Integrate?

**Yes, with caveats.** The core payment flow (register → redirect → verify → refund) maps cleanly to the `GatewayAdapter` contract. Three adapter methods (`capture`, `cancel`, and partially `refund`) need special handling, but these are manageable through no-op stubs and metadata extensions.

### What Will Be Missing at Launch?

1. **BLIK Level 0** (direct code entry without redirect) — requires contract extension
2. **OneClick / tokenization** (saved cards, BLIK aliases) — requires new contract surface
3. **Marketplace split payments** — requires `splits` field in `CreateSessionInput`
4. **Installment plan control** — works transparently but no merchant-side configuration
5. **Capability-aware UI** — capture/cancel buttons will show but be non-functional without `capabilities` addition

### What Will Be Difficult?

1. **Verify-inside-webhook** — unique to P24; needs architectural decision on where the verify call lives
2. **Testing without SDK** — raw HTTP mocking is more fragile than SDK-based tests
3. **Status mapping simplicity** — P24's 3 statuses make debugging harder (less granular than Stripe)

### Priority Recommendations

1. **P0 (Must Have)**: Add `capabilities` property to `GatewayAdapter` contract — prevents broken UI for P24 and any future provider that lacks capture/cancel
2. **P1 (Should Have)**: Move webhook verify to worker, not inline handler — reliability concern
3. **P2 (Nice to Have)**: Add `refundDeadline` to adapter contract — prevents support tickets
4. **P3 (Future)**: BLIK Level 0, OneClick tokenization, marketplace splits — separate specs

---

## Appendix A: P24 REST API Endpoints Used

| Endpoint | Method | Purpose | Adapter Method |
|----------|--------|---------|----------------|
| `/api/v1/transaction/register` | POST | Register new transaction | `createSession()` |
| `/trnRequest/{token}` | GET (redirect) | Customer payment page | `createSession()` return value |
| `/api/v1/transaction/verify` | PUT | Verify completed transaction | `verifyWebhook()` |
| `/api/v1/transaction/by/sessionId/{id}` | GET | Query transaction status | `getStatus()` |
| `/api/v1/transaction/refund` | POST | Refund transaction | `refund()` |

## Appendix B: P24 Payment Methods Available After Redirect

These methods are available on P24's hosted payment page. The merchant does not control which methods appear — P24 decides based on transaction currency and merchant configuration:

- Bank transfers (mBank, PKO, ING, Millennium, Alior, + ~20 more Polish banks)
- BLIK (code-based)
- Card payments (Visa, Mastercard)
- Apple Pay, Google Pay
- Click to Pay
- PayPo (BNPL)
- Przelewy24 Raty (installments)
- Spingo (B2B deferred)
- E-wallets (PayPal, SkyCash)
- Visa Mobile
