# Pre-Implementation Analysis: Pay By Links

## Executive Summary
The current `pay-by-links` implementation is not production-ready from a security perspective. The most serious issue is that password protection can be bypassed on multi-use links by calling the session-creation API directly, and the access-token signing logic also falls back to a hardcoded secret.

The feature is functionally promising, but it is missing key abuse controls, atomicity guarantees, and test coverage around the public flow. Recommendation: block rollout until the critical and high-severity items below are fixed.

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | API route URLs | No contract break found in the current review. | Warning | Keep legacy aliases if public routes are renamed later. |

### Missing BC Section
This review was performed against the current implementation, not against a pending spec. If this feature is formalized in a spec, add a "Migration & Backward Compatibility" section before changing route shapes, widget spot IDs, or stored metadata keys.

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| Threat model | Public endpoints are exposed without a documented abuse model. | Document brute-force, replay, enumeration, and spam scenarios. |
| Operational controls | Rollout will be inconsistent across tenants/environments. | Define secret requirements, rate limits, audit logging, and alerting. |
| Idempotency/concurrency | Duplicate sessions and overuse are likely under retries/races. | Specify locking or idempotency behavior for session creation. |
| Data retention | Public-capture PII may accumulate without policy. | Define retention, deletion, and minimization rules for captured customer data. |
| Integration test coverage | Regressions in the public payment flow will slip through. | Add end-to-end tests for unlock, session creation, password-gated links, and max-use exhaustion. |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Security | Password flow exists, but enforcement is inconsistent across endpoints. | Require the same access check on all protected public APIs. |
| UI/UX | Template field configuration exists in storage but is not fully honored by the public API/UI. | Return field visibility/required metadata and render it consistently. |

## AGENTS.md Compliance

### Violations
| Rule | Location | Fix |
|------|----------|-----|
| Validate public security-sensitive flows with defense in depth, not client-only checks | `api/pay/[token]/session/route.ts` | Enforce password access, terms acceptance, and required fields on the server. |
| Keep changes safe for public endpoints | `lib/payment-links.ts` | Remove the hardcoded fallback signing secret and fail closed when app secrets are missing. |
| Public endpoints should have abuse controls | `api/pay/[token]/unlock/route.ts`, `api/pay/[token]/session/route.ts`, `api/pay/[token]/customer/route.ts` | Add dual rate limiting and audit logging for repeated failures. |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation | Status |
|------|--------|-----------|--------|
| Password bypass on multi-use links | Anyone with the token can create a session without unlocking the link first. | Make `/session` load state through `loadPublicPaymentLinkState()` and reject when `passwordRequired` is true. | OPEN |
| Hardcoded fallback signing secret | If env secrets are missing, access tokens become forgeable across environments. | Require `APP_SECRET` or equivalent at startup and refuse to mint/verify tokens otherwise. | OPEN |
| Server-side consent/field bypass | Attackers can skip required terms and required capture fields by calling `/session` directly. | Read stored capture policy in `/session` and validate `acceptedTerms`, required fields, and custom fields. | OPEN |
| Non-atomic max-uses enforcement | Concurrent requests can exceed `maxUses` and create extra charge attempts. | Use transaction-level locking or atomic update with guard (`use_count < max_uses`) plus idempotency keys. | OPEN |
| No rate limiting on public endpoints | Password brute force, spam submissions, and session flooding are possible. | Apply per-IP and per-token rate limits to unlock, customer capture, and session creation. | OPEN |
| PII is duplicated in plain JSON payloads | Email, phone, company/person names, and consent timestamps are stored in multiple places, increasing GDPR exposure and breach impact. | Minimize stored fields, encrypt sensitive fields at rest, and define retention/deletion workflows. | OPEN |
| Anonymous customer creation before payment success — CRM pollution via email spoofing | Public links could create or link to existing CRM customers using any email, polluting data. | **FIXED**: Added `customerHandlingMode` with 3 modes. Default `no_customer` stores data only in transaction/metadata. `create_new` always creates fresh CRM records. `verify_and_merge` requires email verification before linking to existing customers. | **FIXED** |

### Medium Risks
| Risk | Impact | Mitigation | Status |
|------|--------|-----------|--------|
| Field configuration is dropped from page payload | Public UI falls back to default field rules instead of template rules. | Return `customerCapture.fields` from `GET /pay/[token]` and cover it in tests. | OPEN |
| Arbitrary custom CSS is injected verbatim | Tenants can hide UI, mislead payers, or load third-party tracking resources. | Replace raw CSS with a constrained theming model or sanitize/allowlist CSS properties. | OPEN |
| Access tokens survive password changes until TTL expiry | Rotating a password does not immediately revoke previously unlocked sessions. | Bind tokens to `passwordHash` version or `updatedAt`, or store revocation timestamp. | OPEN |
| No idempotency for session retries | Browser/network retries can create duplicate transactions and duplicate join rows. | Accept an idempotency key and add a unique constraint/dedup strategy for link-session attempts. | OPEN |
| Webhook verification is the status-write trust boundary | If a provider handler accepts forged events, an attacker could drive transaction state changes through the webhook path. | Treat provider signature verification as mandatory, fail closed on missing secrets, and add provider-specific webhook forgery tests. | OPEN |
| payment_gateways module coupling to pay-by-links | Core module had direct references to payment link types, UI tabs, and API fields. | **FIXED**: Removed `payment-links.ts` from payment_gateways, removed `paymentLink` type/tab from page.tsx, removed `paymentLink: null` from API. Payment link enrichment now fully via interceptor. Test moved to pay-by-links package. | **FIXED** |

