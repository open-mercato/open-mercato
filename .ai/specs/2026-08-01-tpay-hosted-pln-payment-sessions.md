# Tpay Hosted PLN Payment Sessions

- **Status:** planned
- **Date:** 2026-08-01
- **Type:** OSS payment-provider foundation
- **Provider package:** `@open-mercato/gateway-tpay` (`gateway_tpay`)
- **Hub:** `payment_gateways`
- **Consumer:** `.ai/specs/2026-07-26-tpay-full-integration.md`

## TLDR

Add a standalone Tpay provider package that creates PLN hosted-payment sessions, redirects the payer to Tpay, and reads provider status through the existing `GatewayAdapter`. It includes standard package wiring, encrypted credentials, explicit callback URL configuration, health, status mapping, translations, presets, and CLI setup. Payment can complete through the existing return-page status read; authoritative notifications are a separate follow-up capability.

## Overview

An internal proof of concept completed a real Tpay sandbox payment using a hosted redirect. This specification turns that vertical slice into an upstreamable provider foundation following `packages/gateway-stripe` for layout and registration while retaining Tpay's OAuth and hosted transaction API.

The capability is intentionally narrow: PLN only, one redirect renderer, and no dynamic channel UI, direct BLIK, cards, wallets, refunds, EUR, notification verification, scheduled reconciliation, or storefront code.

## Problem Statement

Open Mercato needs a typed, tenant-scoped Tpay adapter before notification or reconciliation consumers can exist. The proof-of-concept behavior must be specified as production code with:

- normal workspace/package/auto-discovery wiring;
- encrypted tenant credentials and safe preset/CLI reruns;
- bounded OAuth and transaction HTTP calls;
- deterministic local session correlation;
- PLN enforcement and explicit provider-status mapping;
- an explicit, validated notification callback configuration for later notification settlement;
- provider health, translations, tests, rollout, and rollback.

## Proposed Solution

Create `packages/gateway-tpay` with module ID `gateway_tpay` and provider key `tpay`. Register a `GatewayAdapter` versioned under `lib/adapters/v1.ts`, one hosted redirect descriptor, integration credentials, and health checks.

| Decision | Rationale |
| --- | --- |
| Hosted redirect only | It is proven against sandbox and needs no provider-specific embedded UI. |
| PLN only | EUR needs a dedicated POS/credential design and is independently deployable. |
| Existing `GatewayAdapter` | Session, status, lifecycle, and return-page behavior remain canonical. |
| `hiddenDescription = paymentId` | A later signed notification can correlate to the stored payment without exposing scope. |
| Explicit callback source only | Request-origin/Host fallback would turn attacker-controlled routing data into provider configuration. |
| Standard integration package wiring | Credentials, ACL, health, CLI, presets, and descriptors match the established Stripe reference. |

## Architecture

```text
existing payment session route/service
  -> gateway_tpay GatewayAdapter.createSession
  -> bounded OAuth token request
  -> Tpay POST /transactions
  -> store provider session ID + hosted redirect URL
  -> existing redirect renderer
  -> existing getPaymentStatus on payer return
  -> gateway_tpay GET /transactions/{id}
  -> canonical payment status transition/event
```

Package responsibilities:

| Component | Responsibility |
| --- | --- |
| `integration.ts` | Credential fields, callback help, integration metadata. |
| `di.ts` | Adapter, redirect descriptor, and health registrations. |
| `lib/adapters/v1.ts` | `createSession`, `getStatus`, explicit unsupported operation behavior, status mapping. |
| `lib/tpay-client.ts` | OAuth and transaction HTTP calls with sandbox/production base URLs and bounds. |
| `lib/status-map.ts` | Explicit provider status to unified status map. |
| `health.ts` | Credential, callback URL, OAuth, and provider reachability checks. |
| `preset.ts`, `cli.ts`, `setup.ts`, `acl.ts`, i18n | Standard provider configuration and discovery. |

The package does not import core entities, create a public route, register a queue worker, or include app/storefront code.

### Session creation

- Accept only `currencyCode = 'PLN'`; reject before any provider request otherwise.
- Use the canonical decimal amount from the existing service contract and serialize it according to Tpay's API without binary-float rounding.
- Set `hiddenDescription` to the Open Mercato `paymentId`, never an organization or tenant ID.
- Use the existing stable operation/idempotency input so a local retry does not create a second stored session. If Tpay exposes no provider-native idempotency key, document the residual create-before-commit window and recover by provider correlation/status lookup rather than silently duplicating effects.
- Return `transactionPaymentUrl` through the existing redirect client session and store the Tpay transaction ID as `providerSessionId`.
- Keep token, connect, read, and response-size limits bounded; never log OAuth tokens or credentials.

