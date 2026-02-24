# SPEC-044 — Payment Gateway Integrations (Stripe, PayU, Przelewy24, Apple Pay)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Related** | SPEC-041 (Universal Module Extension System), Sales module, Payment Provider Registry |

## TLDR

Define a **payment gateway integration module** (`payment_gateways`) that connects Open Mercato's existing payment provider registry and `SalesPayment` entity to real payment processors — Stripe, PayU, Przelewy24, and Apple Pay. Uses the existing provider plugin architecture for configuration, UMES (SPEC-041) for UI extensions and API interception, and a gateway adapter pattern for unified webhook/status handling across all providers.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [Existing Infrastructure Assessment](#4-existing-infrastructure-assessment)
5. [Gateway Adapter Contract](#5-gateway-adapter-contract)
6. [Phase 1 — Core Gateway Infrastructure](#6-phase-1--core-gateway-infrastructure)
7. [Phase 2 — Stripe Integration](#7-phase-2--stripe-integration)
8. [Phase 3 — PayU Integration](#8-phase-3--payu-integration)
9. [Phase 4 — Przelewy24 Integration](#9-phase-4--przelewy24-integration)
10. [Phase 5 — Apple Pay (via Stripe/PayU)](#10-phase-5--apple-pay-via-stripepayu)
11. [Payment Status Machine](#11-payment-status-machine)
12. [Webhook Architecture](#12-webhook-architecture)
13. [UMES Integration Points](#13-umes-integration-points)
14. [Data Models](#14-data-models)
15. [API Contracts](#15-api-contracts)
16. [Security & Compliance](#16-security--compliance)
17. [SPEC-041 Improvement Suggestions](#17-spec-041-improvement-suggestions)
18. [Risks & Mitigations](#18-risks--mitigations)
19. [Integration Test Coverage](#19-integration-test-coverage)
20. [Changelog](#20-changelog)

---

## 1. Problem Statement

### Current State

Open Mercato has a well-designed payment foundation:

| Component | Status | Location |
|-----------|--------|----------|
| `SalesPayment` entity | Exists | `sales/data/entities.ts` — fields: `amount`, `capturedAmount`, `refundedAmount`, `paymentReference`, `status`, `metadata` |
| `SalesPaymentMethod` entity | Exists | `sales/data/entities.ts` — fields: `providerKey`, `providerSettings`, `isActive` |
| Payment Provider Registry | Exists | `sales/lib/providers/` — `registerPaymentProvider()`, `getPaymentProvider()` |
| Stripe provider definition | Exists | `sales/lib/providers/defaultProviders.ts` — settings schema (keys, webhook secret, capture method, URLs) |
| Payment commands | Exist | `sales/commands/payments.ts` — create/update/delete with undo, event emission, order total recomputation |
| Payment events | Exist | `sales/events.ts` — `sales.payment.created/updated/deleted` |
| Webhook reference | Exists | `inbox_ops/api/webhook/inbound.ts` — HMAC verification, rate limiting, idempotency |

### What's Missing

1. **No actual gateway communication** — The Stripe provider definition has settings fields but no code that calls the Stripe API. Payments are created manually in the UI.
2. **No webhook processing** — No endpoints to receive payment status callbacks from Stripe, PayU, or Przelewy24.
3. **No payment session/checkout flow** — No way to create a Stripe Checkout Session, PayU order, or P24 transaction and redirect the customer.
4. **No status synchronization** — When a gateway reports "captured" or "refunded", the `SalesPayment` status doesn't update automatically.
5. **No PayU or Przelewy24 support** — Only Stripe is registered as a provider (settings only, no behavior).
6. **No Apple Pay integration** — Apple Pay works through Stripe or PayU as a payment method type, but no configuration for it.

### Goal

Build a `payment_gateways` module that:
- Implements gateway communication for Stripe, PayU, Przelewy24, and Apple Pay
- Handles webhooks with signature verification, idempotency, and retry tolerance
- Synchronizes payment status automatically (gateway → `SalesPayment`)
- Uses UMES to extend the sales UI without modifying sales module code
- Follows the adapter pattern so adding more gateways later is trivial

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Adapter pattern** — Each gateway implements a common interface | Swap/add gateways without changing core code |
| 2 | **Zero sales module modifications** — All gateway logic lives in `payment_gateways` module | UMES makes this possible; keeps sales module clean |
| 3 | **Webhook-first status sync** — Trust the gateway's webhook as source of truth for payment state | Polling is a fallback, not primary |
| 4 | **Idempotent processing** — Every webhook and status transition is safely re-enterable | Gateways retry; we must handle duplicates |
| 5 | **Metadata bridge** — Use `SalesPayment.metadata` for gateway-specific data (transaction IDs, gateway status codes) | Avoids schema changes to the core entity |
| 6 | **Provider registry integration** — Register gateways via the existing `registerPaymentProvider()` system | No new registration mechanisms |
| 7 | **Apple Pay as method, not gateway** — Apple Pay is a payment method type within Stripe/PayU, not a standalone gateway | Simplifies architecture significantly |

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     payment_gateways module                              │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │  Gateway         │  │  Webhook         │  │  Status Sync            │  │
│  │  Adapters        │  │  Handler         │  │  Engine                 │  │
│  │                  │  │                  │  │                         │  │
│  │  • Stripe        │  │  • Signature     │  │  • State machine        │  │
│  │  • PayU          │  │    verification  │  │  • SalesPayment update  │  │
│  │  • Przelewy24    │  │  • Idempotency   │  │  • Event emission       │  │
│  │                  │  │  • Rate limiting │  │  • Order total recomp.  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────────┬────────────┘  │
│           │                     │                          │              │
│  ┌────────┴─────────────────────┴──────────────────────────┴────────────┐ │
│  │                    Gateway Service (DI-resolved)                      │ │
│  │  • createPaymentSession(orderId, provider, options)                   │ │
│  │  • capturePayment(paymentId)                                          │ │
│  │  • refundPayment(paymentId, amount?)                                  │ │
│  │  • cancelPayment(paymentId)                                           │ │
│  │  • syncPaymentStatus(paymentId)                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  UMES Extensions (zero sales module changes)                         │ │
│  │  • Widget: "Pay Now" button on order detail → creates session         │ │
│  │  • Widget: Payment status badge with gateway details                  │ │
│  │  • Enricher: Adds gateway transaction data to payment API responses   │ │
│  │  • Interceptor: Validates payment method has valid gateway config     │ │
│  │  • Subscriber: Listens to sales.payment.created → auto-initiate      │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Existing Infrastructure Assessment

### What We Can Leverage Directly

| Infrastructure | How It's Used | No Changes Needed |
|---------------|---------------|:-:|
| `SalesPayment.metadata` (jsonb) | Store gateway transaction ID, gateway status, session URL, refund IDs | Yes |
| `SalesPayment.paymentReference` | Store gateway's canonical payment/transaction ID | Yes |
| `SalesPayment.status` / `statusEntryId` | Map to unified status machine | Yes |
| `SalesPayment.capturedAmount` / `refundedAmount` | Updated by status sync engine | Yes |
| `SalesPayment.receivedAt` / `capturedAt` | Set when gateway confirms receipt/capture | Yes |
| Payment Provider Registry | Register Stripe/PayU/P24 with settings schemas | Yes |
| Payment Commands (create/update) | Used by status sync to update payment records | Yes |
| Payment Events | `sales.payment.updated` triggers downstream (notifications, workflows) | Yes |
| Webhook pattern from inbox_ops | Reference for signature verification, rate limiting | Yes (template) |
| Worker/Queue system | Async webhook processing, status polling | Yes |
| DI container | Register gateway services | Yes |

### What Requires UMES (SPEC-041)

| Extension | UMES Feature | Phase |
|-----------|-------------|-------|
| "Pay via Gateway" button on order detail | UI Slot Injection (Phase 1) | Existing widget injection |
| Gateway transaction details on payment detail | Response Enricher (Phase 3) | UMES Phase 3 |
| Validate gateway config before payment creation | API Interceptor (Phase 4) | UMES Phase 4 |
| Gateway status column on payments table | Column Injection (Phase 5) | UMES Phase 5 |
| Gateway settings fields on payment method form | Field Injection (Phase 5) | UMES Phase 5 |

### What Requires NO UMES (Works Today)

| Feature | Mechanism |
|---------|-----------|
| Webhook endpoints | Standard API route auto-discovery |
| Gateway service | DI registration |
| Status sync on webhook | Event subscriber + payment commands |
| Background status polling | Worker auto-discovery |
| Gateway-specific events | `createModuleEvents()` |
| ACL for gateway operations | `acl.ts` features |

---

## 5. Gateway Adapter Contract

```typescript
// payment_gateways/lib/adapter.ts

interface GatewayAdapter {
  /** Provider key matching the provider registry (e.g., 'stripe', 'payu', 'przelewy24') */
  readonly providerKey: string

  /**
   * Create a payment session / checkout / transaction on the gateway side.
   * Returns a session ID and redirect URL for customer-facing checkout.
   */
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>

  /**
   * Capture a previously authorized payment.
   * Only applicable for gateways/configs using auth-then-capture flow.
   */
  capture(input: CaptureInput): Promise<CaptureResult>

  /**
   * Refund a captured payment (full or partial).
   */
  refund(input: RefundInput): Promise<RefundResult>

  /**
   * Cancel/void an authorized but not yet captured payment.
   */
  cancel(input: CancelInput): Promise<CancelResult>

  /**
   * Query the gateway for current payment status.
   * Used as fallback when webhooks are delayed or missed.
   */
  getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus>

  /**
   * Verify a webhook signature. Returns parsed event payload or throws.
   */
  verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent>

  /**
   * Map a gateway-specific event/status to the unified payment status.
   */
  mapStatus(gatewayStatus: string, eventType?: string): UnifiedPaymentStatus
}

// --- Input/Output Types ---

interface CreateSessionInput {
  orderId: string
  orderNumber: string
  amount: number
  currencyCode: string
  customerEmail?: string
  customerName?: string
  lineItems: SessionLineItem[]
  /** Provider settings from SalesPaymentMethod.providerSettings */
  settings: Record<string, unknown>
  /** Callback URLs */
  successUrl: string
  cancelUrl: string
  webhookUrl: string
  /** Optional: specific payment method types (e.g., ['apple_pay', 'card']) */
  paymentMethodTypes?: string[]
  /** Tenant/org context for multi-tenant isolation */
  organizationId: string
  tenantId: string
  /** Locale for gateway-hosted checkout pages */
  locale?: string
  /** Additional metadata passed to the gateway */
  metadata?: Record<string, string>
}

interface SessionLineItem {
  name: string
  quantity: number
  unitPrice: number
  currencyCode: string
}

interface CreateSessionResult {
  /** Gateway's session/transaction ID */
  sessionId: string
  /** URL to redirect customer to for payment */
  redirectUrl: string
  /** Gateway's payment intent/order ID (may differ from session ID) */
  gatewayPaymentId?: string
  /** Raw gateway response stored in metadata */
  rawResponse?: Record<string, unknown>
}

interface CaptureInput {
  gatewayPaymentId: string
  amount?: number  // Partial capture amount; omit for full capture
  settings: Record<string, unknown>
}

interface CaptureResult {
  captured: boolean
  capturedAmount: number
  gatewayStatus: string
  rawResponse?: Record<string, unknown>
}

interface RefundInput {
  gatewayPaymentId: string
  amount?: number  // Partial refund; omit for full
  reason?: string
  settings: Record<string, unknown>
}

interface RefundResult {
  refundId: string
  refundedAmount: number
  gatewayStatus: string
  rawResponse?: Record<string, unknown>
}

interface CancelInput {
  gatewayPaymentId: string
  settings: Record<string, unknown>
}

interface CancelResult {
  cancelled: boolean
  gatewayStatus: string
  rawResponse?: Record<string, unknown>
}

interface GetStatusInput {
  gatewayPaymentId: string
  settings: Record<string, unknown>
}

interface GatewayPaymentStatus {
  status: string  // Gateway-native status string
  amount: number
  capturedAmount: number
  refundedAmount: number
  currencyCode: string
  rawResponse?: Record<string, unknown>
}

interface VerifyWebhookInput {
  headers: Record<string, string>
  body: string  // Raw request body
  settings: Record<string, unknown>
}

interface WebhookEvent {
  eventType: string           // Gateway-native event type (e.g., 'payment_intent.succeeded')
  gatewayPaymentId: string    // Gateway's payment/transaction ID
  data: Record<string, unknown>  // Gateway-specific event data
  idempotencyKey: string      // Unique event ID from gateway (for dedup)
}

// --- Unified Status ---

type UnifiedPaymentStatus =
  | 'pending'       // Session created, awaiting customer action
  | 'authorized'    // Customer authorized, not yet captured
  | 'captured'      // Payment captured / settled
  | 'partially_captured' // Partial capture
  | 'refunded'      // Fully refunded
  | 'partially_refunded' // Partial refund
  | 'cancelled'     // Voided / cancelled before capture
  | 'failed'        // Payment failed (declined, error)
  | 'expired'       // Session expired without completion
  | 'unknown'       // Unmapped gateway status (logged, not processed)
```

---

## 6. Phase 1 — Core Gateway Infrastructure

### 6.1 Module Structure

```
packages/core/src/modules/payment_gateways/
├── index.ts                           # Module metadata
├── acl.ts                             # RBAC features
├── di.ts                              # Service registration
├── events.ts                          # Gateway-specific events
├── setup.ts                           # Tenant init, default statuses
├── lib/
│   ├── adapter.ts                     # GatewayAdapter interface
│   ├── adapter-registry.ts            # registerGatewayAdapter(), getAdapter()
│   ├── status-machine.ts              # Unified status transitions
│   ├── status-sync.ts                 # Gateway status → SalesPayment update
│   └── webhook-utils.ts              # Shared webhook verification utilities
├── adapters/
│   ├── stripe.ts                      # Stripe adapter implementation
│   ├── payu.ts                        # PayU adapter implementation
│   └── przelewy24.ts                 # Przelewy24 adapter implementation
├── data/
│   ├── entities.ts                    # GatewayTransaction entity
│   ├── validators.ts                  # Zod schemas
│   └── enrichers.ts                   # Enrich SalesPayment with gateway data
├── api/
│   ├── sessions/route.ts             # POST: create payment session
│   ├── capture/route.ts              # POST: capture authorized payment
│   ├── refund/route.ts               # POST: refund captured payment
│   ├── cancel/route.ts               # POST: cancel/void payment
│   ├── status/route.ts               # GET: query gateway status
│   ├── interceptors.ts               # Validate gateway config on payment creation
│   └── webhook/
│       └── [provider]/route.ts       # Webhook endpoints per provider
├── subscribers/
│   └── payment-status-changed.ts     # React to status changes
├── workers/
│   ├── webhook-processor.ts          # Async webhook processing
│   └── status-poller.ts              # Fallback status polling
├── widgets/
│   ├── injection-table.ts            # UMES slot mappings
│   └── injection/
│       ├── pay-button/               # "Pay via Gateway" button on order detail
│       ├── gateway-status-badge/     # Gateway status on payment list/detail
│       └── gateway-settings/         # Gateway config fields on payment method form
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 6.2 Gateway Transaction Entity

```typescript
// payment_gateways/data/entities.ts

@Entity({ tableName: 'gateway_transactions' })
export class GatewayTransaction extends BaseEntity {
  @Property()
  paymentId!: string  // FK to sales_payments.id (ID only, no ORM relation)

  @Property()
  providerKey!: string  // 'stripe' | 'payu' | 'przelewy24'

  @Property({ nullable: true })
  sessionId?: string  // Gateway session/checkout ID

  @Property({ nullable: true })
  gatewayPaymentId?: string  // Gateway payment intent/order ID

  @Property({ nullable: true })
  gatewayRefundId?: string  // Latest refund ID

  @Property({ length: 50 })
  unifiedStatus!: string  // UnifiedPaymentStatus value

  @Property({ nullable: true, length: 100 })
  gatewayStatus?: string  // Raw gateway status string

  @Property({ nullable: true })
  redirectUrl?: string  // Customer checkout URL

  @Property({ type: 'jsonb', nullable: true })
  gatewayMetadata?: Record<string, unknown>  // Raw gateway responses

  @Property({ type: 'jsonb', nullable: true })
  webhookLog?: WebhookLogEntry[]  // Recent webhook events for debugging

  @Property({ nullable: true })
  lastWebhookAt?: Date

  @Property({ nullable: true })
  lastPolledAt?: Date

  @Property({ nullable: true })
  expiresAt?: Date  // Session expiration

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string
}

interface WebhookLogEntry {
  eventType: string
  receivedAt: string  // ISO timestamp
  idempotencyKey: string
  unifiedStatus: string
  processed: boolean
}
```

### 6.3 Adapter Registry

```typescript
// payment_gateways/lib/adapter-registry.ts

const adapters = new Map<string, GatewayAdapter>()

export function registerGatewayAdapter(adapter: GatewayAdapter): void {
  adapters.set(adapter.providerKey, adapter)
}

export function getGatewayAdapter(providerKey: string): GatewayAdapter | undefined {
  return adapters.get(providerKey)
}

export function listGatewayAdapters(): GatewayAdapter[] {
  return Array.from(adapters.values())
}
```

### 6.4 DI Registration

```typescript
// payment_gateways/di.ts

export function register(container: AppContainer) {
  container.register({
    paymentGatewayService: asFunction(createPaymentGatewayService).singleton().proxy(),
  })
}
```

### 6.5 Events

```typescript
// payment_gateways/events.ts

export const eventsConfig = createModuleEvents('payment_gateways', [
  { id: 'payment_gateways.session.created', label: 'Gateway Session Created', entity: 'session', category: 'lifecycle' },
  { id: 'payment_gateways.session.expired', label: 'Gateway Session Expired', entity: 'session', category: 'lifecycle' },
  { id: 'payment_gateways.payment.authorized', label: 'Gateway Payment Authorized', entity: 'payment', category: 'lifecycle' },
  { id: 'payment_gateways.payment.captured', label: 'Gateway Payment Captured', entity: 'payment', category: 'lifecycle' },
  { id: 'payment_gateways.payment.failed', label: 'Gateway Payment Failed', entity: 'payment', category: 'lifecycle' },
  { id: 'payment_gateways.payment.refunded', label: 'Gateway Payment Refunded', entity: 'payment', category: 'lifecycle' },
  { id: 'payment_gateways.payment.cancelled', label: 'Gateway Payment Cancelled', entity: 'payment', category: 'lifecycle' },
  { id: 'payment_gateways.webhook.received', label: 'Webhook Received', entity: 'webhook', category: 'system' },
  { id: 'payment_gateways.webhook.failed', label: 'Webhook Verification Failed', entity: 'webhook', category: 'system' },
] as const)
```

### 6.6 ACL

```typescript
// payment_gateways/acl.ts

export const features = [
  'payment_gateways.view',
  'payment_gateways.manage',
  'payment_gateways.refund',
  'payment_gateways.capture',
  'payment_gateways.configure',
]
```

---

## 7. Phase 2 — Stripe Integration

### 7.1 Adapter Implementation

```typescript
// payment_gateways/adapters/stripe.ts

import Stripe from 'stripe'

export const stripeAdapter: GatewayAdapter = {
  providerKey: 'stripe',

  async createSession(input) {
    const stripe = new Stripe(input.settings.secretKey as string)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: input.paymentMethodTypes ?? ['card'],
      line_items: input.lineItems.map(item => ({
        price_data: {
          currency: input.currencyCode.toLowerCase(),
          product_data: { name: item.name },
          unit_amount: Math.round(item.unitPrice * 100),
        },
        quantity: item.quantity,
      })),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail,
      metadata: {
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        ...input.metadata,
      },
      payment_intent_data: {
        capture_method: (input.settings.captureMethod as string) === 'manual' ? 'manual' : 'automatic',
      },
    })

    return {
      sessionId: session.id,
      redirectUrl: session.url!,
      gatewayPaymentId: session.payment_intent as string | undefined,
    }
  },

  async capture(input) {
    const stripe = new Stripe(input.settings.secretKey as string)
    const intent = await stripe.paymentIntents.capture(
      input.gatewayPaymentId,
      input.amount ? { amount_to_capture: Math.round(input.amount * 100) } : undefined,
    )
    return {
      captured: intent.status === 'succeeded',
      capturedAmount: intent.amount_received / 100,
      gatewayStatus: intent.status,
    }
  },

  async refund(input) {
    const stripe = new Stripe(input.settings.secretKey as string)
    const refund = await stripe.refunds.create({
      payment_intent: input.gatewayPaymentId,
      amount: input.amount ? Math.round(input.amount * 100) : undefined,
      reason: input.reason as Stripe.RefundCreateParams.Reason | undefined,
    })
    return {
      refundId: refund.id,
      refundedAmount: refund.amount / 100,
      gatewayStatus: refund.status ?? 'succeeded',
    }
  },

  async cancel(input) {
    const stripe = new Stripe(input.settings.secretKey as string)
    const intent = await stripe.paymentIntents.cancel(input.gatewayPaymentId)
    return {
      cancelled: intent.status === 'canceled',
      gatewayStatus: intent.status,
    }
  },

  async getStatus(input) {
    const stripe = new Stripe(input.settings.secretKey as string)
    const intent = await stripe.paymentIntents.retrieve(input.gatewayPaymentId)
    return {
      status: intent.status,
      amount: intent.amount / 100,
      capturedAmount: intent.amount_received / 100,
      refundedAmount: (intent.amount - intent.amount_received) / 100,
      currencyCode: intent.currency.toUpperCase(),
    }
  },

  async verifyWebhook(input) {
    const stripe = new Stripe(input.settings.secretKey as string)
    const event = stripe.webhooks.constructEvent(
      input.body,
      input.headers['stripe-signature']!,
      input.settings.webhookSecret as string,
    )
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    return {
      eventType: event.type,
      gatewayPaymentId: paymentIntent.id,
      data: event.data.object as Record<string, unknown>,
      idempotencyKey: event.id,
    }
  },

  mapStatus(gatewayStatus, eventType) {
    // Map Stripe event types to unified status
    const map: Record<string, UnifiedPaymentStatus> = {
      'payment_intent.succeeded': 'captured',
      'payment_intent.payment_failed': 'failed',
      'payment_intent.canceled': 'cancelled',
      'payment_intent.amount_capturable_updated': 'authorized',
      'payment_intent.requires_action': 'pending',
      'charge.refunded': 'refunded',
      'checkout.session.expired': 'expired',
    }

    if (eventType && map[eventType]) return map[eventType]

    // Fallback: map by PaymentIntent status
    const statusMap: Record<string, UnifiedPaymentStatus> = {
      requires_payment_method: 'pending',
      requires_confirmation: 'pending',
      requires_action: 'pending',
      processing: 'pending',
      requires_capture: 'authorized',
      succeeded: 'captured',
      canceled: 'cancelled',
    }

    return statusMap[gatewayStatus] ?? 'unknown'
  },
}
```

### 7.2 Stripe Provider Registration Update

The existing Stripe provider in `defaultProviders.ts` already declares the correct settings fields. The `payment_gateways` module enhances it at module init:

```typescript
// payment_gateways/setup.ts

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['payment_gateways.*'],
    employee: ['payment_gateways.view'],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    // Register gateway adapters (idempotent)
    registerGatewayAdapter(stripeAdapter)
    registerGatewayAdapter(payuAdapter)
    registerGatewayAdapter(przelewy24Adapter)
  },
}
```

### 7.3 Apple Pay via Stripe

Apple Pay is not a separate gateway — it's a payment method type within Stripe Checkout:

```typescript
// When creating a session with Apple Pay enabled:
await gatewayService.createPaymentSession({
  orderId: order.id,
  providerKey: 'stripe',
  paymentMethodTypes: ['card', 'apple_pay'],
  // ... rest of input
})
```

The Stripe adapter passes `payment_method_types: ['card', 'apple_pay']` to `stripe.checkout.sessions.create()`. Apple Pay appears automatically in the Stripe Checkout UI on supported devices.

**Provider settings extension** for Apple Pay:

```typescript
// Added to Stripe provider settings fields
{ key: 'enableApplePay', label: 'Enable Apple Pay', type: 'boolean' },
{ key: 'applePayMerchantId', label: 'Apple Pay Merchant ID', type: 'text' },
```

---

## 8. Phase 3 — PayU Integration

### 8.1 PayU Adapter

```typescript
// payment_gateways/adapters/payu.ts

export const payuAdapter: GatewayAdapter = {
  providerKey: 'payu',

  async createSession(input) {
    const token = await getPayUAccessToken(input.settings)
    const response = await fetch(`${getPayUBaseUrl(input.settings)}/api/v2_1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        merchantPosId: input.settings.posId,
        description: `Order ${input.orderNumber}`,
        currencyCode: input.currencyCode,
        totalAmount: Math.round(input.amount * 100).toString(), // PayU uses minor units as string
        buyer: {
          email: input.customerEmail,
          firstName: input.customerName?.split(' ')[0],
          lastName: input.customerName?.split(' ').slice(1).join(' '),
          language: input.locale ?? 'en',
        },
        products: input.lineItems.map(item => ({
          name: item.name,
          unitPrice: Math.round(item.unitPrice * 100).toString(),
          quantity: item.quantity.toString(),
        })),
        notifyUrl: input.webhookUrl,
        continueUrl: input.successUrl,
        extOrderId: input.orderId,
      }),
    })

    // PayU returns 302 with redirect URL in Location header
    // or 200 with orderId and redirectUri
    const data = await response.json()
    return {
      sessionId: data.orderId,
      redirectUrl: data.redirectUri,
      gatewayPaymentId: data.orderId,
    }
  },

  // capture, refund, cancel, getStatus, verifyWebhook, mapStatus...
  // PayU webhook uses MD5 signature: md5(body + secondKey)

  mapStatus(gatewayStatus) {
    const map: Record<string, UnifiedPaymentStatus> = {
      NEW: 'pending',
      PENDING: 'pending',
      WAITING_FOR_CONFIRMATION: 'authorized',
      COMPLETED: 'captured',
      CANCELED: 'cancelled',
      REJECTED: 'failed',
    }
    return map[gatewayStatus] ?? 'unknown'
  },
}
```

### 8.2 PayU Provider Registration

```typescript
// Registered via payment_gateways module (not in sales defaultProviders)
registerPaymentProvider({
  key: 'payu',
  label: 'PayU',
  description: 'Online payments via PayU (popular in Poland, CEE, India, Latin America).',
  settings: {
    fields: [
      { key: 'posId', label: 'POS ID', type: 'text', required: true },
      { key: 'clientId', label: 'OAuth Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'OAuth Client Secret', type: 'secret', required: true },
      { key: 'secondKey', label: 'Second Key (MD5 signature)', type: 'secret', required: true },
      { key: 'sandbox', label: 'Sandbox mode', type: 'boolean' },
      { key: 'enableApplePay', label: 'Enable Apple Pay', type: 'boolean' },
    ],
    schema: payuSettings,
  },
})
```

---

## 9. Phase 4 — Przelewy24 Integration

### 9.1 Przelewy24 Adapter

Przelewy24 (P24) is a Polish payment aggregator. It acts as a gateway to multiple Polish banks and payment methods.

```typescript
// payment_gateways/adapters/przelewy24.ts

export const przelewy24Adapter: GatewayAdapter = {
  providerKey: 'przelewy24',

  async createSession(input) {
    const sign = computeP24Sign(input)  // SHA384 of {sessionId|merchantId|amount|currency|crc}
    const response = await fetch(`${getP24BaseUrl(input.settings)}/api/v1/transaction/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${getP24BasicAuth(input.settings)}`,
      },
      body: JSON.stringify({
        merchantId: input.settings.merchantId,
        posId: input.settings.posId ?? input.settings.merchantId,
        sessionId: input.orderId,
        amount: Math.round(input.amount * 100),
        currency: input.currencyCode,
        description: `Order ${input.orderNumber}`,
        email: input.customerEmail,
        country: 'PL',
        language: input.locale ?? 'pl',
        urlReturn: input.successUrl,
        urlStatus: input.webhookUrl,
        sign,
      }),
    })

    const data = await response.json()
    return {
      sessionId: input.orderId,
      redirectUrl: `${getP24BaseUrl(input.settings)}/trnRequest/${data.data.token}`,
      gatewayPaymentId: data.data.token,
    }
  },

  // P24 uses a verify endpoint after webhook notification
  // Webhook includes: merchantId, posId, sessionId, amount, currency, orderId, sign

  mapStatus(gatewayStatus) {
    const map: Record<string, UnifiedPaymentStatus> = {
      // P24 notifications include a status: true (verified) or error code
      verified: 'captured',
      error: 'failed',
      pending: 'pending',
    }
    return map[gatewayStatus] ?? 'unknown'
  },
}
```

### 9.2 P24 Provider Registration

```typescript
registerPaymentProvider({
  key: 'przelewy24',
  label: 'Przelewy24',
  description: 'Polish payment aggregator supporting bank transfers, BLIK, cards, and more.',
  settings: {
    fields: [
      { key: 'merchantId', label: 'Merchant ID', type: 'text', required: true },
      { key: 'posId', label: 'POS ID (if different)', type: 'text' },
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
      { key: 'crc', label: 'CRC Key', type: 'secret', required: true },
      { key: 'sandbox', label: 'Sandbox mode', type: 'boolean' },
    ],
    schema: przelewy24Settings,
  },
})
```

---

## 10. Phase 5 — Apple Pay (via Stripe/PayU)

Apple Pay is implemented as a **payment method type**, not a standalone gateway. Both Stripe and PayU support Apple Pay natively.

### 10.1 How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Apple Pay is a Payment Method, Not a Gateway                │
│                                                              │
│  Customer chooses "Apple Pay" → gateway handles the rest     │
│                                                              │
│  Stripe path:                                                │
│    createSession({ paymentMethodTypes: ['apple_pay'] })      │
│    → Stripe Checkout shows Apple Pay button                  │
│    → Stripe handles Apple Pay token → charges card            │
│    → Webhook: payment_intent.succeeded                       │
│                                                              │
│  PayU path:                                                  │
│    createSession({ paymentMethodTypes: ['ap'] })             │
│    → PayU shows Apple Pay option                             │
│    → PayU handles Apple Pay token → processes payment        │
│    → Webhook: COMPLETED                                      │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 Configuration

In the payment method settings form (extended via UMES field injection):

- **Stripe**: Toggle "Enable Apple Pay" → adds `apple_pay` to `payment_method_types`
- **PayU**: Toggle "Enable Apple Pay" → adds `ap` to PayU's payMethod parameter

No separate Apple Pay adapter is needed. The domain name verification (Apple Pay requires a `/.well-known/apple-developer-merchantid-domain-association` file) is handled by the Stripe/PayU Apple Pay setup documentation — Open Mercato serves the file from the frontend `public/` directory.

### 10.3 Provider-Level Setting

```typescript
// In Stripe provider settings:
{ key: 'enableApplePay', label: 'Enable Apple Pay', type: 'boolean' },

// In PayU provider settings:
{ key: 'enableApplePay', label: 'Enable Apple Pay', type: 'boolean' },
```

The `createSession` method checks `settings.enableApplePay` and includes the appropriate payment method type.

---

## 11. Payment Status Machine

### 11.1 Unified Status Transitions

```
                    ┌──────────┐
                    │ pending   │
                    └─────┬────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
              ▼           ▼           ▼
        ┌──────────┐ ┌────────┐ ┌──────────┐
        │authorized│ │captured│ │  failed   │
        └─────┬────┘ └───┬────┘ └──────────┘
              │          │
        ┌─────┼─────┐    │
        │     │     │    │
        ▼     ▼     ▼    │
  ┌────────┐ ┌────┐ ┌────┴─────┐
  │captured│ │canc.│ │partially │
  └───┬────┘ └────┘ │ refunded │
      │              └─────┬───┘
      │                    │
      ▼                    ▼
┌──────────┐        ┌──────────┐
│ refunded │        │ refunded │
└──────────┘        └──────────┘

Special:
  pending → expired (session timeout, no customer action)
```

### 11.2 Status Sync Engine

```typescript
// payment_gateways/lib/status-sync.ts

async function syncPaymentStatus(
  paymentId: string,
  newUnifiedStatus: UnifiedPaymentStatus,
  gatewayData: {
    gatewayPaymentId: string
    gatewayStatus: string
    capturedAmount?: number
    refundedAmount?: number
    rawResponse?: Record<string, unknown>
  },
  context: { em: EntityManager; organizationId: string; tenantId: string },
): Promise<void> {
  // 1. Load existing GatewayTransaction
  const transaction = await context.em.findOne(GatewayTransaction, {
    paymentId,
    organizationId: context.organizationId,
  })
  if (!transaction) return

  // 2. Check if transition is valid (idempotent — same status = no-op)
  if (transaction.unifiedStatus === newUnifiedStatus) return

  // 3. Update GatewayTransaction
  transaction.unifiedStatus = newUnifiedStatus
  transaction.gatewayStatus = gatewayData.gatewayStatus
  transaction.gatewayMetadata = {
    ...transaction.gatewayMetadata,
    lastResponse: gatewayData.rawResponse,
  }

  // 4. Update SalesPayment via existing payment commands
  const paymentUpdate: Partial<SalesPaymentUpdate> = {
    status: mapToSalesPaymentStatus(newUnifiedStatus),
    paymentReference: gatewayData.gatewayPaymentId,
    metadata: {
      gateway: {
        provider: transaction.providerKey,
        status: gatewayData.gatewayStatus,
        transactionId: gatewayData.gatewayPaymentId,
        lastSyncAt: new Date().toISOString(),
      },
    },
  }

  if (gatewayData.capturedAmount !== undefined) {
    paymentUpdate.capturedAmount = gatewayData.capturedAmount
    if (newUnifiedStatus === 'captured') {
      paymentUpdate.capturedAt = new Date()
    }
  }

  if (gatewayData.refundedAmount !== undefined) {
    paymentUpdate.refundedAmount = gatewayData.refundedAmount
  }

  if (newUnifiedStatus === 'captured' || newUnifiedStatus === 'authorized') {
    paymentUpdate.receivedAt = paymentUpdate.receivedAt ?? new Date()
  }

  // 5. Execute update via existing command (triggers events, recomputes totals)
  await updatePaymentCommand.execute({
    paymentId,
    data: paymentUpdate,
    ...context,
  })

  // 6. Emit gateway-specific event
  await emitEvent(`payment_gateways.payment.${newUnifiedStatus}`, {
    paymentId,
    gatewayPaymentId: gatewayData.gatewayPaymentId,
    providerKey: transaction.providerKey,
    amount: transaction.amount,
  })
}
```

---

## 12. Webhook Architecture

### 12.1 Webhook Endpoints

One endpoint per provider (different signature schemes require provider-specific handling):

```typescript
// payment_gateways/api/webhook/[provider]/route.ts

export const metadata = {
  POST: { requireAuth: false },  // Webhooks are unauthenticated
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const providerKey = params.provider  // 'stripe', 'payu', 'przelewy24'
  const adapter = getGatewayAdapter(providerKey)
  if (!adapter) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 })

  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())

  // 1. Determine tenant from gateway metadata or lookup
  const tenantContext = await resolveTenantFromWebhook(providerKey, body, headers)
  if (!tenantContext) return NextResponse.json({ error: 'Unknown tenant' }, { status: 400 })

  // 2. Get provider settings for this tenant
  const settings = await getProviderSettings(providerKey, tenantContext)

  // 3. Verify signature
  let event: WebhookEvent
  try {
    event = await adapter.verifyWebhook({ headers, body, settings })
  } catch {
    await emitEvent('payment_gateways.webhook.failed', { providerKey, reason: 'signature' })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 4. Idempotency check
  const isDuplicate = await checkWebhookIdempotency(event.idempotencyKey, tenantContext)
  if (isDuplicate) return NextResponse.json({ received: true })  // Acknowledge but skip

  // 5. Enqueue for async processing (quick response to gateway)
  await enqueueJob('payment-gateway-webhook', {
    providerKey,
    event,
    tenantContext,
  })

  // 6. Acknowledge receipt immediately
  return NextResponse.json({ received: true })
}

export const openApi = {
  POST: {
    summary: 'Receive payment gateway webhook',
    tags: ['Payment Gateways'],
    parameters: [{ name: 'provider', in: 'path', required: true }],
    responses: { 200: { description: 'Webhook acknowledged' } },
  },
}
```

### 12.2 Webhook Processing Worker

```typescript
// payment_gateways/workers/webhook-processor.ts

export const metadata: WorkerMeta = {
  queue: 'payment-gateway-webhook',
  id: 'payment-gateway-webhook-processor',
  concurrency: 5,  // I/O-bound
}

export default async function handler(job: Job, ctx: WorkerContext) {
  const { providerKey, event, tenantContext } = job.data

  // 1. Find the SalesPayment by gateway payment ID
  const transaction = await ctx.em.findOne(GatewayTransaction, {
    gatewayPaymentId: event.gatewayPaymentId,
    organizationId: tenantContext.organizationId,
  })
  if (!transaction) {
    // May be a session creation webhook — try session ID
    // Or log and skip if truly unknown
    return
  }

  // 2. Map gateway event to unified status
  const adapter = getGatewayAdapter(providerKey)!
  const newStatus = adapter.mapStatus(event.data.status as string, event.eventType)

  if (newStatus === 'unknown') {
    // Log unmapped event for debugging, do not crash
    return
  }

  // 3. Sync status
  await syncPaymentStatus(
    transaction.paymentId,
    newStatus,
    {
      gatewayPaymentId: event.gatewayPaymentId,
      gatewayStatus: event.data.status as string,
      capturedAmount: extractCapturedAmount(providerKey, event),
      refundedAmount: extractRefundedAmount(providerKey, event),
      rawResponse: event.data,
    },
    { em: ctx.em, ...tenantContext },
  )

  // 4. Log webhook in transaction
  await appendWebhookLog(transaction.id, {
    eventType: event.eventType,
    receivedAt: new Date().toISOString(),
    idempotencyKey: event.idempotencyKey,
    unifiedStatus: newStatus,
    processed: true,
  }, ctx.em)
}
```

### 12.3 Status Polling Worker (Fallback)

```typescript
// payment_gateways/workers/status-poller.ts

export const metadata: WorkerMeta = {
  queue: 'payment-gateway-status-poll',
  id: 'payment-gateway-status-poller',
  concurrency: 3,
}

// Scheduled: check pending/authorized transactions older than 15 minutes without webhook updates
export default async function handler(job: Job, ctx: WorkerContext) {
  const staleTransactions = await ctx.em.find(GatewayTransaction, {
    unifiedStatus: { $in: ['pending', 'authorized'] },
    lastWebhookAt: { $lt: new Date(Date.now() - 15 * 60 * 1000) },  // No webhook in 15 min
    organizationId: job.data.organizationId,
  }, { limit: 50 })

  for (const transaction of staleTransactions) {
    const adapter = getGatewayAdapter(transaction.providerKey)
    if (!adapter || !transaction.gatewayPaymentId) continue

    const settings = await getProviderSettings(transaction.providerKey, {
      organizationId: transaction.organizationId,
      tenantId: transaction.tenantId,
    })

    const gatewayStatus = await adapter.getStatus({
      gatewayPaymentId: transaction.gatewayPaymentId,
      settings,
    })

    const newStatus = adapter.mapStatus(gatewayStatus.status)
    if (newStatus !== transaction.unifiedStatus && newStatus !== 'unknown') {
      await syncPaymentStatus(transaction.paymentId, newStatus, {
        gatewayPaymentId: transaction.gatewayPaymentId,
        gatewayStatus: gatewayStatus.status,
        capturedAmount: gatewayStatus.capturedAmount,
        refundedAmount: gatewayStatus.refundedAmount,
        rawResponse: gatewayStatus.rawResponse,
      }, { em: ctx.em, organizationId: transaction.organizationId, tenantId: transaction.tenantId })
    }

    transaction.lastPolledAt = new Date()
  }
}
```

---

## 13. UMES Integration Points

All sales module UI extensions use UMES — zero files changed in `packages/core/src/modules/sales/`.

### 13.1 "Pay via Gateway" Button (Widget Injection — Works Today)

```typescript
// payment_gateways/widgets/injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  // Button on order detail page
  'detail:sales.document:actions': {
    widgetId: 'payment_gateways.injection.pay-button',
    priority: 40,
  },
  // Gateway status badge on payment detail
  'crud-form:sales.sales_payment': {
    widgetId: 'payment_gateways.injection.gateway-status-badge',
    priority: 30,
  },
}
```

### 13.2 Response Enricher (UMES Phase 3)

```typescript
// payment_gateways/data/enrichers.ts
export const enrichers: ResponseEnricher[] = [
  {
    id: 'payment_gateways.payment-gateway-data',
    targetEntity: 'sales.sales_payment',
    features: ['payment_gateways.view'],

    async enrichOne(record, ctx) {
      const transaction = await ctx.em.findOne(GatewayTransaction, {
        paymentId: record.id,
        organizationId: ctx.organizationId,
      })
      if (!transaction) return record
      return {
        ...record,
        _gateway: {
          providerKey: transaction.providerKey,
          unifiedStatus: transaction.unifiedStatus,
          gatewayStatus: transaction.gatewayStatus,
          gatewayPaymentId: transaction.gatewayPaymentId,
          sessionId: transaction.sessionId,
          redirectUrl: transaction.redirectUrl,
          lastWebhookAt: transaction.lastWebhookAt,
        },
      }
    },

    async enrichMany(records, ctx) {
      const paymentIds = records.map(r => r.id)
      const transactions = await ctx.em.find(GatewayTransaction, {
        paymentId: { $in: paymentIds },
        organizationId: ctx.organizationId,
      })
      const map = new Map(transactions.map(t => [t.paymentId, t]))
      return records.map(record => {
        const t = map.get(record.id)
        return {
          ...record,
          _gateway: t
            ? {
                providerKey: t.providerKey,
                unifiedStatus: t.unifiedStatus,
                gatewayStatus: t.gatewayStatus,
                gatewayPaymentId: t.gatewayPaymentId,
                lastWebhookAt: t.lastWebhookAt,
              }
            : undefined,
        }
      })
    },
  },
]
```

### 13.3 Gateway Status Column (UMES Phase 5)

```typescript
// payment_gateways/widgets/injection/gateway-status-column/widget.ts
export default {
  metadata: {
    id: 'payment_gateways.injection.gateway-status-column',
    features: ['payment_gateways.view'],
  },
  columns: [
    {
      id: 'gatewayStatus',
      header: 'payment_gateways.column.gatewayStatus',
      accessorKey: '_gateway.unifiedStatus',
      cell: ({ getValue }) => {
        const status = getValue() as UnifiedPaymentStatus | undefined
        if (!status) return null
        const colors: Record<string, string> = {
          captured: 'success',
          authorized: 'info',
          pending: 'warning',
          failed: 'destructive',
          refunded: 'muted',
          cancelled: 'ghost',
        }
        return <Badge variant={colors[status] ?? 'default'}>{status}</Badge>
      },
      size: 120,
      placement: { position: InjectionPosition.After, relativeTo: 'status' },
    },
  ],
} satisfies InjectionColumnWidget
```

### 13.4 API Interceptor — Validate Gateway Config (UMES Phase 4)

```typescript
// payment_gateways/api/interceptors.ts
export const interceptors: ApiInterceptor[] = [
  {
    id: 'payment_gateways.validate-payment-method-config',
    targetRoute: 'sales/payments',
    methods: ['POST'],
    features: ['payment_gateways.view'],
    priority: 80,

    async before(request, ctx) {
      const methodId = request.body?.paymentMethodId
      if (!methodId) return { ok: true }

      const method = await ctx.em.findOne(SalesPaymentMethod, {
        id: methodId,
        organizationId: ctx.organizationId,
      })

      // If the payment method has a gateway provider, validate settings
      if (method?.providerKey) {
        const adapter = getGatewayAdapter(method.providerKey)
        if (adapter && !method.providerSettings) {
          return {
            ok: false,
            message: `Payment method "${method.name}" requires gateway configuration. Please configure ${method.providerKey} settings first.`,
            statusCode: 422,
          }
        }
      }

      return { ok: true }
    },
  },
]
```

---

## 14. Data Models

### 14.1 GatewayTransaction (New Entity)

See Section 6.2 for full entity definition.

### 14.2 SalesPayment — No Schema Changes

All gateway data flows through:
- `SalesPayment.paymentReference` — gateway payment ID
- `SalesPayment.metadata` — gateway-specific data under `metadata.gateway` namespace
- `SalesPayment.status` — mapped from unified status via existing status workflow
- `SalesPayment.capturedAmount` / `refundedAmount` — updated by status sync
- `SalesPayment.receivedAt` / `capturedAt` — set on status transitions

### 14.3 SalesPaymentMethod — No Schema Changes

- `SalesPaymentMethod.providerKey` — links to adapter registry
- `SalesPaymentMethod.providerSettings` — stores gateway credentials (encrypted at rest via existing encryption)

---

## 15. API Contracts

### 15.1 Create Payment Session

```
POST /api/payment-gateways/sessions
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderId": "order-uuid",
  "paymentMethodId": "method-uuid",
  "successUrl": "https://shop.example.com/payment/success",
  "cancelUrl": "https://shop.example.com/payment/cancel",
  "paymentMethodTypes": ["card", "apple_pay"],  // Optional, provider-specific
  "locale": "pl"                                 // Optional
}

Response 201:
{
  "sessionId": "cs_test_...",
  "redirectUrl": "https://checkout.stripe.com/...",
  "gatewayPaymentId": "pi_...",
  "paymentId": "payment-uuid",            // Created SalesPayment ID
  "transactionId": "transaction-uuid"     // GatewayTransaction ID
}
```

### 15.2 Capture Payment

```
POST /api/payment-gateways/capture
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentId": "payment-uuid",
  "amount": 150.00                // Optional, for partial capture
}

Response 200:
{
  "captured": true,
  "capturedAmount": 150.00,
  "unifiedStatus": "captured"
}
```

### 15.3 Refund Payment

```
POST /api/payment-gateways/refund
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentId": "payment-uuid",
  "amount": 50.00,              // Optional, for partial refund
  "reason": "requested_by_customer"
}

Response 200:
{
  "refundId": "re_...",
  "refundedAmount": 50.00,
  "unifiedStatus": "partially_refunded"
}
```

### 15.4 Cancel Payment

```
POST /api/payment-gateways/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentId": "payment-uuid"
}

Response 200:
{
  "cancelled": true,
  "unifiedStatus": "cancelled"
}
```

### 15.5 Query Gateway Status

```
GET /api/payment-gateways/status?paymentId=payment-uuid
Authorization: Bearer <token>

Response 200:
{
  "unifiedStatus": "captured",
  "gatewayStatus": "succeeded",
  "providerKey": "stripe",
  "gatewayPaymentId": "pi_...",
  "amount": 200.00,
  "capturedAmount": 200.00,
  "refundedAmount": 0,
  "lastWebhookAt": "2026-02-24T10:30:00Z",
  "lastPolledAt": null
}
```

### 15.6 Webhook Endpoints

```
POST /api/payment-gateways/webhook/stripe     — No auth, Stripe signature
POST /api/payment-gateways/webhook/payu        — No auth, PayU MD5 signature
POST /api/payment-gateways/webhook/przelewy24  — No auth, P24 signature
```

---

## 16. Security & Compliance

### 16.1 PCI DSS Compliance

Open Mercato **never handles card data directly**. All gateway integrations use redirect-based checkout (Stripe Checkout, PayU hosted form, P24 redirect). This keeps Open Mercato out of PCI DSS scope (SAQ-A or SAQ A-EP at most).

| Gateway | Checkout Method | Card Data Handling |
|---------|----------------|-------------------|
| Stripe | Stripe Checkout (hosted page) | Stripe handles all card data |
| PayU | PayU hosted checkout page | PayU handles all card data |
| Przelewy24 | P24 redirect to bank/BLIK | P24 handles all payment data |
| Apple Pay | Handled by Stripe/PayU via their checkout | Token-based, no card data |

### 16.2 Credential Storage

- Provider settings (`SalesPaymentMethod.providerSettings`) containing API keys and secrets MUST be encrypted at rest using the existing encryption system (`findWithDecryption`/`findOneWithDecryption`)
- Webhook secrets stored as `type: 'secret'` provider settings — rendered as password fields in UI, encrypted in DB
- Gateway API keys MUST NOT appear in logs, API responses, or error messages

### 16.3 Webhook Security

- Each provider uses its own signature verification scheme (Stripe HMAC, PayU MD5, P24 SHA384)
- Webhook endpoints require no authentication (`requireAuth: false`) but verify signatures
- Replay attack prevention via timestamp validation (5-minute window for Stripe, idempotency key for all)
- Rate limiting per tenant to prevent DoS via webhook flooding

### 16.4 Multi-Tenant Isolation

- All `GatewayTransaction` records are scoped by `organizationId` and `tenantId`
- Webhook processing resolves tenant from gateway metadata (order ID → payment → org)
- Provider settings are per-tenant (different Stripe accounts per tenant)

---

## 17. SPEC-041 Improvement Suggestions

After analyzing how payment gateway integration would use UMES, here are concrete suggestions for SPEC-041:

### 17.1 Webhook Extension Point (Missing from UMES)

**Problem**: UMES covers UI, data enrichment, and API interception but has no pattern for **incoming webhooks from external services**. The payment gateway module needs webhook endpoints, but so would any future integration module (shipping carriers, email providers, CRM sync).

**Suggestion**: Add a **Webhook Extension Point** to UMES — a standardized way for modules to register webhook endpoints with auto-discovery, shared signature verification utilities, and a common idempotency layer.

```typescript
// Proposed: module-level webhook declaration (auto-discovered)
// payment_gateways/webhooks.ts
export const webhooks: WebhookEndpointDeclaration[] = [
  {
    id: 'payment_gateways.stripe',
    path: '/webhook/stripe',          // → /api/payment-gateways/webhook/stripe
    signatureScheme: 'stripe',        // Built-in: stripe, hmac-sha256, md5
    // ...or custom verifier function
  },
]
```

This would reduce boilerplate across modules that handle incoming webhooks.

### 17.2 Async Side-Effect Enrichment (Performance Concern)

**Problem**: Response enrichers (Phase 3) run synchronously in the CRUD GET pipeline. For payment gateways, enriching every payment with gateway transaction data adds a database query per API call. For list endpoints with `enrichMany`, this is one extra query — acceptable. But if many modules each add enrichers to the same entity, the cumulative latency could become significant.

**Suggestion**: Add an optional **enricher caching strategy** to UMES. Enrichers could declare a cache TTL, and the enricher pipeline would check the cache before executing the enricher function.

```typescript
// Proposed addition to ResponseEnricher interface
interface ResponseEnricher<TRecord, TEnriched> {
  // ... existing fields
  cache?: {
    ttl: number                      // Seconds
    tags: string[]                   // Cache invalidation tags
    keyFn: (record: TRecord) => string  // Cache key derivation
  }
}
```

The existing cache package (`@open-mercato/cache`) with tag-based invalidation would handle this.

### 17.3 API Interceptor — Method-Level Settings Access

**Problem**: API interceptors (Phase 4) receive `InterceptorContext` with `em` and organization scope, but for payment gateways, the interceptor needs to load provider settings from the payment method — this requires knowing which payment method entity to query, which is domain-specific knowledge.

**Suggestion**: UMES `InterceptorContext` should include a `resolveEntity` helper or the interceptor should be able to declare its data dependencies:

```typescript
// Proposed: interceptor can declare pre-loaded data
interface ApiInterceptor {
  // ... existing fields
  preload?: {
    entities: Array<{
      entityType: string
      fromBody?: string        // JSON path to ID in request body
      fromQuery?: string       // Query param name
      as: string               // Key in context
    }>
  }
}
```

This avoids every interceptor having to manually query for related entities.

### 17.4 Extension Point for Background Jobs / Workers

**Problem**: UMES focuses on synchronous extension points (UI slots, API interception, response enrichment). But integration modules often need **scheduled background work** (status polling, retry processing, session expiration cleanup). Workers already exist via auto-discovery, but there's no UMES-style way for one module to extend another module's background processing.

**Suggestion**: Consider adding a **Worker Extension Point** in UMES — allowing a module to inject additional processing steps into another module's worker pipeline:

```typescript
// Proposed: module extends another module's worker
'worker:sales.payment-processor:after': {
  widgetId: 'payment_gateways.injection.gateway-sync',
  priority: 50,
}
```

This would be useful for cases like: "after the sales module processes a payment, the gateway module should sync the status."

### 17.5 Event-Driven Enrichment (Lazy Enrichment Pattern)

**Problem**: Some enrichment data is expensive to compute but rarely viewed. Gateway transaction details are only needed when a user views a specific payment, not when listing all payments.

**Suggestion**: Add an `enrichmentMode` to the enricher declaration:

```typescript
interface ResponseEnricher {
  // ... existing
  mode?: 'eager' | 'lazy'  // Default: 'eager'
  // eager: runs on every request (current behavior)
  // lazy: only runs when client requests via ?enrich=gateway
}
```

This lets the client opt-in to expensive enrichment via a query parameter, reducing default payload size and query overhead.

### 17.6 Typed Extension Point Discovery for External Integrations

**Problem**: UMES's string-based extension point IDs (`ui:sales.order:detail:shipment-dialog`) are documented but not programmatically discoverable. When building a payment gateway module, the developer needs to know which spot IDs exist on the order detail page.

**Suggestion**: Generate a typed manifest of all extension points in the system during `yarn generate`:

```typescript
// Generated: .mercato/generated/extension-points.generated.ts
export const extensionPoints = {
  'ui:sales.document:detail:actions': {
    type: 'slot',
    contextType: 'SalesDocumentInjectionContext',
    module: 'sales',
  },
  'data:sales.sales_payment:response:enrich': {
    type: 'enricher',
    entityType: 'SalesPayment',
    module: 'sales',
  },
  // ...
} as const
```

This enables IDE autocompletion when writing injection tables.

---

## 18. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gateway API changes break adapter | Medium | Pin SDK versions; adapter-specific integration tests |
| Webhook delivery failure | High | Status polling worker as fallback; webhook retry tolerance |
| Multi-tenant webhook routing | High | Store org/tenant in gateway metadata; verify on receipt |
| Credential exposure in logs | Critical | Never log settings; sanitize error messages; use encryption |
| Race condition: webhook + poll update same payment | Medium | Idempotent status sync; skip if status unchanged |
| Enricher performance on large payment lists | Low | `enrichMany` uses batch query; consider cache (suggestion 17.2) |
| UMES Phase 3/4/5 not yet implemented | High | Phase 1 (widget injection) works today for basic UI; full integration requires UMES phases |
| Apple Pay domain verification | Low | Documentation-only; merchant uploads file to `public/` |
| P24 verify step after webhook | Low | Adapter handles verify call in webhook processing |

---

## 19. Integration Test Coverage

### 19.1 Gateway Session Flow

| Test | Method | Path | Assert |
|------|--------|------|--------|
| Create Stripe session | POST | `/api/payment-gateways/sessions` | Returns sessionId, redirectUrl; creates SalesPayment + GatewayTransaction |
| Create PayU session | POST | `/api/payment-gateways/sessions` | Returns sessionId, redirectUrl with PayU domain |
| Create P24 session | POST | `/api/payment-gateways/sessions` | Returns token-based redirectUrl |
| Session with invalid provider | POST | `/api/payment-gateways/sessions` | Returns 422 |
| Session without auth | POST | `/api/payment-gateways/sessions` | Returns 401 |

### 19.2 Webhook Processing

| Test | Method | Path | Assert |
|------|--------|------|--------|
| Stripe webhook: payment_intent.succeeded | POST | `/api/payment-gateways/webhook/stripe` | SalesPayment status → captured, capturedAmount updated |
| Stripe webhook: invalid signature | POST | `/api/payment-gateways/webhook/stripe` | Returns 401, no status change |
| Stripe webhook: duplicate event ID | POST | `/api/payment-gateways/webhook/stripe` | Returns 200, no double-processing |
| PayU webhook: COMPLETED | POST | `/api/payment-gateways/webhook/payu` | SalesPayment status → captured |
| P24 webhook: verified | POST | `/api/payment-gateways/webhook/przelewy24` | SalesPayment status → captured, verify call made |

### 19.3 Capture / Refund / Cancel

| Test | Method | Path | Assert |
|------|--------|------|--------|
| Capture authorized payment | POST | `/api/payment-gateways/capture` | capturedAmount updated, status → captured |
| Partial refund | POST | `/api/payment-gateways/refund` | refundedAmount updated, status → partially_refunded |
| Full refund | POST | `/api/payment-gateways/refund` | status → refunded |
| Cancel pending payment | POST | `/api/payment-gateways/cancel` | status → cancelled |
| Capture already captured | POST | `/api/payment-gateways/capture` | Returns 422 (invalid transition) |

### 19.4 Status Sync

| Test | Assert |
|------|--------|
| Polling detects completed payment | GatewayTransaction + SalesPayment updated |
| Concurrent webhook + poll | Only one update applied (idempotent) |
| Unknown gateway status | Logged as 'unknown', no SalesPayment change |

### 19.5 UMES Extensions (UI)

| Test | Assert |
|------|--------|
| Payment list shows gateway status column | Column visible with correct badge |
| Order detail shows "Pay via Gateway" button | Button visible, opens session |
| Payment detail shows gateway transaction info | Enriched data displayed |

---

## 20. Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial draft |
