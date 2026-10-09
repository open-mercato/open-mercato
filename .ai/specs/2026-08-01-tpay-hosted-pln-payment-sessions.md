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

The package does not import core entities, create a public route, register a queue worker or webhook handler, or include app/storefront code.

The only change outside the package is additive: the checkout submit route (`packages/checkout/src/modules/checkout/api/pay/[slug]/submit/route.ts`) forwards the payer email and full name it already collects as `metadata.customerEmail` and `metadata.customerName`. The `customerEmail` key is shared with the Autopay provider proposal (PR #6047) so both providers read the same convention.

### Credentials and environments

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `clientId` | `text` | yes | Tpay Open API client ID. |
| `clientSecret` | `secret` | yes | Tpay Open API client secret. |
| `environment` | `select` (`sandbox`, `production`) | yes, default `sandbox` | Selects a fixed base URL; never a free-form URL. |
| `notificationUrl` | `text` | no | See Callback URL configuration. |
| `notificationSecurityCode` | `secret` | no | Stored now, consumed only by `.ai/specs/2026-07-26-tpay-full-integration.md`. |

The integration credentials service encrypts the whole credential blob; `secret` controls UI masking only. Base URLs are fixed constants: `production` → `https://api.tpay.com`, `sandbox` → `https://openapi.sandbox.tpay.com`. OAuth uses the fixed path `POST /oauth/auth` (`application/x-www-form-urlencoded`, `client_id`, `client_secret`). A `transactionPaymentUrl` whose origin is not a Tpay-owned HTTPS host is rejected.

Env preset keys follow the Stripe pattern: `OM_INTEGRATION_TPAY_CLIENT_ID`, `OM_INTEGRATION_TPAY_CLIENT_SECRET`, `OM_INTEGRATION_TPAY_ENVIRONMENT`, `OM_INTEGRATION_TPAY_NOTIFICATION_URL`, `OM_INTEGRATION_TPAY_NOTIFICATION_SECURITY_CODE`, `OM_INTEGRATION_TPAY_ENABLED`, and `OM_INTEGRATION_TPAY_FORCE_PRECONFIGURE`. Client ID and secret are required together.

### Session creation

- Accept only `currencyCode = 'PLN'`; reject before any provider request otherwise.
- `CreateSessionInput.amount` is a JS `number`; reject non-finite or non-positive values, round half-up to whole grosze via integer arithmetic, and send the 2-decimal value as Tpay's `amount` number.
- Require `metadata.customerEmail` (non-empty, valid email) and `metadata.customerName` (non-empty, trimmed, bounded); reject before any provider request when missing. Payer data is sent to Tpay only and never written to metadata or logs.
- Set `hiddenDescription` to the hub `paymentId` (the checkout transaction ID, or the generated ID from the admin sessions route), never an organization or tenant ID.
- Local re-entry is already guarded by the hub's `GatewaySessionInitialization` claim when `idempotencyKey` is supplied. Tpay exposes no provider-native idempotency key, so the residual create-before-commit window stays documented and is recovered by provider correlation/status lookup rather than silently duplicating effects.
- Return `transactionPaymentUrl` as `redirectUrl` and as `clientSession: { type: 'redirect', redirectUrl }`; store the Tpay `transactionId` as `providerSessionId` and the human-readable `title` in bounded provider data.
- OAuth tokens are not cached in this phase: each operation requests a token (documented lifetime 7200 s), so no cross-tenant token cache exists.
- HTTP calls use a 10 s timeout and a 256 KiB response cap; never log OAuth tokens, credentials, or payer data.

### Status mapping

`GET /transactions/{transactionId}` reports `status` from a closed set:

| Tpay status | Unified status |
| --- | --- |
| `pending` | `pending` |
| `paid` | `captured` |
| `correct` | `captured` |
| `refund` | `refunded` |
| `canceled` | `cancelled` |
| anything else | `unknown` |

`unknown` has no transition in the hub status machine, so it never changes stored state. `amountReceived` comes from `payments.amountPaid` when present, otherwise `0`. `mapStatus` implements the same table.

### Adapter members outside this phase

- `capture`, `refund`, and `cancel` throw `CrudHttpError(422)` with a translated `gateway_tpay.errors.unsupportedOperation` message; they never simulate success.
- `verifyWebhook` throws an `[internal]` unsupported error. No webhook handler is registered until the notification capability lands.

### Callback URL configuration

Session creation may send `callbacks.notification.url` for the later notification capability:

- resolve only from the per-tenant `notificationUrl` credential or `OM_INTEGRATION_TPAY_NOTIFICATION_URL` preset;
- never fall back to request origin or Host;
- require HTTPS, no user info/query/fragment, and port 443 in production;
- with `environment = sandbox`, development may use Tpay-supported ports 80, 8080, or 443;
- fail health/session creation when configured but invalid;
- permit an operator to omit it only when the Merchant Panel already owns the final, non-redirecting URL.

## Data Models

No schema change is required.

| Existing field | Use |
| --- | --- |
| `GatewayTransaction.paymentId` | Hub payment correlation ID (checkout transaction ID or admin-generated ID); sent as Tpay `hiddenDescription`. |
| `GatewayTransaction.providerSessionId` | Stores the Tpay transaction identifier. |
| `GatewayTransaction.amount` / `currencyCode` | Authoritative expected PLN amount. |
| `GatewayTransaction.redirectUrl` | Stores the hosted payment URL. |
| `GatewayTransaction.gatewayMetadata` | Stores bounded non-secret provider status details. |

Existing integration credential services encrypt the whole credential blob, including `clientId`, `clientSecret`, `notificationSecurityCode`, and `notificationUrl`. No payer email, token, raw response, or credential value is added to transaction metadata or logs.

## API Contracts

No new public route is added. The stable session/status API and `GatewayAdapter` contracts are reused.

### `createSession`

- Input: existing `CreateSessionInput`, PLN only, tenant/organization scope and encrypted credentials supplied by the canonical service.
- Provider request: OAuth followed by Tpay `POST /transactions` (JSON):

```json
{
  "amount": 123.45,
  "currency": "PLN",
  "description": "<input.description or bounded fallback>",
  "hiddenDescription": "<paymentId>",
  "lang": "pl",
  "payer": { "email": "<metadata.customerEmail>", "name": "<metadata.customerName>" },
  "callbacks": {
    "payerUrls": { "success": "<successUrl>", "error": "<cancelUrl>" },
    "notification": { "url": "<validated notificationUrl, omitted when not configured>" }
  }
}
```

- `pay`: the published OpenAPI marks it required, while a hosted redirect without a preselected channel needs no channel data. The exact hosted form (omitted, or `{ "method": "pay_by_link" }` without `groupId`/`channelId`) is confirmed in sandbox before merge and pinned by a contract-test fixture.
- `description` is required by Tpay; when `input.description` is absent, use a translated, bounded fallback.
- Output: existing `CreateSessionResult` with provider session ID, `pending`, redirect URL, redirect client session, and bounded provider metadata (`title`, provider `status`).

### `getStatus`

- Input: stored provider session ID and tenant credentials.
- Provider request: Tpay `GET /transactions/{id}`.
- Output: existing `GatewayPaymentStatus` with explicit unified status, amount received, currency, and bounded provider data.

Unsupported capture/refund/cancel operations return explicit `CrudHttpError(422)` capability errors; they do not simulate success.

### Checkout submit route (additive)

`createPaymentSession` metadata gains `customerEmail` and `customerName` (first and last name joined) when the checkout collected them. Existing keys are unchanged, and providers that ignore them are unaffected.

## Internationalization

All provider labels, credential/callback help, validation errors, health messages, and visible status text use `gateway_tpay` locale keys. English, Polish, German, Spanish, and Korean catalogs ship together and pass sync/usage checks, and the auth ACL catalog (`packages/core/src/modules/auth/i18n/*.json`) gains `auth.acl.features.gateway_tpay.*` and `auth.acl.modules.gateway_tpay` in the same five locales. Internal-only errors use `[internal]`.

## UI/UX

Reuse the existing integration credential form, payment page, transaction detail, and payment status UI. The payment descriptor declares `presentation: 'redirect'` with no embedded renderer, so the existing pay page follows `redirectUrl`. No new UI primitive or provider-specific payment form is added.

The implementation PR requires manual payment-path QA because it adds a payer-visible redirect. This docs/spec PR remains `skip-qa`.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Non-PLN session | Reject before OAuth/provider calls. |
| Payer email or name missing (e.g. admin sessions route) | Reject with a translated error before OAuth/provider calls. |
| Hosted URL origin is not a Tpay HTTPS host | Fail creation; never redirect the payer there. |
| Callback URL uses Host fallback, redirect, query, user info, or unsafe production port | Reject configuration; never advertise it to Tpay. |
| OAuth fails or token rejected | Fail the operation with a bounded error; tokens are not cached, so the next operation re-authenticates. Do not log token material. |
| Provider create succeeds before local commit fails | Re-entry uses local operation identity/provider correlation; surface unresolved ambiguity for operator action. |
| Provider omits transaction ID or redirect URL | Fail creation; do not persist a usable session. |
| Unknown provider status | Map to `unknown`, log bounded status, never guess captured. |
| Payer never returns | Transaction can remain pending until the separately specified notification/reconciliation capabilities run. |
| Refund/cancel/capture is requested | Return `CrudHttpError(422)` unsupported behavior; no fake state transition. |

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
| Wiring | Package discovery, adapter/descriptor/integration/health, preset, CLI rerun, setup, ACL dependencies, and locales. |
| Session | PLN success, non-PLN rejection, amount rounding, payer-data requirement, payment correlation, redirect origin check, callback precedence/validation, and no Host fallback. |
| Idempotency | Same operation re-entry does not create a second local/provider session; create-before-commit ambiguity is explicit. |
| HTTP | OAuth failure, timeout, response limit, malformed/failed provider response, fixed base URL per environment, and secret-safe logs. |
| Status | Every documented status (`pending`, `paid`, `correct`, `refund`, `canceled`) maps per the table; unknown status never maps to success. |
| Unsupported members | `capture`/`refund`/`cancel` return 422 errors; `verifyWebhook` throws. |
| Checkout | Submit route forwards `customerEmail`/`customerName` in session metadata. |
| Tenant scope | Two tenants use independent encrypted credentials and cannot read each other's provider session. |
| Integration (CI) | Self-contained API integration test under `.ai/qa/tests/` with the Tpay HTTP layer mocked: configure credentials, create a checkout session, follow redirect URL, read status to `captured`, clean up fixtures. |
| Sandbox acceptance (manual) | Sandbox hosted payment returns and reaches captured through existing status polling; evidence recorded in this spec. |

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
- The checkout submit route only adds optional `metadata` keys (`customerEmail`, `customerName`); no shared type changes.
- `hiddenDescription = paymentId` affects only newly created Tpay sessions.
- No schema migration, backfill, or tenant action is required.
- Auto-discovery/generator and CLI/ACL contracts follow established additive conventions and are covered by tests.

## Implementation Plan

Single phase, one PR:

1. Scaffold `packages/gateway-tpay` from `gateway-stripe` (package version equal to `packages/shared`, no unused `@open-mercato/ui` dependency) and register integration, DI, descriptor, health, setup, ACL, preset, CLI, and five-locale catalogs.
2. Implement the bounded Tpay HTTP client (fixed base URLs, OAuth, `POST /transactions`, `GET /transactions/{id}`) with unit tests.
3. Implement the adapter: PLN/amount/payer validation, callback validation, status mapping, unsupported members, with unit tests.
4. Forward `customerEmail`/`customerName` from the checkout submit route, with a checkout unit test.
5. Repository wiring: `apps/mercato` (`package.json`, `src/modules.ts`, `.env.example`), create-app template (`package.json.template`, `src/modules.ts`, `.env.example`, `scripts/template-sync.ts`, module kept in `TEMPLATE_COMMENTED_MODULES` until sandbox acceptance), `Dockerfile` package manifest copies, `scripts/package-peer-deps-allowlist.json` when needed, auth ACL i18n catalog. Changes to `.github/workflows/package-previews.yml` need maintainer approval.
6. Docs: `apps/docs/docs/user-guide/tpay-payments.mdx` and sidebar entry.
7. Self-contained API integration test with mocked Tpay HTTP; run `yarn generate` and all configured validation commands.
8. Sandbox acceptance and payment-path manual QA before enabling the provider for any tenant.

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

### 2026-10-09

- Applied pre-implementation analysis (`.ai/specs/analysis/ANALYSIS-2026-08-01-tpay-hosted-pln-payment-sessions.md`): payer data via checkout metadata, Tpay request body and status map from the published OpenAPI, credential/environment fields, unsupported adapter members, five locales, CI-runnable integration test, and repository wiring steps.

### 2026-08-01

- Split hosted PLN provider/session/status behavior from authoritative notification settlement.
- Defined package wiring, credentials, callback rules, idempotency, operations, and acceptance evidence.