### Callback URL configuration

Session creation may send `callbacks.notification.url` for the later notification capability:

- resolve only from the per-tenant `notificationUrl` credential or `OM_INTEGRATION_TPAY_NOTIFICATION_URL` preset;
- never fall back to request origin or Host;
- require HTTPS, no user info/query/fragment, and port 443 in production;
- explicitly enabled sandbox development may use Tpay-supported ports 80, 8080, or 443;
- fail health/session creation when configured but invalid;
- permit an operator to omit it only when the Merchant Panel already owns the final, non-redirecting URL.

## Data Models

No schema change is required.

| Existing field | Use |
| --- | --- |
| `GatewayTransaction.paymentId` | Sent as Tpay `hiddenDescription`. |
| `GatewayTransaction.providerSessionId` | Stores the Tpay transaction identifier. |
| `GatewayTransaction.amount` / `currencyCode` | Authoritative expected PLN amount. |
| `GatewayTransaction.redirectUrl` | Stores the hosted payment URL. |
| `GatewayTransaction.gatewayMetadata` | Stores bounded non-secret provider status details. |

Existing integration credential services encrypt `clientId`, `clientSecret`, `notificationSecurityCode`, and `notificationUrl` where configured as secret/sensitive fields. No payer email, token, raw response, or credential value is added to metadata or logs.

## API Contracts

No new public route is added. The stable session/status API and `GatewayAdapter` contracts are reused.

### `createSession`

- Input: existing `CreateSessionInput`, PLN only, tenant/organization scope and encrypted credentials supplied by the canonical service.
- Provider request: OAuth followed by Tpay `POST /transactions` with amount, description, payer data required by the existing flow, `hiddenDescription = paymentId`, return URLs, and validated callback URL when configured.
- Output: existing `CreateSessionResult` with provider session ID, `pending`, redirect URL, redirect client session, and bounded provider metadata.

### `getStatus`

- Input: stored provider session ID and tenant credentials.
- Provider request: Tpay `GET /transactions/{id}`.
- Output: existing `GatewayPaymentStatus` with explicit unified status, amount received, currency, and bounded provider data.

Unsupported capture/refund/cancel operations return explicit capability errors; they do not simulate success.

## Internationalization

All provider labels, credential/callback help, validation errors, health messages, and visible status text use `gateway_tpay` locale keys. English, Polish, German, and Spanish catalogs ship together and pass sync/usage checks. Internal-only errors use `[internal]`.

## UI/UX

Reuse the existing integration credential form, hosted redirect renderer, payment page, transaction detail, and payment status UI. No new UI primitive or provider-specific payment form is added.

The implementation PR requires manual payment-path QA because it adds a payer-visible redirect. This docs/spec PR remains `skip-qa`.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Non-PLN session | Reject before OAuth/provider calls. |
| Callback URL uses Host fallback, redirect, query, user info, or unsafe production port | Reject configuration; never advertise it to Tpay. |
| OAuth expires | Refresh once through the bounded client; do not log token material. |
| Provider create succeeds before local commit fails | Re-entry uses local operation identity/provider correlation; surface unresolved ambiguity for operator action. |
| Provider omits transaction ID or redirect URL | Fail creation; do not persist a usable session. |
| Unknown provider status | Map to `unknown`, log bounded status, never guess captured. |
| Payer never returns | Transaction can remain pending until the separately specified notification/reconciliation capabilities run. |
| Refund/cancel/capture is requested | Return explicit unsupported behavior; no fake state transition. |

## Rollout and Operations

1. Land the provider package disabled by default.
2. Configure sandbox credentials and callback/Merchant Panel URL.
3. Complete hosted redirect and return-page status capture in sandbox.
4. Enable one tenant and observe OAuth/session/status metrics before broader rollout.

Rollback disables new Tpay sessions while retaining the adapter for in-flight status reads. No migration rollback is required.

Metrics cover OAuth/session/status latency and failures, unknown statuses, invalid callback configuration, and unresolved create ambiguity. Alerts exclude payer data and credentials.

## Testing Strategy and Acceptance Criteria

