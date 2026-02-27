# SPEC-045h — Stripe Payment Gateway: Reference Provider Implementation

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Hub**: [SPEC-045c — Payment & Shipping Hubs](./SPEC-045c-payment-shipping-hubs.md)
**Foundation**: [SPEC-045a — Foundation](./SPEC-045a-foundation.md) (credentials, logs, widget injection)

---

## Goal

Build the `gateway_stripe` provider module as the **reference payment gateway implementation** — demonstrating `GatewayAdapter` contract, versioned adapters, webhook processing, widget injection for configuration, and integration with the marketplace admin panel.

---

## 1. Problem Statement

| Problem | Consequence |
|---------|-------------|
| No reference payment integration exists | Developers lack a pattern to follow for building new gateways |
| Payment config scattered | Capture mode, payment types, webhook secrets stored in different places |
| No real-time webhook processing | Payment status changes delayed until manual sync |
| No integration-level logging | Payment failures hidden in server logs, not visible to admins |

---

## 2. Integration Definition

```typescript
// gateway_stripe/integration.ts

export const integration: IntegrationDefinition = {
  id: 'gateway_stripe',
  title: 'Stripe',
  description: 'Accept card payments, Apple Pay, Google Pay, and bank transfers via Stripe.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'stripe',
  icon: 'stripe',
  docsUrl: 'https://docs.stripe.com',
  package: '@open-mercato/gateway-stripe',
  version: '1.0.0',
  author: 'Open Mercato Team',
  license: 'MIT',
  tags: ['cards', 'apple-pay', 'google-pay', 'bank-transfer', 'checkout'],
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
      { key: 'publishableKey', label: 'Publishable Key', type: 'text', required: true, placeholder: 'pk_live_...' },
      { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
      { key: 'webhookSecret', label: 'Webhook Signing Secret', type: 'secret', required: true, placeholder: 'whsec_...' },
    ],
  },
  healthCheck: { service: 'stripeHealthCheck' },
}
```

---

## 3. Module Structure

```
packages/core/src/modules/gateway_stripe/
├── index.ts                    # Module metadata
├── integration.ts              # IntegrationDefinition (§2)
├── acl.ts                      # gateway_stripe.view, .configure
├── setup.ts                    # Register adapters, payment provider, webhook handler
├── di.ts                       # Stripe client, health check service
├── lib/
│   ├── shared.ts               # Common logic shared across API versions
│   ├── client.ts               # Stripe SDK wrapper with credential resolution
│   ├── status-map.ts           # Stripe status → unified payment status
│   ├── adapters/
│   │   ├── v2024-12-18.ts      # GatewayAdapter for Stripe API 2024-12-18
│   │   └── v2023-10-16.ts      # GatewayAdapter for Stripe API 2023-10-16
│   ├── webhook-handler.ts      # Webhook signature verification + event dispatch
│   └── health.ts               # HealthCheckable — stripe.accounts.retrieve()
├── data/
│   └── validators.ts           # Zod schemas for Stripe-specific config
├── workers/
│   └── webhook-processor.ts    # Async webhook event processing
├── widgets/
│   ├── injection-table.ts      # Inject config widget into integration detail page
│   └── injection/
│       └── stripe-config/
│           ├── widget.ts       # Widget metadata + event handlers
│           └── widget.client.tsx  # Capture mode + payment type config UI
└── i18n/
    ├── en.ts
    └── pl.ts
```

---

## 4. GatewayAdapter Implementation

### 4.1 Adapter Contract (from SPEC-044 / SPEC-045c)

```typescript
interface GatewayAdapter {
  readonly providerKey: string

  /** Create a payment session / payment intent */
  createSession(input: CreateSessionInput): Promise<PaymentSession>

  /** Capture an authorized payment */
  capturePayment(input: CaptureInput): Promise<CaptureResult>

  /** Refund a captured payment (full or partial) */
  refundPayment(input: RefundInput): Promise<RefundResult>

  /** Cancel / void an authorized payment before capture */
  cancelPayment(input: CancelInput): Promise<CancelResult>

  /** Get current payment status from provider */
  getPaymentStatus(input: GetStatusInput): Promise<PaymentStatusResult>

  /** Verify and parse an inbound webhook event */
  verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent>

  /** Map provider status to unified status */
  mapStatus(providerStatus: string, eventType?: string): UnifiedPaymentStatus
}
```