### Low Risks
| Risk | Impact | Mitigation | Status |
|------|--------|-----------|--------|
| External logo URLs may leak viewer metadata | Merchant-controlled images can act as tracking pixels. | Proxy images or restrict to approved hosts/CDN. | OPEN |
| Link status completion depends on read path for some states | Reporting may lag if status sync is only observed on page load. | Emit status updates from transaction lifecycle events, not only public reads. | OPEN |

## Gap Analysis

### Critical Gaps (Block Implementation)
- Password enforcement is inconsistent: `/pay/[token]/session` bypasses the unlock/access-token gate entirely.
- Signing secret safety is insufficient: token signing falls back to a public hardcoded value.
- Abuse controls are missing: there is no evident rate limiting on unlock/session/customer public routes.
- Session creation is not atomic: `maxUses` checks and increments are vulnerable to races.

### Important Gaps (Should Address)
- Required consent and field validation are only enforced on the customer-capture route, not on session creation.
- ~~Page API does not expose stored `customerCapture.fields`, so the public UI cannot honor template field configuration.~~ (Partially addressed — fields are now passed through but UI rendering needs verification.)
- No idempotency contract exists for repeated session requests.
- ~~Captured PII and customer creation lifecycle are not bounded by retention/minimization rules.~~ (Partially addressed — `no_customer` mode prevents CRM record creation by default.)
- No explicit statement exists that payment status changes are allowed only from authenticated backoffice actions or verified provider webhooks.

### Nice-to-Have Gaps
- Replace freeform CSS branding with safer theme tokens.
- Add operator-facing metrics for unlock failures, session creation failures, and suspicious token activity.

## Remediation Plan

### Before Implementation (Must Do)
1. Fix password bypass: route all protected public actions through a shared access-check helper and require valid access tokens.
2. Remove fallback secret: fail startup or feature initialization when the signing secret is not configured.
3. Add rate limiting: use the shared rate-limit helpers for unlock, customer capture, and session creation.
4. Make session creation atomic: combine eligibility check and `useCount` increment in a transaction/lock and add idempotency.

### During Implementation (Add to Spec)
1. Define the exact public threat model and abuse controls for pay-by-link endpoints.
2. Specify consent enforcement semantics for single-use and multi-use links.
3. ~~Define how CRM records are created, when they are created, and how they are cleaned up if payment never completes.~~ **DONE**: `customerHandlingMode` added with 3 modes (`no_customer`, `create_new`, `verify_and_merge`). Default `no_customer` prevents CRM pollution.
4. Add an explicit test matrix covering password, consent, retries, concurrency, and max-uses exhaustion.

### Post-Implementation (Follow Up)
1. Add monitoring/alerts for repeated unlock failures and abnormal session creation bursts.
2. Review stored PII retention for `gateway_payment_link_transactions.customer_data` and captured customer metadata.
3. Revisit branding extensibility and replace raw CSS with a constrained theming system if possible.
4. Implement full email OTP verification flow for `verify_and_merge` mode (currently returns 428 requiring verification but the actual OTP flow is not yet implemented).

## Changes Applied (2026-03-18)

### Customer Handling Modes
- Added `customerHandlingMode` field to `customerCapture` in metadata, validators, and interceptors
- 3 modes: `no_customer` (default, safest), `create_new` (always create fresh CRM records), `verify_and_merge` (email verification required before linking existing)
- Both single-use (`/customer` route) and multi-use (`/session` route) now respect the mode
- Response includes `customerCreated` boolean and `customerHandlingMode` so the caller knows what happened
- `verify_and_merge` returns HTTP 428 when email matches existing customer (email OTP flow to be implemented)

### Decoupling payment_gateways from pay-by-links
- Deleted `packages/core/src/modules/payment_gateways/lib/payment-links.ts` (dead code, belonged in pay-by-links)
- Removed `paymentLink` type, tab, and UI from `packages/core/.../payment-gateways/page.tsx`
- Removed `paymentLink: null` from `transactions/[id]/route.ts` API response
- Payment link enrichment now happens entirely via the `transactionDetailInterceptor` in pay-by-links
- Moved payment-link integration test from `TC-PGWY-012` (core) to `TC-PLP-001` (pay-by-links)

## Recommendation
Needs major revision before rollout. The feature should not be considered secure until password enforcement, secret handling, rate limiting, consent validation, and concurrency/idempotency are addressed and covered by integration tests. The customer data handling security issue has been addressed with the `customerHandlingMode` system.
