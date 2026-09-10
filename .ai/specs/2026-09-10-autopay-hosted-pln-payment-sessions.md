# Autopay Hosted PLN Payment Sessions

- **Status:** planned
- **Date:** 2026-09-10 (revised same day after reviewing the official Autopay Online v1.1 documentation: https://developers.autopay.pl/online/dokumentacja-v1-1)
- **Type:** OSS payment-provider foundation
- **Provider package:** `@open-mercato/gateway-autopay` (`gateway_autopay`)
- **Hub:** `payment_gateways`
- **Provider key:** `autopay`
- **Sandbox-only:** no production credentials exist yet; all worked examples in this
  spec use Autopay's own publicly documented test values (`ServiceID = 2`,
  shared key `2test2`, host `testpay.autopay.eu`).

## TLDR

Add a standalone Autopay provider package that creates PLN hosted-payment
sessions by building a locally signed redirect form (no outbound API call
required to start a session — unlike Stripe or Tpay), reads status back via
Autopay's `transactionStatus` API, and supports cancelling an unpaid session
and refunding a settled one. This spec follows `packages/gateway-stripe` for
package layout/registration and mirrors the phasing decision already used for
Tpay (`.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md`): session
creation and status/cancel/refund first, authoritative push notification
(ITN) handling as a separate follow-up spec.

All API contracts below (endpoints, hash field orders, response shapes) are
transcribed from the official documentation, not assumed. The one item still
flagged as a genuine open risk is the ITN response-contract mismatch with the
existing generic webhook route — see "Why ITN Is Out of Scope."

## Overview

Autopay Online v1.1 is a Polish hosted-redirect PSP. Unlike Stripe (SDK,
bearer API keys) or the planned Tpay adapter (OAuth token + REST), every
Autopay request/response is authenticated with a **plain hash, not HMAC**:

```
Hash = SHA256(field1 + "|" + field2 + ... + "|" + sharedKey)
```

Confirmed verbatim from the documentation, § "Bezpieczeństwo transakcji":

> "Jako funkcja skrótu wykorzystywany jest algorytm SHA256 lub SHA512 (metoda
> ustalana na etapie konfigurowania danego Serwisu Partnera w Systemie
> płatności online). Domyślna funkcja to SHA256."
>
> "Sklejane są wartości pól, bez nazw parametrów, a pomiędzy kolejnymi
> (niepustymi) wartościami wstawiany jest separator (w postaci znaku |)...
> W przypadku braku opcjonalnego parametru w komunikacie lub w przypadku
> pustej wartości parametru, nie należy używać separatora!"

I.e.: concatenate only the non-empty field values (in ascending order of
their documented "kolejność Hash" position) with `|`, append the shared key,
hash the result. Never insert a placeholder `|` for a missing optional field.
This is confirmed against three worked examples in the docs and matches the
already-validated reference implementation in
`paytalk/autopay-sandbox/lib/hash.js`.

**Environments** (§ "Adresy środowisk"):

| | `host_bramki` |
| --- | --- |
| Test | `https://testpay.autopay.eu` |
| Production | `https://pay.autopay.eu` |

## Problem Statement

Open Mercato needs a typed, tenant-scoped Autopay adapter that:

- builds a correctly-signed hosted redirect session for PLN payments;
- reads transaction status back through Autopay's own status-query API,
  without depending on push notifications;
- supports cancelling a not-yet-paid session and refunding an already-settled
  one, using the real documented endpoints for each;
- stores tenant credentials (`ServiceID`, shared key) through the existing
  encrypted `IntegrationCredentials` store, never in code or plain config;
- maps Autopay's transaction lifecycle onto `UnifiedPaymentStatus` explicitly,
  never guessing an unknown status into a success state;
- does not attempt authoritative push-notification (ITN) handling in this
  first PR, because the existing generic
  `payment_gateways/api/webhook/[provider]/route.ts` handler always replies
  with a fixed async JSON body (`{ received: true, queued: true }`, HTTP 202)
  — see "Why ITN Is Out of Scope" below — whereas Autopay's ITN requires a
  synchronous, specifically-signed XML reply.