### 4.2 Versioned Adapter — v2024-12-18

```typescript
// gateway_stripe/lib/adapters/v2024-12-18.ts

export const stripeAdapterV20241218: GatewayAdapter = {
  providerKey: 'stripe',

  async createSession(input) {
    const stripe = await resolveStripeClient(input.credentials, '2024-12-18')

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(input.amount * 100),  // Stripe expects cents
      currency: input.currencyCode.toLowerCase(),
      capture_method: input.captureMethod ?? 'automatic',
      metadata: {
        orderId: input.orderId,
        tenantId: input.tenantId,
      },
      payment_method_types: input.paymentTypes ?? ['card'],
      description: input.description,
    })

    return {
      sessionId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret!,
      status: mapStripeStatus(paymentIntent.status),
      providerData: { paymentIntentId: paymentIntent.id },
    }
  },

  async capturePayment(input) {
    const stripe = await resolveStripeClient(input.credentials, '2024-12-18')

    const captured = await stripe.paymentIntents.capture(input.sessionId, {
      amount_to_capture: input.amount ? Math.round(input.amount * 100) : undefined,
    })

    return {
      status: mapStripeStatus(captured.status),
      capturedAmount: captured.amount_received / 100,
      providerData: { chargeId: captured.latest_charge },
    }
  },

  async refundPayment(input) {
    const stripe = await resolveStripeClient(input.credentials, '2024-12-18')

    const refund = await stripe.refunds.create({
      payment_intent: input.sessionId,
      amount: input.amount ? Math.round(input.amount * 100) : undefined,
      reason: mapRefundReason(input.reason),
      metadata: input.metadata,
    })

    return {
      refundId: refund.id,
      status: refund.status === 'succeeded' ? 'refunded' : 'pending',
      refundedAmount: refund.amount / 100,
    }
  },

  async cancelPayment(input) {
    const stripe = await resolveStripeClient(input.credentials, '2024-12-18')

    const cancelled = await stripe.paymentIntents.cancel(input.sessionId, {
      cancellation_reason: 'requested_by_customer',
    })

    return {
      status: mapStripeStatus(cancelled.status),
    }
  },

  async getPaymentStatus(input) {
    const stripe = await resolveStripeClient(input.credentials, '2024-12-18')

    const pi = await stripe.paymentIntents.retrieve(input.sessionId)
    return {
      status: mapStripeStatus(pi.status),
      amount: pi.amount / 100,
      amountReceived: pi.amount_received / 100,
      currencyCode: pi.currency.toUpperCase(),
    }
  },

  async verifyWebhook(input) {
    return verifyStripeWebhook(input)  // Shared across versions
  },

  mapStatus: mapStripeStatus,  // Shared across versions
}
```

### 4.3 Status Mapping

```typescript
// gateway_stripe/lib/status-map.ts

const STRIPE_STATUS_MAP: Record<string, UnifiedPaymentStatus> = {
  'requires_payment_method': 'pending',
  'requires_confirmation': 'pending',
  'requires_action': 'pending',
  'processing': 'processing',
  'requires_capture': 'authorized',
  'succeeded': 'captured',
  'canceled': 'cancelled',
}

export function mapStripeStatus(stripeStatus: string): UnifiedPaymentStatus {
  return STRIPE_STATUS_MAP[stripeStatus] ?? 'unknown'
}

/** Map webhook event type → unified status */
const WEBHOOK_EVENT_MAP: Record<string, UnifiedPaymentStatus> = {
  'payment_intent.succeeded': 'captured',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'cancelled',
  'payment_intent.requires_action': 'pending',
  'charge.refunded': 'refunded',
  'charge.refund.updated': 'refunded',
  'charge.dispute.created': 'disputed',
  'charge.dispute.closed': 'captured',  // Dispute resolved in merchant's favor
}

export function mapWebhookEventToStatus(eventType: string): UnifiedPaymentStatus | undefined {
  return WEBHOOK_EVENT_MAP[eventType]
}

/** Map refund reason to Stripe's expected values */
function mapRefundReason(reason?: string): 'duplicate' | 'fraudulent' | 'requested_by_customer' | undefined {
  switch (reason) {
    case 'duplicate': return 'duplicate'
    case 'fraud': return 'fraudulent'
    default: return 'requested_by_customer'
  }
}
```

