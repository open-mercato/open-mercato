# SPEC-044 — Payment Gateway Integrations (Stripe, PayU, Przelewy24, Apple Pay)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Related** | SPEC-041 (UMES), SPEC-045 (Integration Marketplace), Sales module, Payment Provider Registry |

## TLDR

Define a **two-layer payment architecture**: a thin core `payment_gateways` module that provides the shared adapter contract, status machine, webhook infrastructure, and UMES-based UI extensions — plus **independent provider modules** (`gateway_stripe`, `gateway_payu`, `gateway_przelewy24`) that each implement the adapter interface and can be developed, installed, and maintained independently by different teams or the community. Apple Pay is a payment method type within Stripe/PayU, not a separate module.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [Existing Infrastructure Assessment](#4-existing-infrastructure-assessment)
5. [Gateway Adapter Contract](#5-gateway-adapter-contract)
6. [Core Module — `payment_gateways`](#6-core-module--payment_gateways)
7. [Provider Module — `gateway_stripe`](#7-provider-module--gateway_stripe)
8. [Provider Module — `gateway_payu`](#8-provider-module--gateway_payu)
9. [Provider Module — `gateway_przelewy24`](#9-provider-module--gateway_przelewy24)
10. [Apple Pay (via Stripe/PayU)](#10-apple-pay-via-stripepayu)
11. [Payment Status Machine](#11-payment-status-machine)
12. [Webhook Architecture](#12-webhook-architecture)
13. [UMES Integration Points](#13-umes-integration-points)
14. [Data Models](#14-data-models)
15. [API Contracts](#15-api-contracts)
16. [Security & Compliance](#16-security--compliance)
17. [Integration Marketplace Alignment (SPEC-045)](#17-integration-marketplace-alignment-spec-045)
18. [SPEC-041 Improvement Suggestions](#18-spec-041-improvement-suggestions)
19. [Risks & Mitigations](#19-risks--mitigations)
20. [Integration Test Coverage](#20-integration-test-coverage)
21. [Changelog](#21-changelog)

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

Build a **plugin-friendly payment architecture** where:
- A core `payment_gateways` module provides shared infrastructure (adapter contract, status machine, webhook routing, UMES extensions)
- Each payment provider (Stripe, PayU, P24, etc.) is a **separate, independent module** that implements the adapter contract
- Different developers or community contributors can build, maintain, and release provider modules independently
- Adding a new gateway means creating a new module — no changes to core or existing providers

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Core + plugins architecture** — Thin shared core, independent provider modules | Different teams own different providers; community can contribute new ones |
| 2 | **Adapter pattern** — All providers implement a common `GatewayAdapter` interface exported by the core | Providers are interchangeable; core doesn't know provider internals |
| 3 | **Zero sales module modifications** — All gateway logic lives outside the sales module | UMES makes this possible; keeps sales module clean |
| 4 | **Each provider is self-contained** — Provider module owns its adapter, webhook handler, provider registration, settings schema, and translations | No cross-provider dependencies |
| 5 | **Webhook-first status sync** — Trust the gateway's webhook as source of truth for payment state | Polling is a fallback, not primary |
| 6 | **Idempotent processing** — Every webhook and status transition is safely re-enterable | Gateways retry; we must handle duplicates |
| 7 | **Metadata bridge** — Use `SalesPayment.metadata` for gateway-specific data (transaction IDs, gateway status codes) | Avoids schema changes to the core entity |
| 8 | **Provider registry integration** — Providers register via the existing `registerPaymentProvider()` system | No new registration mechanisms |
| 9 | **Apple Pay as method, not module** — Apple Pay is a payment method type within Stripe/PayU, not a standalone gateway | Simplifies architecture significantly |

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Core: payment_gateways module (packages/core/src/modules/payment_gateways/) │
│                                                                              │
│  Exports:                                                                    │
│  • GatewayAdapter interface + types                                          │
│  • Adapter registry (register/get/list)                                      │
│  • Status machine (unified status, valid transitions)                        │
│  • Status sync engine (gateway status → SalesPayment update)                 │
│  • Webhook routing (dispatch to correct adapter)                             │
│  • GatewayTransaction entity (shared data model)                             │
│  • UMES extensions (UI widgets, enrichers, interceptors)                     │
│  • Gateway service (DI: createSession, capture, refund, cancel, sync)        │
│                                                                              │
│  Does NOT contain any provider-specific code.                                │
└─────────────────────────────────┬────────────────────────────────────────────┘
                                  │
                   Adapter contract (GatewayAdapter)
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│  gateway_stripe   │  │  gateway_payu    │  │  gateway_przelewy24  │
│                    │  │                  │  │                      │
│  • Stripe adapter  │  │  • PayU adapter  │  │  • P24 adapter       │
│  • Provider reg.   │  │  • Provider reg. │  │  • Provider reg.     │
│  • Settings schema │  │  • Settings sch. │  │  • Settings schema   │
│  • Webhook verify  │  │  • Webhook ver.  │  │  • Webhook verify    │
│  • Status mapping  │  │  • Status map.   │  │  • Status mapping    │
│  • Translations    │  │  • Translations  │  │  • Translations      │
│                    │  │                  │  │                      │
│  npm: independent  │  │  npm: independent│  │  npm: independent    │
│  Author: anyone    │  │  Author: anyone  │  │  Author: anyone      │
└──────────────────┘  └──────────────────┘  └──────────────────────┘

          ▼                       ▼                       ▼
   (future: gateway_adyen, gateway_mollie, gateway_blik, ...)
```

### Why Two Layers?

| Concern | Monolithic (rejected) | Core + Plugins (chosen) |
|---------|----------------------|------------------------|
| Adding a new provider | Edit central module, risk breaking existing ones | Create new module, zero risk to existing |
| Different teams | All must coordinate in same module | Each owns their module independently |
| Dependencies | One module pulls in `stripe`, `payu-sdk`, etc. | Each module only pulls its own SDK |
| Release cadence | All providers release together | Each releases independently |
| Community contributions | High bar — PR to core | Low bar — separate repo/module |
| Install only what you need | Bundle all gateways | Install only `gateway_stripe` if that's all you use |

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
| Payment Provider Registry | Provider modules call `registerPaymentProvider()` with their settings | Yes |
| Payment Commands (create/update) | Used by core status sync to update payment records | Yes |
| Payment Events | `sales.payment.updated` triggers downstream (notifications, workflows) | Yes |
| Webhook pattern from inbox_ops | Reference for signature verification, rate limiting | Yes (template) |
| Worker/Queue system | Async webhook processing, status polling | Yes |
| DI container | Core registers gateway service; providers register adapters | Yes |

### What Requires UMES (SPEC-041)

| Extension | UMES Feature | Owned By |
|-----------|-------------|----------|
| "Pay via Gateway" button on order detail | UI Slot Injection (Phase 1) | Core module |
| Gateway transaction details on payment detail | Response Enricher (Phase 3) | Core module |
| Validate gateway config before payment creation | API Interceptor (Phase 4) | Core module |
| Gateway status column on payments table | Column Injection (Phase 5) | Core module |
| Gateway settings fields on payment method form | Field Injection (Phase 5) | Core module |

All UMES extensions live in the **core** `payment_gateways` module because they are provider-agnostic — they read from `GatewayTransaction` which works the same regardless of provider.

---

## 5. Gateway Adapter Contract

This is the interface that every provider module must implement. Exported by the core module.

```typescript
// payment_gateways/lib/adapter.ts
// (exported from @open-mercato/core/modules/payment_gateways)

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

## 6. Core Module — `payment_gateways`

The core module contains **zero provider-specific code**. It provides shared infrastructure that all provider modules use.

### 6.1 Module Structure

```
packages/core/src/modules/payment_gateways/
├── index.ts                           # Module metadata
├── acl.ts                             # RBAC features
├── di.ts                              # Gateway service registration
├── events.ts                          # Gateway lifecycle events
├── setup.ts                           # Tenant init, default statuses
├── lib/
│   ├── adapter.ts                     # GatewayAdapter interface + all types (§5)
│   ├── adapter-registry.ts            # registerGatewayAdapter(), getAdapter(), listAdapters()
│   ├── status-machine.ts              # Unified status transitions + validation
│   ├── status-sync.ts                 # Gateway status → SalesPayment update
│   ├── gateway-service.ts             # High-level service (createSession, capture, refund...)
│   └── webhook-utils.ts              # Shared helpers (idempotency check, tenant resolution)
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
│       └── [provider]/route.ts       # Dynamic webhook routing — dispatches to adapter
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
│       └── gateway-status-column/    # Gateway status column on payments table
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 6.2 Adapter Registry (Version-Aware)

The registry supports versioned adapters. Provider modules register one adapter per supported API version. The gateway service resolves the tenant's selected version via `IntegrationState.apiVersion` (see SPEC-045a §1.3).

```typescript
// payment_gateways/lib/adapter-registry.ts

const adapters = new Map<string, GatewayAdapter>()  // key: 'providerKey' or 'providerKey:version'

/** Register an adapter, optionally for a specific API version */
export function registerGatewayAdapter(
  adapter: GatewayAdapter,
  options?: { version?: string },
): void {
  if (options?.version) {
    adapters.set(`${adapter.providerKey}:${options.version}`, adapter)
  }
  // Register as unversioned default if no unversioned entry exists yet,
  // or if this is the default version for the integration
  if (!options?.version || isDefaultVersion(`gateway_${adapter.providerKey}`, options.version)) {
    adapters.set(adapter.providerKey, adapter)
  }
}

/** Get an adapter, optionally for a specific API version */
export function getGatewayAdapter(providerKey: string, version?: string): GatewayAdapter | undefined {
  if (version) {
    return adapters.get(`${providerKey}:${version}`) ?? adapters.get(providerKey)
  }
  return adapters.get(providerKey)
}

export function listGatewayAdapters(): GatewayAdapter[] {
  // Returns unique adapters (deduplicates versioned + unversioned entries)
  const seen = new Set<string>()
  return Array.from(adapters.values()).filter(a => {
    if (seen.has(a.providerKey)) return false
    seen.add(a.providerKey)
    return true
  })
}
```

**Unversioned provider modules** (e.g., a simple community gateway) still work — they call `registerGatewayAdapter(adapter)` without the `version` option, exactly as before. Zero breaking changes.

### 6.3 Gateway Transaction Entity

Owned by the core module. All provider modules write to this entity via the core's status sync engine — they never create their own transaction tables.

```typescript
// payment_gateways/data/entities.ts

@Entity({ tableName: 'gateway_transactions' })
export class GatewayTransaction extends BaseEntity {
  @Property()
  paymentId!: string  // FK to sales_payments.id (ID only, no ORM relation)

  @Property()
  providerKey!: string  // 'stripe' | 'payu' | 'przelewy24' | any future provider

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

### 6.4 Gateway Service (DI)

The high-level service that routes calls to the correct adapter. Consumed by API routes and widgets. Resolves the tenant's selected API version automatically via `IntegrationState.apiVersion`.

```typescript
// payment_gateways/lib/gateway-service.ts

export function createPaymentGatewayService({ em, eventBus, integrationState }: Dependencies) {
  /** Resolve the correct adapter for a provider, respecting the tenant's version selection */
  async function resolveAdapter(providerKey: string, scope: TenantScope): Promise<GatewayAdapter> {
    const version = await integrationState.resolveApiVersion(`gateway_${providerKey}`, scope)
    const adapter = getGatewayAdapter(providerKey, version)
    if (!adapter) throw new Error(`No adapter registered for provider '${providerKey}'${version ? ` version '${version}'` : ''}`)
    return adapter
  }

  return {
    async createPaymentSession(input: {
      orderId: string
      paymentMethodId: string
      successUrl: string
      cancelUrl: string
      paymentMethodTypes?: string[]
      locale?: string
    }) {
      // 1. Load payment method → get providerKey + settings
      // 2. Resolve adapter (version-aware) via resolveAdapter()
      // 3. Call adapter.createSession()
      // 4. Create SalesPayment + GatewayTransaction
      // 5. Emit payment_gateways.session.created
      // 6. Return session result
    },

    async capturePayment(paymentId: string, amount?: number) {
      // 1. Load GatewayTransaction → get adapter
      // 2. Call adapter.capture()
      // 3. Call syncPaymentStatus()
    },

    async refundPayment(paymentId: string, amount?: number, reason?: string) {
      // 1. Load GatewayTransaction → get adapter
      // 2. Call adapter.refund()
      // 3. Call syncPaymentStatus()
    },

    async cancelPayment(paymentId: string) {
      // 1. Load GatewayTransaction → get adapter
      // 2. Call adapter.cancel()
      // 3. Call syncPaymentStatus()
    },

    async syncPaymentStatus(paymentId: string) {
      // 1. Load GatewayTransaction → get adapter
      // 2. Call adapter.getStatus() (poll)
      // 3. Call status sync engine
    },
  }
}
```

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

### 6.7 Webhook Routing

The core module provides a single dynamic webhook endpoint that routes to the correct adapter:

```typescript
// payment_gateways/api/webhook/[provider]/route.ts

export const metadata = {
  POST: { requireAuth: false },  // Webhooks are unauthenticated
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const providerKey = params.provider  // Dynamic: 'stripe', 'payu', 'przelewy24', etc.
  const adapter = getGatewayAdapter(providerKey)
  if (!adapter) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 })

  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())

  // 1. Determine tenant from gateway metadata or lookup
  const tenantContext = await resolveTenantFromWebhook(providerKey, body, headers)
  if (!tenantContext) return NextResponse.json({ error: 'Unknown tenant' }, { status: 400 })

  // 2. Get provider settings for this tenant
  const settings = await getProviderSettings(providerKey, tenantContext)

  // 3. Verify signature via the provider's adapter
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
```

This means provider modules **don't need their own webhook endpoints** — they only need to implement `verifyWebhook()` and `mapStatus()` in their adapter.

### 6.8 Status Sync Engine

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
  })
}
```

---

## 7. Provider Module — `gateway_stripe`

A self-contained module that depends only on the `payment_gateways` core (for the adapter contract) and the `stripe` npm package.

### 7.1 Module Structure

```
packages/core/src/modules/gateway_stripe/
├── index.ts                   # Module metadata (depends on: payment_gateways)
├── integration.ts             # Integration definition with apiVersions
├── setup.ts                   # Register versioned adapters + provider on tenant init
├── lib/
│   ├── shared.ts              # Common logic across API versions (status maps, helpers)
│   └── adapters/
│       ├── v2024-12-18.ts     # GatewayAdapter for Stripe API 2024-12-18
│       └── v2023-10-16.ts     # GatewayAdapter for Stripe API 2023-10-16
└── i18n/
    ├── en.ts
    └── pl.ts
```

That's it. No `acl.ts` (uses core's features), no `data/entities.ts` (uses core's GatewayTransaction), no `api/` (uses core's webhook routing), no `widgets/` (uses core's UMES extensions). Versioned adapters live in `lib/adapters/` with shared logic in `lib/shared.ts`.

### 7.2 Setup — Registration (Versioned)

```typescript
// gateway_stripe/setup.ts

import { registerGatewayAdapter } from '../payment_gateways/lib/adapter-registry'
import { registerPaymentProvider } from '../../sales/lib/providers'
import { stripeAdapterV20241218 } from './lib/adapters/v2024-12-18'
import { stripeAdapterV20231016 } from './lib/adapters/v2023-10-16'

export const setup: ModuleSetupConfig = {
  async onTenantCreated() {
    // Register versioned adapters — one per supported Stripe API version
    registerGatewayAdapter(stripeAdapterV20241218, { version: '2024-12-18' })
    registerGatewayAdapter(stripeAdapterV20231016, { version: '2023-10-16' })

    // Register or update the provider definition with settings schema
    registerPaymentProvider({
      key: 'stripe',
      label: 'Stripe',
      description: 'Card payments, Apple Pay, Google Pay via Stripe Checkout.',
      settings: {
        fields: [
          { key: 'publishableKey', label: 'Publishable Key', type: 'secret', required: true },
          { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
          { key: 'webhookSecret', label: 'Webhook Secret', type: 'secret', required: true },
          { key: 'captureMethod', label: 'Capture Method', type: 'select', options: [
            { value: 'automatic', label: 'Automatic' },
            { value: 'manual', label: 'Manual (authorize then capture)' },
          ]},
          { key: 'enableApplePay', label: 'Enable Apple Pay', type: 'boolean' },
          { key: 'successUrl', label: 'Success URL', type: 'url' },
          { key: 'cancelUrl', label: 'Cancel URL', type: 'url' },
        ],
        schema: stripeSettingsSchema,
      },
    })
  },
}
```

### 7.3 Adapter Implementation (Versioned)

Versioned adapters share common logic (status maps, webhook verification, credential loading) in `lib/shared.ts` and only override what changed between Stripe API versions. This keeps versioned files thin.

```typescript
// gateway_stripe/lib/shared.ts — common logic across all Stripe API versions

import Stripe from 'stripe'
import type { UnifiedPaymentStatus } from '../../payment_gateways/lib/adapter'

/** Create a Stripe client pinned to a specific API version */
export function createStripeClient(settings: Record<string, unknown>, apiVersion: string): Stripe {
  return new Stripe(settings.secretKey as string, { apiVersion: apiVersion as Stripe.LatestApiVersion })
}

/** Webhook verification is the same across Stripe API versions */
export async function verifyStripeWebhook(input: VerifyWebhookInput, settings: Record<string, unknown>) {
  const stripe = new Stripe(settings.secretKey as string)
  const event = stripe.webhooks.constructEvent(
    input.body,
    input.headers['stripe-signature']!,
    settings.webhookSecret as string,
  )
  const paymentIntent = event.data.object as Stripe.PaymentIntent
  return {
    eventType: event.type,
    gatewayPaymentId: paymentIntent.id,
    data: event.data.object as Record<string, unknown>,
    idempotencyKey: event.id,
  }
}

/** Status mapping shared across versions (overridable per version if needed) */
export const defaultEventMap: Record<string, UnifiedPaymentStatus> = {
  'payment_intent.succeeded': 'captured',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'cancelled',
  'payment_intent.amount_capturable_updated': 'authorized',
  'payment_intent.requires_action': 'pending',
  'charge.refunded': 'refunded',
  'checkout.session.expired': 'expired',
}

export const defaultStatusMap: Record<string, UnifiedPaymentStatus> = {
  requires_payment_method: 'pending',
  requires_confirmation: 'pending',
  requires_action: 'pending',
  processing: 'pending',
  requires_capture: 'authorized',
  succeeded: 'captured',
  canceled: 'cancelled',
}
```

```typescript
// gateway_stripe/lib/adapters/v2024-12-18.ts — latest stable version

import { createStripeClient, verifyStripeWebhook, defaultEventMap, defaultStatusMap } from '../shared'
import type { GatewayAdapter, UnifiedPaymentStatus } from '../../../payment_gateways/lib/adapter'

const API_VERSION = '2024-12-18'

export const stripeAdapterV20241218: GatewayAdapter = {
  providerKey: 'stripe',

  async createSession(input) {
    const stripe = createStripeClient(input.settings, API_VERSION)

    const paymentMethodTypes = input.paymentMethodTypes ?? ['card']
    if (input.settings.enableApplePay) paymentMethodTypes.push('apple_pay')

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: paymentMethodTypes,
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
    const stripe = createStripeClient(input.settings, API_VERSION)
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
    const stripe = createStripeClient(input.settings, API_VERSION)
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
    const stripe = createStripeClient(input.settings, API_VERSION)
    const intent = await stripe.paymentIntents.cancel(input.gatewayPaymentId)
    return { cancelled: intent.status === 'canceled', gatewayStatus: intent.status }
  },

  async getStatus(input) {
    const stripe = createStripeClient(input.settings, API_VERSION)
    const intent = await stripe.paymentIntents.retrieve(input.gatewayPaymentId)
    return {
      status: intent.status,
      amount: intent.amount / 100,
      capturedAmount: intent.amount_received / 100,
      refundedAmount: (intent.amount - intent.amount_received) / 100,
      currencyCode: intent.currency.toUpperCase(),
    }
  },

  verifyWebhook: verifyStripeWebhook,

  mapStatus(gatewayStatus, eventType) {
    if (eventType && defaultEventMap[eventType]) return defaultEventMap[eventType]
    return defaultStatusMap[gatewayStatus] ?? 'unknown'
  },
}
```

```typescript
// gateway_stripe/lib/adapters/v2023-10-16.ts — deprecated version (kept for existing tenants)
// Inherits most logic from shared, overrides only what's different in the older API

import { createStripeClient, verifyStripeWebhook, defaultEventMap, defaultStatusMap } from '../shared'
import type { GatewayAdapter } from '../../../payment_gateways/lib/adapter'

const API_VERSION = '2023-10-16'

export const stripeAdapterV20231016: GatewayAdapter = {
  providerKey: 'stripe',

  async createSession(input) {
    const stripe = createStripeClient(input.settings, API_VERSION)
    // Older API: uses different checkout session params (e.g., no automatic_tax)
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
      metadata: { orderId: input.orderId, organizationId: input.organizationId, tenantId: input.tenantId },
    })

    return { sessionId: session.id, redirectUrl: session.url!, gatewayPaymentId: session.payment_intent as string | undefined }
  },

  // capture, refund, cancel, getStatus — delegate to shared helpers (same across versions)
  async capture(input) { /* same as v2024-12-18 — uses shared createStripeClient */ },
  async refund(input) { /* same as v2024-12-18 */ },
  async cancel(input) { /* same as v2024-12-18 */ },
  async getStatus(input) { /* same as v2024-12-18 */ },

  verifyWebhook: verifyStripeWebhook,  // Same across all versions
  mapStatus(gatewayStatus, eventType) {
    if (eventType && defaultEventMap[eventType]) return defaultEventMap[eventType]
    return defaultStatusMap[gatewayStatus] ?? 'unknown'
  },
}
```

Note how the deprecated `v2023-10-16` adapter is thin — it only overrides `createSession()` where the API changed. Everything else delegates to shared logic. This is the recommended pattern for versioned adapters: keep them minimal, share aggressively.

### 7.4 What a Provider Module Developer Needs to Know

To build a new provider module:

1. Create a module with `index.ts`, `integration.ts`, and `setup.ts`
2. Implement the `GatewayAdapter` interface (imported from `payment_gateways/lib/adapter`)
3. In `setup.ts`, call `registerGatewayAdapter(myAdapter)` and `registerPaymentProvider({ key, label, settings })`
4. That's it. The core handles: webhook routing, status sync, version resolution, UMES UI, API endpoints, workers.

**Adding API version support** (optional — recommended for providers with versioned APIs):

5. Add `apiVersions` to your `integration.ts` with at least one `default: true` version
6. Create separate adapter files in `lib/adapters/` — one per API version
7. Put shared logic (status maps, credential loading, webhook verification) in `lib/shared.ts`
8. Register each adapter with `registerGatewayAdapter(adapter, { version: 'x.y.z' })`
9. Omitting `apiVersions` entirely is fine — your integration works as unversioned (no version picker in admin UI)

---

## 8. Provider Module — `gateway_payu`

### 8.1 Module Structure

```
packages/core/src/modules/gateway_payu/
├── index.ts
├── setup.ts                   # Register adapter + provider
├── lib/
│   ├── adapter.ts             # GatewayAdapter implementation for PayU
│   └── auth.ts                # PayU OAuth token management
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 8.2 Setup

```typescript
// gateway_payu/setup.ts

export const setup: ModuleSetupConfig = {
  async onTenantCreated() {
    registerGatewayAdapter(payuAdapter)

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
        schema: payuSettingsSchema,
      },
    })
  },
}
```

### 8.3 Adapter (Key Differences from Stripe)

```typescript
// gateway_payu/lib/adapter.ts

export const payuAdapter: GatewayAdapter = {
  providerKey: 'payu',

  async createSession(input) {
    const token = await getPayUAccessToken(input.settings)
    const baseUrl = input.settings.sandbox
      ? 'https://secure.snd.payu.com'
      : 'https://secure.payu.com'

    const response = await fetch(`${baseUrl}/api/v2_1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        merchantPosId: input.settings.posId,
        description: `Order ${input.orderNumber}`,
        currencyCode: input.currencyCode,
        totalAmount: Math.round(input.amount * 100).toString(),
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

    const data = await response.json()
    return {
      sessionId: data.orderId,
      redirectUrl: data.redirectUri,
      gatewayPaymentId: data.orderId,
    }
  },

  // verifyWebhook: PayU uses MD5(body + secondKey)
  async verifyWebhook(input) {
    const expectedSignature = md5(input.body + input.settings.secondKey)
    const receivedSignature = input.headers['openpayu-signature']
    // Parse signature header and verify...
  },

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

  // capture, refund, cancel, getStatus — similar pattern
}
```

---

## 9. Provider Module — `gateway_przelewy24`

### 9.1 Module Structure

```
packages/core/src/modules/gateway_przelewy24/
├── index.ts
├── setup.ts
├── lib/
│   └── adapter.ts
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 9.2 Setup

```typescript
// gateway_przelewy24/setup.ts

export const setup: ModuleSetupConfig = {
  async onTenantCreated() {
    registerGatewayAdapter(przelewy24Adapter)

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
        schema: przelewy24SettingsSchema,
      },
    })
  },
}
```

### 9.3 Adapter (Key Differences)

P24 has a two-step flow: register transaction → redirect → webhook notification → **verify transaction** (extra step vs Stripe/PayU).

```typescript
// gateway_przelewy24/lib/adapter.ts

export const przelewy24Adapter: GatewayAdapter = {
  providerKey: 'przelewy24',

  async createSession(input) {
    const baseUrl = input.settings.sandbox
      ? 'https://sandbox.przelewy24.pl'
      : 'https://secure.przelewy24.pl'

    const sign = computeP24Sign(input)  // SHA384 of {sessionId|merchantId|amount|currency|crc}
    const response = await fetch(`${baseUrl}/api/v1/transaction/register`, {
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
      redirectUrl: `${baseUrl}/trnRequest/${data.data.token}`,
      gatewayPaymentId: data.data.token,
    }
  },

  // P24 webhook requires an extra verify call after receiving notification
  async verifyWebhook(input) {
    // 1. Parse notification body
    // 2. Verify signature (SHA384)
    // 3. Call PUT /api/v1/transaction/verify to confirm
    // 4. Return WebhookEvent
  },

  mapStatus(gatewayStatus) {
    const map: Record<string, UnifiedPaymentStatus> = {
      verified: 'captured',
      error: 'failed',
      pending: 'pending',
    }
    return map[gatewayStatus] ?? 'unknown'
  },
}
```

---

## 10. Apple Pay (via Stripe/PayU)

Apple Pay is implemented as a **payment method type**, not a separate module. Both Stripe and PayU support Apple Pay natively.

### 10.1 How It Works

```
Customer chooses "Apple Pay" → gateway handles the rest

Stripe path:
  createSession({ paymentMethodTypes: ['apple_pay'] })
  → Stripe Checkout shows Apple Pay button
  → Stripe handles Apple Pay token → charges card
  → Webhook: payment_intent.succeeded

PayU path:
  createSession({ paymentMethodTypes: ['ap'] })
  → PayU shows Apple Pay option
  → PayU handles Apple Pay token → processes payment
  → Webhook: COMPLETED
```

### 10.2 Configuration

Each provider module adds an `enableApplePay` toggle to its settings fields (see §7.2 and §8.2). The adapter's `createSession` checks `settings.enableApplePay` and includes the appropriate payment method type.

No separate Apple Pay module is needed. Apple Pay domain verification (serving `/.well-known/apple-developer-merchantid-domain-association`) is handled by the Stripe/PayU documentation — the merchant uploads the file to the frontend `public/` directory.

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

### 11.2 Validation

The status sync engine validates transitions. Invalid transitions (e.g., `captured → pending`) are rejected and logged but do not crash — idempotent by design.

---

## 12. Webhook Architecture

### 12.1 Flow

```
Gateway sends webhook
  → POST /api/payment-gateways/webhook/{provider}    (core module endpoint)
  → Core resolves tenant, loads settings
  → Core calls adapter.verifyWebhook()               (provider module code)
  → Core checks idempotency
  → Core enqueues job to 'payment-gateway-webhook' queue
  → Worker picks up job
  → Worker calls adapter.mapStatus()                  (provider module code)
  → Worker calls core syncPaymentStatus()             (core module code)
  → SalesPayment updated, events emitted
```

The provider module only implements two webhook-related methods: `verifyWebhook()` and `mapStatus()`. Everything else is handled by the core.

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

  // 1. Find GatewayTransaction by gateway payment ID
  const transaction = await ctx.em.findOne(GatewayTransaction, {
    gatewayPaymentId: event.gatewayPaymentId,
    organizationId: tenantContext.organizationId,
  })
  if (!transaction) return

  // 2. Map gateway event to unified status (resolve tenant's selected API version)
  const version = await ctx.integrationState.resolveApiVersion(
    `gateway_${providerKey}`,
    { organizationId: tenantContext.organizationId, tenantId: tenantContext.tenantId },
  )
  const adapter = getGatewayAdapter(providerKey, version)!
  const newStatus = adapter.mapStatus(event.data.status as string, event.eventType)
  if (newStatus === 'unknown') return

  // 3. Sync status (core engine handles SalesPayment update + events)
  await syncPaymentStatus(transaction.paymentId, newStatus, {
    gatewayPaymentId: event.gatewayPaymentId,
    gatewayStatus: event.data.status as string,
    capturedAmount: extractCapturedAmount(providerKey, event),
    refundedAmount: extractRefundedAmount(providerKey, event),
    rawResponse: event.data,
  }, { em: ctx.em, ...tenantContext })
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

// Checks pending/authorized transactions older than 15 min without webhook updates
export default async function handler(job: Job, ctx: WorkerContext) {
  const staleTransactions = await ctx.em.find(GatewayTransaction, {
    unifiedStatus: { $in: ['pending', 'authorized'] },
    lastWebhookAt: { $lt: new Date(Date.now() - 15 * 60 * 1000) },
    organizationId: job.data.organizationId,
  }, { limit: 50 })

  for (const transaction of staleTransactions) {
    const version = await ctx.integrationState.resolveApiVersion(
      `gateway_${transaction.providerKey}`,
      { organizationId: transaction.organizationId, tenantId: transaction.tenantId },
    )
    const adapter = getGatewayAdapter(transaction.providerKey, version)
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

All UMES extensions live in the **core** `payment_gateways` module because they are provider-agnostic — they read from `GatewayTransaction` regardless of which provider created it.

### 13.1 "Pay via Gateway" Button (Widget Injection)

```typescript
// payment_gateways/widgets/injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  'detail:sales.document:actions': {
    widgetId: 'payment_gateways.injection.pay-button',
    priority: 40,
  },
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
          _gateway: t ? {
            providerKey: t.providerKey,
            unifiedStatus: t.unifiedStatus,
            gatewayStatus: t.gatewayStatus,
            gatewayPaymentId: t.gatewayPaymentId,
            lastWebhookAt: t.lastWebhookAt,
          } : undefined,
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
          captured: 'success', authorized: 'info', pending: 'warning',
          failed: 'destructive', refunded: 'muted', cancelled: 'ghost',
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

      if (method?.providerKey) {
        const adapter = getGatewayAdapter(method.providerKey)
        if (adapter && !method.providerSettings) {
          return {
            ok: false,
            message: `Payment method "${method.name}" requires gateway configuration.`,
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

### 14.1 GatewayTransaction (New Entity — Core Module)

See Section 6.3. Owned by `payment_gateways` core module. All providers write to it via the core's status sync engine.

### 14.2 SalesPayment — No Schema Changes

All gateway data flows through existing fields:
- `metadata.gateway` — provider, status, transaction ID, last sync timestamp
- `paymentReference` — gateway payment ID
- `status` — mapped from unified status
- `capturedAmount` / `refundedAmount` — updated by status sync
- `receivedAt` / `capturedAt` — set on status transitions

### 14.3 SalesPaymentMethod — No Schema Changes

- `providerKey` — links to adapter registry
- `providerSettings` — stores gateway credentials (encrypted at rest)

---

## 15. API Contracts

All API routes are in the **core** `payment_gateways` module. Provider modules have no API routes.

### 15.1 Create Payment Session

```
POST /api/payment-gateways/sessions
Authorization: Bearer <token>

{
  "orderId": "order-uuid",
  "paymentMethodId": "method-uuid",
  "successUrl": "https://shop.example.com/payment/success",
  "cancelUrl": "https://shop.example.com/payment/cancel",
  "paymentMethodTypes": ["card", "apple_pay"],
  "locale": "pl"
}

→ 201: { "sessionId", "redirectUrl", "gatewayPaymentId", "paymentId", "transactionId" }
```

### 15.2 Capture / Refund / Cancel

```
POST /api/payment-gateways/capture   { "paymentId", "amount?" }
POST /api/payment-gateways/refund    { "paymentId", "amount?", "reason?" }
POST /api/payment-gateways/cancel    { "paymentId" }
```

### 15.3 Query Status

```
GET /api/payment-gateways/status?paymentId=<uuid>
→ 200: { "unifiedStatus", "gatewayStatus", "providerKey", ... }
```

### 15.4 Webhook (Dynamic)

```
POST /api/payment-gateways/webhook/stripe
POST /api/payment-gateways/webhook/payu
POST /api/payment-gateways/webhook/przelewy24
POST /api/payment-gateways/webhook/<any-registered-provider>
```

No auth. Signature verified by the provider's adapter.

---

## 16. Security & Compliance

### 16.1 PCI DSS

Open Mercato **never handles card data directly**. All integrations use redirect-based checkout (Stripe Checkout, PayU hosted form, P24 redirect). SAQ-A compliance level.

### 16.2 Credential Storage

- Provider settings (`SalesPaymentMethod.providerSettings`) encrypted at rest via existing encryption
- Gateway API keys MUST NOT appear in logs, API responses, or error messages
- Webhook secrets stored as `type: 'secret'` — rendered as password fields in UI

### 16.3 Webhook Security

- Each adapter implements its own signature verification scheme
- Replay attack prevention via timestamp validation + idempotency keys
- Rate limiting per tenant via core webhook handler

### 16.4 Multi-Tenant Isolation

- `GatewayTransaction` scoped by `organizationId` + `tenantId`
- Webhook processing resolves tenant from gateway metadata
- Provider settings are per-tenant (different Stripe accounts per tenant)

---

## 17. Integration Marketplace Alignment (SPEC-045)

This spec is the **first hub module** in the Integration Marketplace framework defined by SPEC-045. The following changes apply:

### 17.1 `integration.ts` Convention File

Each provider module (`gateway_stripe`, `gateway_payu`, `gateway_przelewy24`) MUST declare an `integration.ts` file alongside its `index.ts`. This file registers the provider in the centralized integration marketplace at `/backend/integrations`.

```typescript
// gateway_stripe/integration.ts
export const integration: IntegrationDefinition = {
  id: 'gateway_stripe',
  title: 'Stripe',
  description: 'Accept card payments, Apple Pay, and Google Pay via Stripe Checkout.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'stripe',
  icon: 'stripe',
  package: '@open-mercato/gateway-stripe',
  tags: ['cards', 'apple-pay', 'google-pay', 'checkout'],
  apiVersions: [
    {
      id: '2024-12-18',
      label: 'v2024-12-18 (latest)',
      status: 'stable',
      default: true,
      changelog: 'Payment Intents v2, improved error codes, enhanced refund metadata',
    },
    {
      id: '2023-10-16',
      label: 'v2023-10-16',
      status: 'deprecated',
      deprecatedAt: '2025-06-01',
      sunsetAt: '2026-12-01',
      migrationGuide: 'https://docs.stripe.com/upgrades#2024-12-18',
      changelog: 'Legacy Payment Intents API',
    },
  ],
  credentials: {
    fields: [
      { key: 'publishableKey', label: 'Publishable Key', type: 'text', required: true },
      { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'secret', required: true },
    ],
  },
}
```

### 17.2 Credential Storage Migration

API keys and webhook secrets move from `SalesPaymentMethod.providerSettings` to the unified `IntegrationCredentials` entity (SPEC-045 §7). Provider adapters resolve credentials via the `integrationCredentials` DI service:

```typescript
const creds = await integrationCredentials.resolve('gateway_stripe', { organizationId, tenantId })
const stripe = new Stripe(creds.secretKey as string)
```

`SalesPaymentMethod.providerSettings` continues to hold per-method configuration (capture method, enabled payment types, success/cancel URLs) that is not a secret.

### 17.3 Enable/Disable via Marketplace

The `IntegrationState` entity (SPEC-045 §12.2) provides per-tenant enable/disable. When an integration is disabled, `getGatewayAdapter()` returns `undefined` for that provider, and the core module gracefully skips it in UI, webhooks, and API calls.

### 17.4 Health Check

Each provider module MAY implement `HealthCheckable` to validate API key connectivity. For Stripe, this calls `stripe.accounts.retrieve()` with the configured secret key. The health status is displayed on the integration detail page in the marketplace.

### 17.5 Admin Panel Integration

- **Credentials**: Configured at `/backend/integrations/gateway_stripe` (marketplace detail page)
- **Per-method config**: Configured at `/backend/sales/payment-methods` (existing page, unchanged)
- **Cross-link**: The integration detail page links to the payment methods page

---

## 18. SPEC-041 Improvement Suggestions

Based on analyzing how this payment architecture uses UMES:

### 18.1 Webhook Extension Point (Missing)

UMES covers UI, data enrichment, and API interception but has no pattern for **incoming webhooks from external services**. Consider adding a standardized webhook declaration with auto-discovery, shared verification utilities, and a common idempotency layer.

### 18.2 Enricher Caching (Performance)

If many modules add enrichers to the same entity, cumulative latency adds up. Add an optional `cache` property to `ResponseEnricher` with TTL and tag-based invalidation via the existing `@open-mercato/cache` package.

### 18.3 Interceptor Data Dependencies

API interceptors often need to load related entities (e.g., payment method settings). Consider a `preload` declaration on `ApiInterceptor` to avoid manual entity queries in every interceptor.

### 18.4 Worker Extension Point

UMES has no way for one module to extend another module's background processing. Consider adding worker-level extension points for post-processing hooks.

### 18.5 Lazy Enrichment Mode

Some enrichment data is expensive but rarely viewed. Add `mode: 'eager' | 'lazy'` to enrichers so clients opt-in to expensive data via `?enrich=gateway`.

### 18.6 Typed Extension Point Discovery

Generate a typed manifest of all extension points during `yarn generate` for IDE autocompletion when writing injection tables.

---

## 19. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gateway SDK breaking changes | Medium | Pin SDK versions per provider module; provider-specific integration tests; versioned adapters isolate API changes |
| Webhook delivery failure | High | Status polling worker as fallback; webhook retry tolerance |
| Multi-tenant webhook routing | High | Store org/tenant in gateway metadata; verify on receipt |
| Credential exposure in logs | Critical | Never log settings; sanitize error messages; use encryption |
| Race condition: webhook + poll | Medium | Idempotent status sync; skip if status unchanged |
| Provider module not installed | Low | Core gracefully handles missing adapters (404 on webhook, skip in UI) |
| UMES Phase 3/4/5 not yet implemented | High | Phase 1 (widget injection) works today; full integration requires UMES phases |
| Provider module breaks core | Low | Adapters are called via try/catch; failures isolated to that provider |
| Multiple providers for same gateway | Low | Adapter registry uses `Map.set` — last registration wins; log warning |

---

## 20. Integration Test Coverage

### 20.1 Core Module Tests

| Test | Method | Path | Assert |
|------|--------|------|--------|
| Create session (mock adapter) | POST | `/api/payment-gateways/sessions` | Creates SalesPayment + GatewayTransaction, returns redirectUrl |
| Create session — unknown provider | POST | `/api/payment-gateways/sessions` | 422 error |
| Capture | POST | `/api/payment-gateways/capture` | capturedAmount updated, status → captured |
| Refund (partial) | POST | `/api/payment-gateways/refund` | refundedAmount updated, status → partially_refunded |
| Refund (full) | POST | `/api/payment-gateways/refund` | status → refunded |
| Cancel | POST | `/api/payment-gateways/cancel` | status → cancelled |
| Invalid transition | POST | `/api/payment-gateways/capture` on captured payment | 422 |
| Webhook — valid signature | POST | `/api/payment-gateways/webhook/mock` | Status synced |
| Webhook — invalid signature | POST | `/api/payment-gateways/webhook/mock` | 401 |
| Webhook — duplicate event | POST | `/api/payment-gateways/webhook/mock` | 200, no double-processing |
| Webhook — unknown provider | POST | `/api/payment-gateways/webhook/unknown` | 404 |
| Status polling | Worker | — | Stale transactions updated via adapter.getStatus() |
| Enricher | GET | `/api/sales/payments` | `_gateway` field present on enriched payments |
| Version resolution — default | POST | `/api/payment-gateways/sessions` | Uses default adapter version when tenant has no version selected |
| Version resolution — explicit | POST | `/api/payment-gateways/sessions` | Uses adapter matching tenant's selected `apiVersion` |
| Version fallback | POST | `/api/payment-gateways/sessions` | Falls back to default adapter if selected version is not registered |

### 20.2 Per-Provider Module Tests

Each provider module should include tests for:

| Test | Assert |
|------|--------|
| Adapter.createSession with valid settings | Returns sessionId + redirectUrl |
| Adapter.verifyWebhook with valid signature | Returns parsed WebhookEvent |
| Adapter.verifyWebhook with invalid signature | Throws |
| Adapter.mapStatus for all gateway statuses | Correct UnifiedPaymentStatus mapping |
| Adapter.capture | CaptureResult with correct amounts |
| Adapter.refund (full + partial) | RefundResult with correct amounts |

These tests should mock the gateway HTTP API (no real Stripe/PayU calls in CI).

---

## 21. Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial draft |
| 2026-02-24 | Split from monolithic to core + plugin architecture — provider modules are independent |
| 2026-02-24 | Added §17 Integration Marketplace Alignment — credentials move to SPEC-045 `IntegrationCredentials`, provider modules declare `integration.ts` |
| 2026-02-24 | Added API versioning support: adapter registry is version-aware, gateway service resolves tenant's selected version, Stripe module restructured with `lib/shared.ts` + `lib/adapters/v*.ts` pattern, `integration.ts` declares `apiVersions` |