## Confirmed API Surface

All four endpoints below share the same `host_bramki` and the same plain
concatenated-hash scheme; they differ in HTTP method, required headers, and
field list.

| Capability | Method | Endpoint | Notes |
| --- | --- | --- | --- |
| Create session | Browser POST/redirect | `https://{host_bramki}/sciezka` (partner-specific path, issued at onboarding) | No merchant-initiated outbound HTTP call — the merchant builds and hands the browser a signed form. |
| Get status | `POST` (form-urlencoded) | `https://{host_bramki}/webapi/transactionStatus` | Requires header `BmHeader: pay-bm`. Can return multiple transactions for one `OrderID`. |
| Cancel (unpaid only) | `POST` (form-urlencoded) | `https://{host_bramki}/webapi/transactionCancel` | Requires header `BmHeader: pay-bm`. Only affects transactions still in `PENDING`. |
| Refund (settled) | `POST` (form-urlencoded) | `https://{host_bramki}/settlementapi/transactionRefund` | Requires the Partner Service to have a settlement balance ("saldo") enabled (`IS_REFUNDS_ENABLED`) — an account-level prerequisite, not a code gap. Full or partial. |

### Session creation — hash field order

Confirmed table, § "Lista parametrów rozpoczęcia transakcji" (fields this
package implements; the numbering has gaps because unlisted numbers belong to
cart/BLIK/recurring/preauth extensions that are out of scope for this spec —
per the hashing rule, an unpopulated field is simply skipped, never
represented by an empty placeholder):

