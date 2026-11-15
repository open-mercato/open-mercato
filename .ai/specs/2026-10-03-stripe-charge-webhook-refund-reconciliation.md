# Stripe Charge Webhooks and Refund Reconciliation

- **Status:** implemented in PR #6854
- **Date:** 2026-10-03
- **Type:** OSS bug fix with an additive shared-contract change
- **Hub:** `payment_gateways` (core), provider `gateway_stripe`
- **Updates:** `.ai/specs/implemented/SPEC-044-2026-02-24-payment-gateway-integrations.md` (§ GatewayAdapter), `.ai/specs/implemented/SPEC-045h-stripe-payment-gateway.md` (§ status map, webhook handling)

## TLDR

Stripe `charge.*` webhooks were answered with `401` because the transaction was looked up by the Charge, Refund or Dispute id instead of the PaymentIntent it references. The lookup now prefers `data.object.payment_intent`. Since those events now reach the processor, a `charge.refunded` is resolved from the Charge payload and the API version Stripe rendered it with, so a partial refund is not recorded as a full one and the uncaptured remainder of a pre-Basil partial capture is not a refund. A refund that overtakes the capture webhook passes the transaction through `captured` instead of being dropped. `GatewayAdapter.mapStatus` receives the verified event as an optional third argument, and `WebhookEvent` gains an optional `apiVersion`.

## Problem Statement