---

## 5. Webhook Processing

### 5.1 Webhook Signature Verification

```typescript
// gateway_stripe/lib/webhook-handler.ts

export async function verifyStripeWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
  const stripe = new Stripe(input.credentials.secretKey as string)

  const event = stripe.webhooks.constructEvent(
    input.rawBody,
    input.headers['stripe-signature']!,
    input.credentials.webhookSecret as string,
  )

  return {
    eventType: event.type,
    eventId: event.id,
    data: event.data.object as Record<string, unknown>,
    idempotencyKey: event.id,
    timestamp: new Date(event.created * 1000),
  }
}
```

### 5.2 Webhook Worker

```typescript
// gateway_stripe/workers/webhook-processor.ts

export const metadata: WorkerMeta = {
  queue: 'stripe-webhook',
  id: 'stripe-webhook-processor',
  concurrency: 5,
}

export default async function handler(job: Job, ctx: WorkerContext) {
  const { event, scope } = job.data
  const log = ctx.integrationLog.scoped('gateway_stripe', event.idempotencyKey, scope)

  await log.info('webhook.received', `Received ${event.eventType}`, {
    stripeEventId: event.eventId,
    eventType: event.eventType,
  })

  const newStatus = mapWebhookEventToStatus(event.eventType)
  if (!newStatus) {
    await log.debug('webhook.skip', `Unhandled event type: ${event.eventType}`)
    return
  }

  try {
    // Find the local GatewayTransaction by Stripe PaymentIntent ID
    const paymentIntentId = event.data.id ?? event.data.payment_intent
    const transaction = await ctx.em.findOne('GatewayTransaction', {
      providerSessionId: paymentIntentId,
      organizationId: scope.organizationId,
    })

    if (!transaction) {
      await log.warning('webhook.skip', `No local transaction for PaymentIntent ${paymentIntentId}`)
      return
    }

    const previousStatus = transaction.unifiedStatus

    // Update transaction status
    await ctx.paymentGatewayService.syncTransactionStatus(transaction.id, {
      unifiedStatus: newStatus,
      providerStatus: event.eventType,
      providerData: event.data,
    })

    await log.info('webhook.processed', `Payment ${transaction.paymentId} → ${newStatus}`, {
      paymentId: transaction.paymentId,
      previousStatus,
      newStatus,
      paymentIntentId,
      amount: event.data.amount ? (event.data.amount as number) / 100 : undefined,
    })

    // Handle specific event types
    if (event.eventType === 'charge.refunded') {
      const refundAmount = (event.data.amount_refunded as number) / 100
      await log.info('webhook.refund', `Refund of ${refundAmount} on payment ${transaction.paymentId}`, {
        paymentId: transaction.paymentId,
        refundAmount,
        refundId: event.data.id,
      })
    }

    if (event.eventType === 'charge.dispute.created') {
      await log.warning('webhook.dispute', `Dispute opened on payment ${transaction.paymentId}`, {
        paymentId: transaction.paymentId,
        disputeId: event.data.id,
        reason: event.data.reason,
        amount: (event.data.amount as number) / 100,
      })
    }

  } catch (err) {
    await log.error('webhook.failed', `Failed to process ${event.eventType}: ${err.message}`, {
      error: err.message,
      stack: err.stack,
      eventData: event.data,
    })
    throw err  // Worker retries with backoff
  }
}
```

---

## 6. Widget Injection — Configuration UI