| # | Field | Required | Notes |
| --- | --- | --- | --- |
| 1 | `ServiceID` | Yes | |
| 2 | `OrderID` | Yes | Must be unique per `ServiceID` for the life of the integration. |
| 3 | `Amount` | Yes | `0.00` format, `.` decimal separator, max 14 integer digits + 2 decimals. |
| 4 | `Description` | No | Prepended with Autopay's own transaction identifiers in the bank statement line. |
| 5 | `GatewayID` | No | Pre-selects a payment channel; full list via the separate `gatewayList` service (not needed for MVP — omit to show Autopay's own channel picker). |
| 6 | `Currency` | No | Defaults to PLN. This package only ever sends PLN. |
| 7 | `CustomerEmail` | **Yes** | Confirmed **required** in the official docs — the reference sandbox implementation in `paytalk/autopay-sandbox` treated it as optional; that assumption is superseded by this spec. |
| 19 | `ValidityTime` | No | Session validity; defaults to 6 days, capped at 31 days. Not sent by this package's MVP (default is acceptable). |
| 34 | `LinkValidityTime` | No | Not sent by this package's MVP. |
| n/a | `Hash` | Yes | Computed over all populated fields above, in ascending numeric order. |

Example worked in the docs (confirmed, reproduced verbatim as a unit-test
fixture): `Hash=SHA256("2|100|1.50|2test2")` for `ServiceID=2, OrderID=100,
Amount=1.50`.

### Return redirect — a *different*, shorter hash

When the payer is redirected back to the Partner's return URL, the query
string hash covers only `ServiceID|OrderID`, **not** `Amount` — confirmed by
the docs' own worked example: `Hash=SHA256("2|100|2test2")`. This is a
distinct formula from the initiation hash and must be verified independently
by the return-page handler; it is **not** proof of payment by itself (the
canonical status is read via `transactionStatus`, not trusted from the
redirect alone).

### `getStatus` — `transactionStatus`

- Request hash: `ServiceID|OrderID|sharedKey` (2 fields, same shape as the
  return-redirect hash — not the 3-field initiation hash).
- Required header: `BmHeader: pay-bm`.
- A single `OrderID` can have multiple underlying Autopay transactions (e.g.
  the payer retried with a different channel). The docs cap this at 50
  transactions per `OrderID`/`ServiceID` pair (HTTP 403 with
  `LIMIT_REQUESTED_TRANSACTIONS_WITH_THE_SAME_ORDER_ID_AND_SERVICE_ID_EXCEEDED`
  beyond that) and give an explicit interpretation table this adapter's
  `getStatus()` must follow:

| Condition | Meaning |
| --- | --- |
| Exactly one transaction with `paymentStatus=SUCCESS` | Paid |
| More than one with `paymentStatus=SUCCESS` | Overpaid (multiple successful attempts) — surface as `captured` plus a flagged anomaly, never silently pick one |
| A `PENDING` exists and no `SUCCESS` | Still pending |
| At least one transaction, only `FAILURE` values | Cancelled/failed |
| No transaction found, or another error | Not found — map to `unknown`, never assume success |

- Response hash covers all fields of all returned transactions, concatenated
  in the same per-transaction field order as ITN (see below), repeated once
  per transaction, still ending in the single shared key.

### `cancel` — `transactionCancel`

- Only cancels a transaction still in `PENDING` (not yet paid). Confirmed:
  "Dla wszystkich serwisów możliwe jest anulowanie rozpoczętej, ale
  nieopłaconej transakcji." A settled (`SUCCESS`) transaction cannot be
  cancelled through this endpoint — that is what `refund` is for.
- Request hash order: `ServiceID|MessageID|RemoteID|OrderID|sharedKey`
  (`MessageID` is a merchant-generated random 32-char idempotency token, not
  an Autopay-issued id; exactly one of `RemoteID`/`OrderID` is required, the
  other omitted from the hash per the empty-field-drop rule).
- Required header: `BmHeader: pay-bm`.
- Response: `CONFIRMED`/`NOTCONFIRMED` plus a `reason` code (e.g.
  `CANCELED_FULLY`).
- Maps to the adapter's `cancel()` — implementable for real, not a stub,
  but only meaningful pre-settlement (same shape as the P24 precedent
  documented in `.ai/specs/analysis/ANALYSIS-044-przelewy24-integration-feasibility.md`).

### `refund` — `transactionRefund`

- Full or partial refund of an **already-settled** transaction. Confirmed:
  "Dla serwisów posiadających saldo w Systemie, możliwe jest wykonanie
  operacji zwrotu do Klienta całości bądź części kwoty." This requires the
  Partner Service to have settlement balance / `IS_REFUNDS_ENABLED` turned on
  — an account-level prerequisite set during onboarding, independent of this
  package's code.
- Request hash order: `ServiceID|MessageID|RemoteID|Amount|Currency|sharedKey`
  (`Amount` omitted = full refund; `Currency` optional, defaults to PLN).
- Refund window: **12 months** from the transaction date; **6 months** for
  BLIK payments specifically. Past that window the request fails with
  `TRANSACTION_TOO_OLD_TO_REFUND`.
- **The synchronous HTTP response only confirms the request was accepted for
  processing — it is not the final settlement outcome.** The documentation is
  explicit: "System przyjmuje zlecenie i asynchronicznie przetwarza je w
  ciągu maksymalnie 30 minut, a w przypadku niepowodzenia informacja o
  operacjach zakończonych błędem jest wysyłana w raporcie następnego dnia
  roboczego" (or via an ISTN with `isRefund=true`, itself a push-notification
  mechanism deferred along with base ITN — see "Why ITN Is Out of Scope").
  This adapter's `refund()` therefore returns a `pending`-shaped
  `RefundResult` from the synchronous call and does **not** claim `refunded`
  until a subsequent `getStatus`/reconciliation confirms it — reconciliation
  beyond the initial accepted-for-processing acknowledgement is out of scope
  for this spec's MVP and should be a fast-follow once ITN (or a polling
  reconciliation job) exists.
- There is also a `transactionRefund/v3` (JSON, richer partial/marketplace
  support) — out of scope; the v1 form-urlencoded endpoint already covers
  full and partial refunds for a single-seller integration.