| Surface | Required coverage |
| --- | --- |
| Wiring | Package discovery, adapter/descriptor/integration/health, preset, CLI rerun, setup, ACL, and locales. |
| Session | PLN success, non-PLN rejection, amount serialization, payment correlation, redirect, callback precedence/validation, and no Host fallback. |
| Idempotency | Same operation re-entry does not create a second local/provider session; create-before-commit ambiguity is explicit. |
| HTTP | OAuth refresh, timeout, response limit, malformed/failed provider response, and secret-safe logs. |
| Status | Every documented hosted status maps explicitly; unknown status never maps to success. |
| Tenant scope | Two tenants use independent encrypted credentials and cannot read each other's provider session. |
| Integration E2E | Sandbox hosted payment returns and reaches captured through existing status polling. |

Acceptance requires one sandbox hosted PLN payment to redirect and reach `captured` through the existing return-page status read, with exact payment correlation, no duplicate session on local retry, and no credential/cross-tenant leakage.

## Out of Scope and Follow-up Specifications

- Authoritative notifications: `.ai/specs/2026-07-26-tpay-full-integration.md`.
- Scheduled reconciliation: `.ai/specs/2026-08-01-tpay-status-reconciliation.md`.
- Dynamic channel selection, direct BLIK, aliases/recurring, cards, 3DS, tokenization, wallets.
- Refunds, cancellation workflows, manual capture, EUR/dedicated POS, and storefront productionization.

## Risks & Impact Review

### Duplicate provider session

- **Scenario:** Tpay accepts create but the local transaction commit fails.
- **Severity:** High
- **Affected area:** Payer session and provider operations.
- **Mitigation:** Stable local operation identity, deterministic correlation, explicit ambiguous outcome, and retry tests.
- **Residual risk:** Without provider-native idempotency, operator reconciliation may be required; never create blindly after ambiguity.

### Cross-tenant credentials

- **Scenario:** A status call resolves another tenant's credentials/session.
- **Severity:** Critical
- **Affected area:** Payment data and provider account.
- **Mitigation:** Existing scoped gateway service, encrypted tenant credentials, stored transaction scope, and two-tenant tests.
- **Residual risk:** Misconfigured tenants may intentionally share credentials; local transaction reads remain scoped.

### Callback misconfiguration

- **Scenario:** Unsafe or redirecting callback prevents later notification settlement.
- **Severity:** High
- **Affected area:** Availability of the follow-up capability.
- **Mitigation:** Explicit source, strict validation, health check, Merchant Panel documentation, no Host fallback.
- **Residual risk:** DNS/certificate changes after validation remain operational concerns.

## Migration & Backward Compatibility

- New workspace package, provider key, integration, descriptor, and registrations are additive and disabled by default.
- Existing adapter signatures, routes, events, DI keys, database schema, and UI contracts remain unchanged.
- `hiddenDescription = paymentId` affects only newly created Tpay sessions.
- No schema migration, backfill, or tenant action is required.
- Auto-discovery/generator and CLI/ACL contracts follow established additive conventions and are covered by tests.

## Implementation Plan

1. Scaffold the package from `gateway-stripe` and register integration, DI, descriptor, health, setup, ACL, preset, CLI, and locales.
2. Implement bounded Tpay OAuth/session/status client behavior and PLN-only adapter mapping.
3. Add session correlation, callback validation, explicit unsupported operations, and structured metrics/docs.
4. Add unit/integration coverage and validate one sandbox return-page settlement.
5. Run `yarn generate`, affected package tests/builds, integration tests, all configured validation commands, and payment-path manual QA.

The provider foundation lands in one PR and is useful before notification settlement.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `.ai/skills/om-integration-builder/SKILL.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule | Status | Notes |
| --- | --- | --- |
| One independently deployable capability | Compliant | Hosted PLN session/status provider foundation only. |
| Provider package boundary | Compliant | Standalone workspace package; no core entity import or app code. |
| Tenant/credential safety | Compliant | Canonical scoped service and encrypted integration credentials. |
| Existing contracts | Compliant | Stable adapter/session/status/UI contracts are reused additively. |
| Integration coverage | Compliant | Wiring, two tenants, idempotency, redirect, and sandbox status are gates. |

### Non-Compliant Items

None identified.

### Verdict

Fully compliant — ready for implementation as the Tpay provider foundation.

## Changelog

### 2026-08-01

- Split hosted PLN provider/session/status behavior from authoritative notification settlement.
- Defined package wiring, credentials, callback rules, idempotency, operations, and acceptance evidence.