The Stripe module injects a configuration widget into the integration detail page (see [SPEC-045a §9](./SPEC-045a-foundation.md#9-widget-injection-for-integration-configuration)).

### 6.1 Injection Table

```typescript
// gateway_stripe/widgets/injection-table.ts

export const injectionTable: ModuleInjectionTable = {
  'integrations.detail:tabs': [
    {
      widgetId: 'gateway_stripe.injection.config',
      kind: 'tab',
      groupLabel: 'gateway_stripe.tabs.settings',
      priority: 100,
    },
  ],
}
```

### 6.2 Configuration Widget

```typescript
// gateway_stripe/widgets/injection/stripe-config/widget.ts

const widget: InjectionWidgetModule<IntegrationDetailContext, StripeConfigData> = {
  metadata: {
    id: 'gateway_stripe.injection.config',
    title: 'Stripe Settings',
    features: ['gateway_stripe.configure'],
    priority: 100,
  },
  Widget: StripeConfigWidget,
  eventHandlers: {
    onBeforeSave: async (data, context) => {
      if (!data.captureMethod) {
        return { ok: false, message: 'Capture method is required' }
      }
      if (!data.paymentTypes?.length) {
        return { ok: false, message: 'At least one payment type must be selected' }
      }
      return { ok: true }
    },
    onSave: async (data, context) => {
      // Save Stripe-specific settings to integration state
    },
  },
}

interface StripeConfigData {
  captureMethod: 'automatic' | 'manual'
  paymentTypes: string[]
  statementDescriptor?: string
  allowPromotionCodes?: boolean
}
```

### 6.3 Configuration UI

```
┌─────────────────────────────────────────────────────────────────────┐
│  ── Stripe Settings ───────────────────────────────────────────── │
│                                                                     │
│  Capture Method                                                     │
│  (●) Automatic — charge immediately when customer pays              │
│  ( ) Manual — authorize first, capture later (hold up to 7 days)   │
│                                                                     │
│  Payment Types                                                      │
│  [✓] Credit/Debit Cards          [✓] Apple Pay                     │
│  [✓] Google Pay                  [ ] Bank Transfers (SEPA)         │
│  [ ] Klarna (Buy Now, Pay Later) [ ] iDEAL                        │
│                                                                     │
│  Statement Descriptor                                               │
│  [MYSTORE                     ] (max 22 characters)                │
│  What appears on customer's bank statement                          │
│                                                                     │
│  Advanced                                                           │
│  [ ] Allow promotion codes on checkout                              │
│                                                                     │
│                                                          [Save]     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Health Check

```typescript
// gateway_stripe/lib/health.ts

export const stripeHealthCheck: HealthCheckable = {
  async check(credentials: Record<string, unknown>): Promise<HealthCheckResult> {
    try {
      const stripe = new Stripe(credentials.secretKey as string)
      const account = await stripe.accounts.retrieve()

      return {
        status: 'healthy',
        message: `Connected to Stripe account ${account.id}`,
        details: {
          accountId: account.id,
          businessType: account.business_type,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          country: account.country,
        },
        checkedAt: new Date(),
      }
    } catch (err) {
      return {
        status: 'unhealthy',
        message: `Stripe connection failed: ${err.message}`,
        details: { error: err.message },
        checkedAt: new Date(),
      }
    }
  },
}
```

---

## 8. Setup — Registration

```typescript
// gateway_stripe/setup.ts

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['gateway_stripe.*'],
    admin: ['gateway_stripe.view', 'gateway_stripe.configure'],
  },

  async onTenantCreated() {
    // Register versioned adapters
    registerGatewayAdapter(stripeAdapterV20241218, { version: '2024-12-18' })
    registerGatewayAdapter(stripeAdapterV20231016, { version: '2023-10-16' })

    // Register payment provider metadata (for payment method configuration)
    registerPaymentProvider({
      key: 'stripe',
      label: 'Stripe',
      supportedPaymentTypes: ['card', 'apple_pay', 'google_pay', 'sepa_debit', 'klarna', 'ideal'],
      supportsCaptureMethod: true,
      supportsRefund: true,
      supportsPartialRefund: true,
      supportsPartialCapture: true,
    })

    // Register webhook handler
    registerWebhookHandler('stripe', verifyStripeWebhook, {
      queue: 'stripe-webhook',
    })
  },
}
```

---

## 9. DI Registration

```typescript
// gateway_stripe/di.ts