### `capture`

No generic authorize-then-capture endpoint exists for the base hosted-redirect
flow searched in this spec (confirmed by reviewing the full "Obsługa
transakcji i rozliczeń" section) — Autopay settles immediately on redirect
completion, the same model as Przelewy24. A capture-style hold-then-charge
flow exists only under the separate "Preautoryzacja kartowa" (card
pre-authorization) extension, which is explicitly out of scope for this spec.
`capture()` returns an explicit unsupported-capability error; it never
simulates success.

## Why ITN Is Out of Scope

Confirmed, § "Powiadomienia natychmiastowe (ITN)": Autopay POSTs a
Base64-encoded XML to the Partner's configured notification URL and expects,
**in the same synchronous HTTP session**, an HTTP 200 with an **unencoded**
XML body:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<confirmationList>
  <serviceID>ServiceID</serviceID>
  <transactionsConfirmations>
    <transactionConfirmed>
      <orderID>OrderID</orderID>
      <confirmation>CONFIRMED</confirmation>
    </transactionConfirmed>
  </transactionsConfirmations>
  <hash>Hash</hash>
</confirmationList>
```

The existing `packages/core/src/modules/payment_gateways/api/webhook/[provider]/route.ts`
route always replies with a fixed async JSON body
(`{ received: true, queued: true }`, HTTP 202) and enqueues verification to a
worker — it cannot return a provider-specific, synchronously-computed XML
body. Building ITN support therefore needs either a provider-specific route
or a contract extension to the generic one; that is real design work,
deferred to a follow-up spec, exactly mirroring the split already made for
Tpay (`.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md`, "Out of
Scope: Authoritative notifications").

This does **not** block a usable MVP: `getStatus()` (`transactionStatus`) is
a real, confirmed, pollable API — the payer-return page and any background
reconciliation can call it directly without needing push notifications.

## Proposed Solution

Create `packages/gateway-autopay` with module ID `gateway_autopay` and
provider key `autopay`, scaffolded from `packages/gateway-stripe`'s package
layout but without a vendor SDK (Autopay has none; requests are hand-built
`fetch`/form-post calls).

| Decision | Rationale |
| --- | --- |
| Hosted redirect only, PLN only | Matches the only sandbox-verified flow; EUR/GBP/USD are documented as available but need separate per-service configuration and verification. |
| No outbound HTTP call to create a session | Confirmed: session creation is a locally-built signed form/URL, not a `POST /register` call. |
| Plain concatenated hash, not HMAC | Confirmed by the documentation's own text and worked examples. |
| `getStatus`, `cancel`, `refund` implemented for real (not stubs) | All three have confirmed, documented endpoints. |
| `capture()` returns an explicit unsupported-capability error | Confirmed: no capture endpoint exists outside the out-of-scope card-preauthorization extension. |
| `refund()` returns a `pending`-shaped result, not `refunded`, from the synchronous call | Confirmed: Autopay processes refunds asynchronously (up to ~30 minutes) and reports failures the next business day or via ISTN. |
| ITN/push-notification handling deferred to a follow-up spec | The generic webhook route cannot return Autopay's required synchronous, signed `confirmationList` XML body. `getStatus()` covers the MVP without it. |
| Standard integration package wiring | Credentials, ACL, health, CLI, presets, and descriptors match the established Stripe/Tpay reference pattern. |

## Architecture

```text
existing payment session route/service
  -> gateway_autopay GatewayAdapter.createSession
  -> build signed redirect form/URL locally (no outbound call)
  -> store provider session ID (OrderID) + hosted redirect URL
  -> existing redirect renderer
  -> payer completes payment at testpay.autopay.eu
  -> payer returns; return-redirect hash checked (advisory only)
  -> existing getPaymentStatus on payer return
  -> gateway_autopay GatewayAdapter.getStatus
       -> POST {host}/webapi/transactionStatus (BmHeader: pay-bm)
  -> canonical payment status transition/event

separately, on demand:
  -> gateway_autopay GatewayAdapter.cancel   -> POST {host}/webapi/transactionCancel   (PENDING only)
  -> gateway_autopay GatewayAdapter.refund   -> POST {host}/settlementapi/transactionRefund (SUCCESS only, needs balance enabled)
```

Package responsibilities:

| Component | Responsibility |
| --- | --- |
| `integration.ts` | Credential fields (`serviceId`, `sharedKey`, `hashAlgorithm`), integration metadata. |
| `di.ts` | Adapter and health registrations. |
| `lib/adapters/v1.ts` | `createSession`, `getStatus`, `cancel`, `refund`, explicit unsupported-operation for `capture`, status mapping. |
| `lib/hash.ts` | Field concatenation + hash computation (SHA256 default, SHA512 configurable), ported in spirit (not copied verbatim) from the already-validated reference implementation in `paytalk/autopay-sandbox/lib/hash.js`. |
| `lib/autopay-client.ts` | Builds the signed redirect form/URL; calls `transactionStatus`/`transactionCancel`/`transactionRefund`; sandbox vs. production base URL switch (the actual per-partner redirect *path* is issued at onboarding and must never be hardcoded or guessed — only the `host_bramki` origin is fixed/documented). |
| `lib/status-map.ts` | Explicit provider status → unified status map, including the multi-transaction interpretation table above. |
| `health.ts` | Credential presence/format checks. A live check can safely call `transactionStatus` with a known-absent `OrderID` and expect a "not found" response, without creating any real transaction. |

The package does not import core entities, create a public route, register a
queue worker, or include app/storefront code.

## Data Models

No schema change is required (same as the Tpay spec).

| Existing field | Use |
| --- | --- |
| `GatewayTransaction.paymentId` | Sent as Autopay `OrderID`. |
| `GatewayTransaction.providerSessionId` | Stores the Autopay `OrderID` (Autopay's own transaction id, `remoteID`, is only issued once the payer picks a channel and is captured from the first `getStatus`/ITN response — stored in `gatewayMetadata` once known). |
| `GatewayTransaction.amount` / `currencyCode` | Authoritative expected PLN amount. |
| `GatewayTransaction.redirectUrl` | Stores the locally-built signed hosted payment URL. |
| `GatewayTransaction.gatewayMetadata` | Stores bounded non-secret provider status details, including `remoteID` once known. |

Existing integration credential services encrypt `sharedKey` as a secret
field. `serviceId` is not secret but is tenant-specific. No payer data, raw
response, or credential value is added to metadata or logs.

## API Contracts

No new public route is added. The stable session/status API and
`GatewayAdapter` contracts are reused.

### `createSession`

- Input: existing `CreateSessionInput`, PLN only, tenant/organization scope
  and encrypted credentials supplied by the canonical service.
- No provider HTTP request. Output is a locally-signed redirect form/URL
  built from the confirmed field table above.
- Output: existing `CreateSessionResult` with `sessionId` = generated
  `OrderID`, `pending` status, `redirectUrl` pointing at the sandbox host,
  and bounded provider metadata (echoing the signed field set, minus the
  hash and shared key).

### `getStatus`

- Calls `transactionStatus` as documented above; applies the multi-transaction
  interpretation table; returns the existing `GatewayPaymentStatus` shape.

### `cancel`

- Calls `transactionCancel`; only valid pre-settlement. Returns the existing
  `CancelResult` shape; if the transaction has already settled, surfaces an
  explicit "already settled, use refund" error rather than a false success.

### `refund`

- Calls `transactionRefund`; returns the existing `RefundResult` shape with
  `status: 'pending'` (not `refunded`) to reflect Autopay's asynchronous
  processing, and documents in `providerData` that final confirmation needs a
  follow-up `getStatus` call or the (deferred) ITN/ISTN capability.

### `capture`

- Returns an explicit unsupported-capability error; never simulates success.

## Internationalization

All provider labels, credential help, validation errors, health messages,
and visible status text use `gateway_autopay` locale keys. English and
Polish catalogs ship together at minimum (this provider is Poland-specific)
and pass sync/usage checks. Internal-only errors use `[internal]`.

## UI/UX

Reuse the existing integration credential form and hosted redirect renderer.
No new UI primitive or provider-specific payment form is added.

The implementation PR requires manual payment-path QA in the sandbox because
it adds a payer-visible redirect.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Non-PLN session | Reject before building the signed form. |
| `CustomerEmail` missing | Reject before building the signed form — confirmed required by Autopay, not optional. |
| More than one `SUCCESS` transaction for one `OrderID` | Surface as `captured` plus a flagged anomaly for operator review; never silently pick the first/last one. |
| `getStatus` queried for an `OrderID` with >50 underlying transactions | Map Autopay's `LIMIT_REQUESTED_TRANSACTIONS_WITH_THE_SAME_ORDER_ID_AND_SERVICE_ID_EXCEEDED` (HTTP 403) to `unknown` with a bounded log, never to a guessed status. |
| `cancel` requested on an already-settled transaction | Explicit "already settled, use refund" error; no fake state transition. |
| `refund` requested past the 12-month (6-month for BLIK) window | Propagate `TRANSACTION_TOO_OLD_TO_REFUND` as a typed, user-facing error. |
| `refund` requested but the Partner Service has no settlement balance enabled | Propagate the provider's rejection; document as an onboarding/account prerequisite, not a bug. |
| `capture`/refund-of-refunded/double-refund-over-total requested | Return explicit unsupported/typed-error behavior; no fake state transition. |
| Unknown ITN-shaped `paymentStatus` value (e.g. from the out-of-scope preauth extension: `ON_HOLD`, `CONFIRMED`) | Map to `unknown`, log bounded status, never guess `captured`. Base-flow values are only `PENDING`/`SUCCESS`/`FAILURE`. |
| Payer never returns | Transaction remains `pending`; resolved by a `getStatus` poll (background reconciliation is a reasonable fast-follow, not required for this spec's MVP). |
| Shared key or hash string logged | Must never happen; enforced by code review and a redaction test, mirroring the Stripe/Tpay precedent. |

## Rollout and Operations

1. Land the provider package disabled by default.
2. Configure sandbox credentials (`ServiceID=2`, shared key `2test2`) for
   local/CI verification of the hash math only — these will not authenticate
   against `testpay.autopay.eu` for an actual redirect or API call, per the
   existing `paytalk/autopay-sandbox` README's own findings.
3. Real sandbox credentials, once available from Autopay's partner
   onboarding, are required to complete an actual end-to-end hosted payment
   test, and to obtain the partner-specific redirect path and confirm
   settlement-balance/refund availability. This is the same non-automatable
   prerequisite already identified outside this spec's scope.

Rollback disables new Autopay sessions; no migration rollback is required.

## Testing Strategy and Acceptance Criteria

| Surface | Required coverage |
| --- | --- |
| Wiring | Package discovery, adapter/integration/health, locales. |
| Hash | Unit tests reproducing all of Autopay's own worked-example hashes verbatim: initiation (`2\|100\|1.50\|2test2`), return redirect (`2\|100\|2test2`), ITN (`1\|11\|91\|11.11\|PLN\|1\|20010101111111\|SUCCESS\|AUTHORIZED\|1test1`) — regression guard against silently switching to HMAC, reordering fields, or leaving a placeholder separator for an absent optional field. |
| Session | PLN success, non-PLN rejection, missing-`CustomerEmail` rejection, amount formatting, correct ascending field order, no secret-key leakage into logs or metadata. |
| Status | Mocked `transactionStatus` responses covering every row of the multi-transaction interpretation table (single success, multiple success, pending-only, failure-only, not-found, >50-transaction limit). |
| Cancel | Mocked `transactionCancel`: success on `PENDING`, explicit rejection on an already-settled transaction. |
| Refund | Mocked `transactionRefund`: full refund, partial refund, `TRANSACTION_TOO_OLD_TO_REFUND`, missing-balance rejection — asserting the adapter returns `pending`, never `refunded`, from the synchronous call. |
| Tenant scope | Two tenants use independent encrypted credentials. |
| Integration E2E | Blocked on real sandbox credentials from Autopay partner onboarding (known, pre-existing, non-automatable blocker) — needed for the actual redirect path and a live `transactionStatus` round trip. |

Acceptance for this spec's scope: all hash unit tests pass against the
documented worked examples; `createSession` builds a correctly-signed
redirect for a PLN amount without any outbound HTTP call; `getStatus`,
`cancel`, and `refund` are implemented against mocked HTTP responses covering
every documented outcome; `capture` fails closed with an explicit
unsupported-capability error. Full end-to-end sandbox payment acceptance is
deferred until real sandbox credentials exist.

## Out of Scope and Follow-up Specifications

- Authoritative ITN/ISTN push-notification handling — needs its own spec once
  a synchronous-custom-response mechanism is designed for the generic
  `payment_gateways` webhook route (or a provider-specific route is
  justified). Mirrors the Tpay spec's split of session creation vs.
  notification settlement. Also needed to get final (non-`pending`)
  confirmation of an async refund without polling.
- `transactionRefund/v3` (JSON, marketplace/partial-product-level refunds).
- Card pre-authorization (`Preautoryzacja kartowa`), BLIK 0 OneClick, Google
  Pay widget, WhiteLabel channel pre-selection, recurring/automatic payments,
  "Przedtransakcja" background-initiated sessions, transfers to the Polish
  tax office — all documented Autopay features, all genuinely out of scope
  for this hosted-redirect foundation.
- EUR/GBP/USD currencies.
- Production credentials and rollout — explicitly out of scope per project
  decision; requires manual Autopay partner onboarding.
- Background reconciliation polling / scheduled `getStatus` sweeps for
  abandoned or async-refund transactions.

## Risks & Impact Review

### ITN response-contract mismatch

- **Scenario:** A future PR wires up ITN against the generic webhook route
  without addressing the synchronous-custom-XML-response requirement; Autopay
  retries indefinitely because it never receives a valid `confirmationList`.
- **Severity:** High
- **Affected area:** Any future notification-based capability.
- **Mitigation:** Explicitly deferred in this spec; flagged as needing its
  own design (provider-specific route or generic contract extension) before
  any code is written against it.
- **Residual risk:** None for this spec's scope, since it does not implement
  ITN at all.

### Async refund has no confirmed final state without polling or ITN

- **Scenario:** A refund is accepted synchronously (`pending`) but fails
  during Autopay's asynchronous processing; without ITN or a polling job, the
  merchant never learns about the failure except via the next business day's
  report.
- **Severity:** Medium
- **Affected area:** Finance reconciliation.
- **Mitigation:** `refund()` deliberately returns `pending`, not `refunded`,
  so calling code cannot mistake acceptance for settlement. Follow-up
  reconciliation (polling `getStatus`, or ITN once built) is called out as a
  fast-follow.
- **Residual risk:** Acceptable for a sandbox-scoped MVP; must be resolved
  before any production rollout.

### Overpaid orders from duplicate successful transactions

- **Scenario:** A payer retries a payment after switching channels, and two
  transactions under the same `OrderID` both reach `SUCCESS`.
- **Severity:** Medium
- **Affected area:** Order/payment reconciliation.
- **Mitigation:** `getStatus()`'s interpretation table explicitly surfaces
  this as an anomaly rather than silently returning the first match.
- **Residual risk:** Low — documented Autopay behavior, not a code defect.

### Cross-tenant credentials

- **Scenario:** A session or status/cancel/refund call resolves another
  tenant's credentials.
- **Severity:** Critical
- **Affected area:** Payment data and provider account.
- **Mitigation:** Existing scoped gateway service, encrypted tenant
  credentials, two-tenant tests — same pattern as Stripe/Tpay.
- **Residual risk:** Misconfigured tenants may intentionally share
  credentials; local transaction reads remain scoped.

## Migration & Backward Compatibility

- New workspace package, provider key, integration, and registrations are
  additive and disabled by default.
- Existing adapter signatures, routes, events, DI keys, database schema, and
  UI contracts remain unchanged.
- No schema migration, backfill, or tenant action is required.

## Implementation Plan

1. Scaffold the package from `gateway-stripe`'s layout (without the SDK
   dependency) and register integration, DI, health, and locales.
2. Implement `lib/hash.ts` with unit tests reproducing all three documented
   worked examples (initiation, return redirect, ITN) verbatim.
3. Implement `createSession` for the confirmed field set (`ServiceID`,
   `OrderID`, `Amount`, `Description`, `GatewayID`, `Currency`,
   `CustomerEmail`).
4. Implement `lib/autopay-client.ts` for `transactionStatus`,
   `transactionCancel`, `transactionRefund`, including the `BmHeader`
   header and the multi-transaction interpretation table.
5. Implement `getStatus`, `cancel`, `refund` against mocked HTTP responses
   covering every documented outcome (see Testing Strategy).
6. Implement `capture` as an explicit unsupported-capability error.
7. Add unit/integration coverage; sandbox end-to-end payment test is blocked
   on real Autopay partner sandbox credentials.
8. Run `yarn generate`, affected package tests/builds, and all configured
   validation commands.

## Final Compliance Report — 2026-09-10

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`

### Compliance Matrix

| Rule | Status | Notes |
| --- | --- | --- |
| One independently deployable capability | Compliant | Hosted PLN session/status/cancel/refund provider foundation only; ITN explicitly deferred. |
| Provider package boundary | Compliant | Standalone workspace package; no core entity import or app code. |
| Tenant/credential safety | Compliant | Canonical scoped service and encrypted integration credentials (design-level; not yet implemented). |
| Existing contracts | Compliant | Stable adapter/session/status/UI contracts are reused additively. |
| No invented endpoints/behavior | Compliant | Every endpoint, hash field order, and status value above is transcribed from the official documentation, with verbatim quotes for the load-bearing claims. |

### Non-Compliant Items

None identified.

### Verdict

Ready for implementation. The one remaining architectural question (how ITN
would eventually plug into the generic webhook route) is explicitly deferred
to a follow-up spec and does not block this spec's MVP scope.

## Changelog

### 2026-09-10 (revision)

- Reviewed the full official Autopay Online v1.1 documentation
  (https://developers.autopay.pl/online/dokumentacja-v1-1) and resolved all
  four previously-open verification items:
  - Confirmed `transactionStatus` exists — the earlier "no confirmed
    status-query endpoint" blocker is resolved; the phasing decision
    (session + status now, ITN later) is now known-viable end to end.
  - Confirmed `transactionCancel` (pre-settlement only) and
    `transactionRefund` (post-settlement, async, balance-gated) — `cancel`
    and `refund` are now implemented for real rather than left as stubs.
  - Confirmed the full session-initiation hash field table, including that
    `CustomerEmail` is required (correcting the prior draft's assumption).
  - Confirmed the base-flow ITN/status enum is only `PENDING`/`SUCCESS`/
    `FAILURE`; `ON_HOLD`/`CONFIRMED` belong to the out-of-scope card
    pre-authorization extension.
  - Confirmed the return-redirect hash is a distinct, shorter formula
    (`ServiceID|OrderID`, no `Amount`) from the initiation hash.

### 2026-09-10 (initial draft)

- Initial draft, scoped to sandbox-only hosted PLN session creation, split
  from ITN/notification handling following the Tpay spec precedent.
- Documented the hash scheme (plain concatenation, not HMAC) confirmed
  against Autopay's own worked examples.
- Flagged status-query and refund endpoints, and the full optional-field
  hash order, as unconfirmed.