1. Every Stripe adapter stores the PaymentIntent id as `provider_session_id`. `readStripeSessionIdHint` returned `data.object.id` first, so for Charge, Refund and Dispute objects the route found no candidate and failed closed with `401`. Dashboard refunds never reached Open Mercato.
2. Once routed, `charge.refunded` mapped to `refunded` unconditionally. Stripe sends it for partial refunds too, and `refunded` is terminal.
3. Stripe API versions before `2025-03-31.basil` record the uncaptured remainder of a partial capture as a Refund: it is counted in `amount_refunded` and announces itself with `charge.refunded`. From Basil on, no Refund is created, `amount_refunded` is not updated, and no `charge.refunded` is sent ([Stripe changelog](https://docs.stripe.com/changelog/basil/2025-03-31/remove-refund-from-partial-capture-and-payment-cancellation-flow)). Webhook payloads use the webhook endpoint's API version, exposed as the Event's `api_version`. The client version an adapter pins does not decide it.
4. Stripe does not guarantee event ordering. A `charge.refunded` can arrive while the transaction is still `pending` or `authorized`, because `payment_intent.succeeded` is delayed or retried. The state machine refuses `pending|authorized → refunded|partially_refunded`. The refund was then acknowledged (`202`, idempotency claim kept) and lost: the late capture moved the transaction to `captured` for good.

## Design

### Shared contract (`@open-mercato/shared/modules/payment_gateways/types`)

```typescript
interface WebhookEvent {
  eventType: string
  eventId: string
  data: Record<string, unknown>
  idempotencyKey: string
  timestamp: Date
  /** Provider API version the payload was rendered with, when the provider reports one */
  apiVersion?: string
}

interface GatewayAdapter {
  // ...
  mapStatus(providerStatus: string, eventType?: string, event?: WebhookEvent): UnifiedPaymentStatus
}
```

- The core inline webhook processor calls `adapter.mapStatus(event.data.status, event.eventType, event)`.
- An adapter must return `refunded` / `partially_refunded` for an event only when the provider confirms that captured funds were refunded. Webhook sync treats such a status as proof of capture (below).

### Refund implies capture (`payment_gateways` core)

`resolveImpliedCaptureStatus(from, to)` (`lib/status-machine.ts`) returns `captured` when `to` is a refund status, `from → to` is not a valid transition, and `from → captured → to` is. In practice that means `from` is `pending` or `authorized`. `PaymentGatewayService.syncTransactionStatus` then:

- sets the refund status and aligns `capturedAmount` with `captured` (the authorized amount, as `payment_intent.succeeded` already does);
- emits `payment_gateways.payment.captured` (`previousStatus` = the original status), then `payment_gateways.payment.refunded` (`previousStatus: 'captured'`) when the result is `refunded`; `partially_refunded` has no event, as before. These are the events the in-order sequence would have emitted;
- logs `impliedStatus: 'captured'` on the transaction log line.

`syncTransactionStatus` loads the transaction with `LockMode.PESSIMISTIC_WRITE` inside `em.fork().transactional(...)` and emits events after commit. Concurrent webhooks for one transaction (Stripe delivers in parallel; the async worker runs 5 jobs at a time) are therefore decided one after another on the committed state (manual capture/refund/cancel operations keep their existing unlocked completion read); without it, two deliveries that both read `pending`/`captured` could overwrite each other (a capture overwriting the refund, a partial refund overwriting `refunded`).

The late capture event is then refused by the state machine (`refunded` is terminal and `partially_refunded → captured` is not a transition). Terminal statuses (`cancelled`, `failed`, `expired`, `refunded`) never bridge. `getPaymentStatus` (the poller) is unchanged.

Rejected alternative: failing the delivery so it is retried later. That works only for inline processing, where Stripe retries non-2xx responses for days. With `QUEUE_STRATEGY=async` the route has already answered `202`, and the queue gives up after 3 attempts within seconds, so the refund would still be lost.

### Stripe status resolution (`gateway_stripe/lib/status-map.ts`)

`resolveStripeWebhookStatus(eventType, data, apiVersion?)`:

| Event | Result |
|---|---|
| `payment_intent.*` | event-type table, then PaymentIntent `status` (unchanged) |
| `charge.refunded`, `captured: false` or `amount_captured <= 0` | `unknown` (released authorization) |
| `charge.refunded`, `refunded: true` | `refunded` |
| `charge.refunded`, otherwise | refunded-of-captured = `amount_refunded` − uncaptured remainder (only when the version counts it); `<= 0` → `unknown`; `< captured` → `partially_refunded`; else `refunded` |
| anything else (`charge.refund.updated`, disputes, …) | `unknown` (recorded, no transition) |

"Fully refunded" is measured against the captured amount, as `resolveStripeRefundStatus` already does for refunds started from Open Mercato. After a partial capture the amounts decide first: `amount_refunded > captured` is only possible when the remainder is counted (pre-Basil), `amount_refunded < uncaptured` only when it is not (Basil), and amounts fitting neither give `unknown`. Only when both readings fit (`uncaptured <= amount_refunded <= captured`) does `api_version` decide (older than `2025-03-31` → remainder counted); without a readable version the result is `unknown`, so no refund is recorded unless the payload proves it. `verifyStripeWebhook` copies `event.api_version` into `WebhookEvent.apiVersion`. The Stripe queue worker passes it to the resolver.

Worked example (authorized 1000, captured 600):

| `api_version` | `amount_refunded` | real refund | result |
|---|---|---|---|
| `2025-02-24.acacia` | 400 | 0 (remainder only) | `unknown` |
| `2025-02-24.acacia` | 700 | 300 | `partially_refunded` |
| `2025-02-24.acacia` | 1000 (`refunded: true`) | 600 | `refunded` |
| `2025-03-31.basil` | 300 | 300 | `partially_refunded` |
| `2025-03-31.basil` | 400 | 400 | `partially_refunded` |
| `2025-03-31.basil` | 600 | 600 | `refunded` |
| any | 700 | 300 (remainder counted) | `partially_refunded` |
| none | 300 | 300 | `partially_refunded` |
| none | 400 or 600 | ambiguous | `unknown` |

## Migration & Backward Compatibility

- `GatewayAdapter.mapStatus` gains an optional third parameter. That is additive: adapters declaring one or two parameters compile and behave as before, and the core processor still passes the first two arguments unchanged. No released version shipped the earlier draft signature of this PR (`eventData?: Record<string, unknown>`).
- `WebhookEvent.apiVersion` is optional. Existing providers that do not set it are unaffected.
- `syncTransactionStatus` behaviour change, for every provider: a refund status that used to be ignored on a `pending`/`authorized` transaction now records the capture and then the refund, and emits `payment_gateways.payment.captured`. An adapter that reported a voided authorization as `refunded` would now record a capture; per the contract above such an adapter must return `cancelled` instead. The bundled adapters (Stripe, mock) comply.
- Event IDs, API routes, DB schema, DI names and ACL features are unchanged. Documented in `UPGRADE_NOTES.md`.

## Integration Coverage

- `packages/gateway-stripe/src/modules/gateway_stripe/__integration__/TC-STRIPE-001.spec.ts` (Playwright, real app and Postgres): signed events → `/api/payment_gateways/webhook/stripe` → persisted `gateway_transactions` / `gateway_webhook_events`. Covers partial → full refund, duplicate and stale delivery, refund before capture plus the late `payment_intent.succeeded`, pre-Basil and Basil partial captures, concurrent deliveries (15 transactions receiving a partial and a full refund at once — the reviewed head lost the full refund on roughly a quarter of such pairs — and refund + capture) and two organizations holding a transaction for the same PaymentIntent with their own secrets (each secret changes only its own organization's row; a forged secret → `401`, nothing changes).
- `gateway_stripe/__tests__/webhook-refund-ordering.test.ts` (Jest): the same sequences through the real route, the real `createPaymentGatewayService` and state machine (in-memory store, not Postgres), for both the inline core processor and the async Stripe worker, plus failure → claim released → redelivery applied. The async worker and the failure path are covered only here.
- Unit: `status-map.test.ts` (version-grounded fixtures), `webhook-route.stripe-events.test.ts`, `payment_gateways/lib/__tests__/{gateway-service,status-machine,webhook-processor}.test.ts`.

## Risks

- Unverified premise: Stripe's changelog says what changes from Basil on, but not whether the remainder Refund depends on the API version of the capture request or the version the webhook is rendered with. The bundled adapters capture with pre-Basil versions. If an endpoint on Basil or later still receives a `charge.refunded` for an Open Mercato partial capture's remainder, and that remainder is no larger than the captured amount, the tie-break reads it as a refund (`partially_refunded`, not terminal). Amounts that are only possible with the remainder counted are always read correctly, so a wrong terminal `refunded` cannot come from this. A Stripe test-mode fixture for that combination would settle it; none could be captured without a Stripe account.

- A dashboard partial capture whose capture webhook is late is bridged through `captured` with `capturedAmount` = authorized amount. That is the same value `payment_intent.succeeded` already records for dashboard captures; the final refund status is still computed against the Charge's captured amount.
- Disputes and refund updates remain status-neutral, as before this change (they were never delivered).

## Changelog

| Date | Change |
|------|--------|
| 2026-10-03 | Initial spec, written with the review fixes for PR #6854: API-version-aware partial-capture refunds, refund-implies-capture reconciliation, `mapStatus(…, event?)`, `WebhookEvent.apiVersion`, integration coverage. |