export function register(container: AwilixContainer): void {
  container.register({
    stripeHealthCheck: asValue(stripeHealthCheck),
    stripeClient: asFunction(({ integrationCredentials }) => ({
      resolve: async (scope: TenantScope, apiVersion?: string) => {
        const creds = await integrationCredentials.resolve('gateway_stripe', scope)
        return new Stripe(creds.secretKey as string, {
          apiVersion: apiVersion ?? '2024-12-18',
        })
      },
    })).singleton(),
  })
}
```

---

## 10. Stripe Client Wrapper

```typescript
// gateway_stripe/lib/client.ts

/**
 * Resolve a Stripe client with the correct API version for the current tenant.
 * Uses integrationCredentials from DI + tenant's selected API version.
 */
export async function resolveStripeClient(
  credentials: Record<string, unknown>,
  apiVersion: string,
): Promise<Stripe> {
  return new Stripe(credentials.secretKey as string, {
    apiVersion,
    maxNetworkRetries: 2,
    timeout: 10_000,
  })
}
```

---

## 11. Integration Test Coverage

| Test | Method | Assert |
|------|--------|--------|
| Create payment intent | `createSession()` | PaymentIntent created in Stripe, sessionId + clientSecret returned |
| Capture authorized payment | `capturePayment()` | Amount captured, status → `captured` |
| Partial capture | `capturePayment()` with amount | Only specified amount captured |
| Full refund | `refundPayment()` | Refund created, status → `refunded` |
| Partial refund | `refundPayment()` with amount | Partial refund, remaining balance available |
| Cancel payment | `cancelPayment()` | PaymentIntent cancelled, status → `cancelled` |
| Get payment status | `getPaymentStatus()` | Current status returned with amounts |
| Webhook signature verification (valid) | `verifyWebhook()` | Event parsed correctly |
| Webhook signature verification (invalid) | `verifyWebhook()` | Throws on bad signature |
| Webhook: payment_intent.succeeded | Worker | GatewayTransaction → `captured`, logged |
| Webhook: charge.refunded | Worker | GatewayTransaction → `refunded`, refund amount logged |
| Webhook: charge.dispute.created | Worker | GatewayTransaction → `disputed`, warning logged |
| Webhook: unknown event type | Worker | Skipped, debug log written |
| Webhook: no matching transaction | Worker | Warning logged, no error thrown |
| Health check — valid credentials | `stripeHealthCheck.check()` | Returns `healthy` with account details |
| Health check — invalid credentials | `stripeHealthCheck.check()` | Returns `unhealthy` with error message |
| API version v2024-12-18 adapter | `createSession()` | Uses correct Stripe API version header |
| API version v2023-10-16 adapter | `createSession()` | Uses legacy API version |
| Config widget save — valid | Widget `onBeforeSave` | Capture method + payment types saved |
| Config widget save — empty payment types | Widget `onBeforeSave` | Returns `{ ok: false }` with error |
| Credential resolution via marketplace | `integrationCredentials.resolve('gateway_stripe', scope)` | Returns decrypted secretKey, publishableKey, webhookSecret |
| Integration logs for webhook | `integrationLog.query()` | Webhook events logged with correlation ID |
| Status mapping coverage | `mapStripeStatus()` + `mapWebhookEventToStatus()` | All Stripe statuses map to correct unified status |

---

## 12. What This Reference Implementation Demonstrates

| Pattern | Where | Reusable for |
|---------|-------|-------------|
| `integration.ts` with `apiVersions` | §2 | Any versioned integration |
| Versioned adapter files in `lib/adapters/` | §4.2 | Any API with breaking version changes |
| Status mapping (bidirectional) | §4.3 | Any provider with custom status vocabulary |
| Webhook signature verification + async worker | §5 | Any integration receiving inbound webhooks |
| Widget injection for provider config | §6 | Any integration needing custom settings UI |
| Health check implementation | §7 | Any integration with a health-checkable API |
| `IntegrationCredentials` resolution | §9, §10 | All integrations |
| `integrationLog` scoped logging | §5.2 | All integrations |
| `registerPaymentProvider()` backward compat | §8 | Payment gateways specifically |
