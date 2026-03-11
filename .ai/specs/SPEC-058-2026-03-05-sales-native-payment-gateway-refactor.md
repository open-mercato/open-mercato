# SPEC-058 — Sales Payment Gateway Refactor, Pay Links & Payment Transactions Hub

| Field | Value |
|---|---|
| Status | Draft |
| Author | Codex |
| Created | 2026-03-05 |
| Updated | 2026-03-11 |
| Related | SPEC-044, SPEC-045c, SPEC-045h, sales module |

---

## TLDR

Refactor sales payments to use `payment_gateways` natively, add a **Pay Links** feature for collecting payments from customers outside e-commerce, introduce **Wire Transfer** and **Cash** gateway providers for offline/manual payments, build a first-class **Payment Transactions** management page, and deeply integrate payment navigation into the order detail UX.

---

## Overview

This spec covers five interconnected capabilities that together create a complete payment lifecycle for B2B/B2C commerce:

1. **Gateway-Native Refactor** — Sales uses `payment_gateways` as the single payment execution layer (original SPEC-058 scope).
2. **Payment Transactions Hub** — A dedicated page for viewing, filtering, and acting on all payment transactions across orders.
3. **Offline Payment Providers** — Two built-in gateway providers for manual/offline payments:
   - **Wire Transfer** — Bank transfer with admin-managed status transitions.
   - **Cash** — Cash, check, or other in-person payments with instant confirmation.
4. **Pay Links** — Generate shareable payment links that let customers choose a payment method and pay for an order without logging in.
5. **Unified Order Payment UX** — Redesigned payments section on the order detail page with pay link management, transaction deep links, and outstanding-amount prominence.

---

## Problem Statement

### Current Gaps

1. **No way to collect payment for off-platform orders.** When a merchant creates an order by phone, email, or in-person, there is no mechanism to send the customer a payment link. The merchant must either collect payment separately and manually record it, or ask the customer to log in.

2. **Wire/bank transfers are invisible.** Many B2B transactions use wire transfers, but the system has no payment method that models this flow — show bank details, wait for transfer, manually confirm receipt.

3. **Cash and in-person payments have no home.** POS transactions, cash payments, and check payments are common in B2B but the system has no dedicated method to record them with proper categorization and receipt tracking.

4. **Payment transactions are buried.** Payments only appear as a small section within each order. There is no cross-order view for finance teams to review all payment activity, filter by status, or batch-process pending wire transfers.

5. **Order-to-payment navigation is weak.** From an order, you see payment rows but cannot deep-link into transaction details, view gateway data, or see a payment timeline.

6. **Legacy credential duplication.** Sales still uses `providerSettings` for payment secrets instead of the unified `IntegrationCredentials` store.

---

## Proposed Solution

### Architecture Summary

```
┌──────────────────────────────────────────────────────────────┐
│                    SALES MODULE                              │
│                                                              │
│  SalesOrder ──→ SalesPayment ──→ GatewayTransaction          │
│       │              │                    ↑                   │
│       │              │         ┌──────────┘                   │
│       ↓              ↓         │                              │
│  PaymentsSection  PayLink   payment_gateways hub             │
│  (order detail)  (public     ┌───┴────────┐                  │
│                   checkout)  │            │                   │
│                        Online          Offline                │
│                      ┌──┴──┐        ┌────┴────┐              │
│                    Stripe  PayU  WireTransfer  Cash           │
│                    P24           (manual)    (instant)        │
└──────────────────────────────────────────────────────────────┘
```

**Key decisions:**

- **Pay Links live in the `sales` module** — they are a sales concern (collecting payment for an order). They use the `payment_gateways` service for payment execution, following the same pattern as public quote acceptance (`SalesQuote.acceptanceToken`).
- **Wire Transfer and Cash are gateway provider packages** (`packages/gateway-wire-transfer`, `packages/gateway-cash`) — this keeps the architecture uniform. All payment methods go through the same adapter contract. Wire transfer creates a pending transaction and displays bank details (status transitions are manual). Cash creates an immediately-captured transaction (payment confirmed at point of collection).
- **Payment Transactions page lives in `sales`** — it shows `SalesPayment` records enriched with gateway data, not raw `GatewayTransaction` records. This is the merchant's view, not infrastructure.
- **Online vs Offline distinction** — Online providers (Stripe, PayU, P24) redirect the customer to an external checkout. Offline providers (Wire Transfer, Cash) are confirmed by the merchant. Pay links present both categories but with different UX: online methods show a "Pay Now" button, offline methods show instructions or immediate confirmation.

---

## Phases

| Phase | Scope | Dependencies |
|-------|-------|-------------|
| **Phase 1** | Gateway-Native Refactor | SPEC-044, SPEC-045c |
| **Phase 2** | Payment Transactions Hub | Phase 1 |
| **Phase 3a** | Wire Transfer Provider | Phase 1 |
| **Phase 3b** | Cash Payment Provider | Phase 1 |
| **Phase 4** | Pay Links | Phase 1, Phase 3a |
| **Phase 5** | Unified Order Payment UX | Phase 2, Phase 3a, Phase 3b, Phase 4 |

---

## Phase 1 — Gateway-Native Refactor

### Goal

Refactor `sales` to use `payment_gateways` and provider modules as first-class payment execution infrastructure. Remove all legacy credential bridges.

### 1.1 Data Contract Changes

**`SalesPayment` additions:**

| Field | Type | Purpose |
|-------|------|---------|
| `gatewayTransactionId` | `uuid` (nullable, unique FK) | Links to `GatewayTransaction` for gateway-backed payments. Null for manual/legacy payments. |
| `source` | `text` (default `'manual'`) | Discriminator: `'manual'` (admin-recorded), `'gateway'` (provider-processed), `'pay_link'` (customer-initiated via link) |

**`SalesPaymentMethod` cleanup:**

- `providerKey` remains (links to integration provider).
- `metadata` stores non-secret config only (capture mode, allowed types, display config).
- All secrets read from `IntegrationCredentials` exclusively.

### 1.2 Command Flow

1. `sales.payments.create` creates `SalesPayment` with `source: 'manual'`.
2. `sales.payments.createGatewaySession` creates `SalesPayment` + calls `paymentGatewayService.createSession()` → persists `GatewayTransaction` → sets `gatewayTransactionId`.
3. Capture/refund/cancel delegated through `paymentGatewayService`.
4. Gateway status events (`payment_gateways.transaction.status_changed`) → sales subscriber → updates `SalesPayment` status and amounts via command.

### 1.3 Webhook & Polling Integration

1. Payment gateway webhook/poller updates emit `payment_gateways.transaction.status_changed`.
2. Sales subscriber `sales/subscribers/gateway-status-sync.ts` consumes events and applies command-based state transitions.
3. Subscriber is idempotent — checks current status before applying transition. Monotonic status rules prevent regression.

### 1.4 Legacy Removal

1. Remove `providerSettings` secret reads from sales runtime.
2. Remove legacy fallback paths in gateway execution.
3. Single credential source: `IntegrationCredentials`.

---

## Phase 2 — Payment Transactions Hub

### Goal

Provide a dedicated backend page for finance teams to view, filter, search, and act on all payment transactions across orders.

### 2.1 New Backend Page

**Route:** `/backend/sales/payment-transactions`
**Feature gate:** `sales.payments.manage`

#### List View

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Payment Transactions                                                    │
├──────────────────────────────────────────────────────────────────────────┤
│  [Search...          ]  [Status ▾]  [Method ▾]  [Source ▾]  [Dates ▾]   │
├───────┬────────────┬─────────────┬──────────┬───────────┬───────┬───────┤
│  Ref  │  Order     │  Method     │  Status  │  Amount   │  Date │       │
├───────┼────────────┼─────────────┼──────────┼───────────┼───────┼───────┤
│  #142 │  ORD-0042  │  Stripe     │  ● Paid  │  $1,250   │  3/9  │ [↗]  │
│  #141 │  ORD-0042  │  Wire       │  ○ Pend  │  $890     │  3/8  │ [↗]  │
│  #140 │  ORD-0039  │  PayU       │  ● Paid  │  $2,100   │  3/7  │ [↗]  │
│  #139 │  ORD-0038  │  Stripe     │  ↺ Refd  │  $450     │  3/6  │ [↗]  │
└───────┴────────────┴─────────────┴──────────┴───────────┴───────┴───────┘
│                                                         1-4 of 142      │
└──────────────────────────────────────────────────────────────────────────┘
```

**Columns:** Reference, Order (clickable link → order detail), Payment Method, Status (colored badge), Amount (formatted with currency), Source (manual/gateway/pay_link icon), Received Date, Row Actions.

**Filters:**
- Status (multi-select from payment-statuses dictionary)
- Payment Method (multi-select)
- Source (`manual` / `gateway` / `pay_link`)
- Date range (received at)
- Order number (text search)

**Row Actions:**
- **View details** → opens payment transaction detail panel
- **Mark as received** (wire transfer only, pending status) → confirms bank transfer
- **Capture** (gateway, authorized status) → captures authorized payment
- **Refund** (gateway, captured status) → initiates refund
- **Go to order** → navigates to parent order

### 2.2 Payment Transaction Detail Panel

Clicking a payment row or the [↗] icon opens a slide-over detail panel (not a new page — keeps list context):

```
┌──────────────────────────────────────────────────────────┐
│  Payment #142                                        [×] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Status     ● Captured                             │  │
│  │  Amount     $1,250.00 USD                          │  │
│  │  Captured   $1,250.00                              │  │
│  │  Refunded   $0.00                                  │  │
│  │  Method     Credit Card (Stripe)                   │  │
│  │  Source     Gateway                                │  │
│  │  Reference  pi_3MxABC123...                        │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Order                                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │  ORD-2024-0042  →  Acme Corp  │  $2,140.00       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Timeline                                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Mar 9  14:32   ● Captured ($1,250.00)             │  │
│  │  Mar 9  14:31   ○ Authorized                       │  │
│  │  Mar 9  14:30   ○ Session created (pay link)       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Actions                                                 │
│  [Refund]  [View in Provider Dashboard ↗]                │
│                                                          │
│  Gateway Details                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Provider        Stripe                            │  │
│  │  Session ID      pi_3MxABC123...                   │  │
│  │  Provider Status succeeded                         │  │
│  │  Last Webhook    Mar 9, 14:32                      │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Wire transfer variant** replaces "Gateway Details" with "Bank Transfer Details" and shows "Mark as Received" / "Cancel" actions instead of refund.

### 2.3 Payment Timeline

The timeline shows a chronological log of payment state changes. Data source: combination of `SalesPayment` audit trail and `GatewayTransaction` status history.

**New entity: `SalesPaymentEvent`**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | PK |
| `paymentId` | uuid (FK) | Parent payment |
| `eventType` | text | `created`, `authorized`, `captured`, `refunded`, `cancelled`, `failed`, `marked_received`, `link_sent`, `link_opened` |
| `description` | text (nullable) | Human-readable detail |
| `metadata` | jsonb (nullable) | Provider-specific data (webhook event ID, etc.) |
| `createdAt` | timestamp | When the event occurred |
| `organizationId`, `tenantId` | uuid | Tenant scoping |

Events are appended by payment commands and gateway status sync subscriber. Never mutated or deleted.

### 2.4 API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sales/payment-transactions` | List all payments (query engine, filters, enrichment) |
| `GET` | `/api/sales/payment-transactions/[id]` | Payment detail with timeline and gateway data |
| `POST` | `/api/sales/payment-transactions/[id]/mark-received` | Manual confirmation for wire transfers |
| `POST` | `/api/sales/payment-transactions/[id]/capture` | Delegate capture to gateway |
| `POST` | `/api/sales/payment-transactions/[id]/refund` | Delegate refund to gateway (amount param for partial) |
| `POST` | `/api/sales/payment-transactions/[id]/cancel` | Delegate cancel to gateway |

The `/payment-transactions` endpoints wrap `SalesPayment` with enrichment from `GatewayTransaction` and `SalesPaymentEvent` data. They do not duplicate the existing `/sales/payments` CRUD — that remains for basic create/update/delete. The transactions endpoints are read-heavy with action dispatch.

### 2.5 Navigation: Sidebar Menu

Add "Payment Transactions" as a menu item under the Sales section in the backend sidebar:

```
Sales
  ├── Orders
  ├── Quotes
  ├── Invoices
  ├── Payment Transactions  ← NEW
  └── Settings
```

Feature gate: `sales.payments.manage`.

---

## Phase 3a — Wire Transfer Provider

### Goal

Provide a built-in payment gateway provider for bank wire transfers, enabling merchants to offer wire transfer as a payment option with manual status management.

### 3a.1 Package Structure

**Package:** `packages/gateway-wire-transfer`
**npm name:** `@open-mercato/gateway-wire-transfer`

```
packages/gateway-wire-transfer/
├── src/
│   └── modules/
│       └── gateway_wire_transfer/
│           ├── index.ts              # metadata
│           ├── integration.ts        # IntegrationDefinition
│           ├── di.ts                 # register adapter in DI
│           ├── setup.ts             # seed payment method
│           ├── lib/
│           │   ├── adapter.ts        # GatewayAdapter implementation
│           │   └── health.ts         # Health check (always healthy)
│           ├── data/
│           │   └── entities.ts       # (none needed - uses hub entities)
│           └── widgets/
│               └── injection/
│                   └── WireTransferConfig.tsx  # Bank details config widget
├── package.json
└── tsconfig.json
```

### 3a.2 Integration Definition

```typescript
// integration.ts
export const integration: IntegrationDefinition = {
  id: 'gateway-wire-transfer',
  title: 'Wire Transfer / Bank Transfer',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'wire-transfer',
  description: 'Accept payments via bank wire transfer with manual confirmation',
  credentials: {
    fields: [
      { key: 'bankName', label: 'Bank Name', type: 'text', required: true },
      { key: 'accountHolder', label: 'Account Holder Name', type: 'text', required: true },
      { key: 'iban', label: 'IBAN', type: 'text', required: true },
      { key: 'bic', label: 'BIC / SWIFT Code', type: 'text', required: false },
      { key: 'accountNumber', label: 'Account Number', type: 'text', required: false,
        description: 'For regions that do not use IBAN' },
      { key: 'routingNumber', label: 'Routing Number', type: 'text', required: false,
        description: 'US bank routing number (ABA)' },
      { key: 'instructions', label: 'Additional Instructions', type: 'textarea', required: false,
        description: 'Custom text shown to the customer (e.g., include order number as reference)' },
    ],
  },
}
```

### 3a.3 Gateway Adapter

The wire transfer adapter implements `GatewayAdapter` with minimal behavior — no external API calls:

| Method | Behavior |
|--------|----------|
| `createSession()` | Creates `GatewayTransaction` with `pending` status. Returns bank details as `sessionData` (displayed to customer). Generates payment reference from order number. |
| `capturePayment()` | Transitions to `captured` status. Used by "Mark as Received" action. |
| `refundPayment()` | Transitions to `refunded` status. (Record-keeping only — actual bank refund is manual.) |
| `cancelPayment()` | Transitions to `cancelled` status. |
| `getPaymentStatus()` | Returns current status from local `GatewayTransaction`. |
| `verifyWebhook()` | Not applicable — returns null. |
| `mapStatus()` | Identity mapping — status names match unified status. |

### 3a.4 Bank Details Display

When a customer selects wire transfer (via pay link, Phase 4), or when an admin views a wire transfer payment detail, the bank details are displayed:

```
┌────────────────────────────────────────────────────┐
│  Wire Transfer Details                             │
│                                                    │
│  Bank           First National Bank                │
│  Account Holder Acme Commerce Ltd                  │
│  IBAN           PL61 1090 1014 0000 0712 1981 23   │
│  BIC / SWIFT    WBKPPLPP                           │
│                                                    │
│  Payment Reference (include in transfer):          │
│  ┌──────────────────────────────────────────┐      │
│  │  ORD-2024-0042                      [📋] │      │
│  └──────────────────────────────────────────┘      │
│                                                    │
│  ⓘ Include this reference so we can match your     │
│    payment. Allow 1-3 business days for processing.│
└────────────────────────────────────────────────────┘
```

Bank details are read from `IntegrationCredentials` at render time (not stored in the transaction). The payment reference is generated as `{orderNumberPrefix}-{orderNumber}` and stored in `GatewayTransaction.providerData.paymentReference`.

### 3a.5 Health Check

Always returns healthy — no external service dependency. Validates that bank credentials are configured (IBAN or account number present).

---

## Phase 3b — Cash Payment Provider

### Goal

Provide a built-in gateway provider for cash, check, and other in-person/offline payments. Unlike wire transfer (which is pending until the bank transfer arrives), cash payments are confirmed immediately at the point of collection.

### 3b.1 Package Structure

**Package:** `packages/gateway-cash`
**npm name:** `@open-mercato/gateway-cash`

```
packages/gateway-cash/
├── src/
│   └── modules/
│       └── gateway_cash/
│           ├── index.ts              # metadata
│           ├── integration.ts        # IntegrationDefinition
│           ├── di.ts                 # register adapter in DI
│           ├── setup.ts             # seed payment method
│           ├── lib/
│           │   ├── adapter.ts        # GatewayAdapter implementation
│           │   └── health.ts         # Health check (always healthy)
│           └── widgets/
│               └── injection/
│                   └── CashPaymentConfig.tsx  # Config widget (receipt settings)
├── package.json
└── tsconfig.json
```

### 3b.2 Integration Definition

```typescript
// integration.ts
export const integration: IntegrationDefinition = {
  id: 'gateway-cash',
  title: 'Cash / In-Person Payment',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'cash',
  description: 'Record cash, check, or other in-person payments with instant confirmation',
  credentials: {
    fields: [
      { key: 'acceptedTypes', label: 'Accepted Payment Types', type: 'text', required: false,
        description: 'Comma-separated list shown to customers (e.g., "Cash, Check, Money Order"). Defaults to "Cash".' },
      { key: 'receiptPrefix', label: 'Receipt Number Prefix', type: 'text', required: false,
        description: 'Prefix for auto-generated receipt numbers (e.g., "RCP"). Defaults to "CASH".' },
      { key: 'instructions', label: 'Collection Instructions', type: 'textarea', required: false,
        description: 'Instructions shown to customer on pay link (e.g., "Pay at our office: 123 Main St, Mon-Fri 9-5")' },
    ],
  },
}
```

### 3b.3 Gateway Adapter

The cash adapter implements `GatewayAdapter` with **instant capture** semantics — the most common flow for in-person payments is that the merchant collects cash and records it, so the transaction goes directly to `captured`:

| Method | Behavior |
|--------|----------|
| `createSession()` | Creates `GatewayTransaction` with `captured` status (instant capture). Generates receipt number (`{receiptPrefix}-{timestamp-short}`). Stores receipt number in `providerData.receiptNumber`. |
| `capturePayment()` | No-op — already captured at creation. Returns current status. |
| `refundPayment()` | Transitions to `refunded` status. (Record-keeping — actual cash refund is physical.) |
| `cancelPayment()` | Transitions to `cancelled` status. Reverses the captured amount. |
| `getPaymentStatus()` | Returns current status from local `GatewayTransaction`. |
| `verifyWebhook()` | Not applicable — returns null. |
| `mapStatus()` | Identity mapping — status names match unified status. |

**Key difference from Wire Transfer:** Cash creates transactions in `captured` state immediately (payment already received), while Wire Transfer creates in `pending` state (waiting for bank transfer to arrive).

### 3b.4 Cash Payment Recording

**From Order Detail** (admin records cash payment inline):

When the admin clicks "Record Payment" and selects "Cash" as the payment method, the standard PaymentDialog opens. The command flow:

1. `sales.payments.createGatewaySession` with `providerKey: 'cash'`.
2. Cash adapter `createSession()` → immediately `captured`.
3. `SalesPayment` created with `source: 'gateway'`, status = captured, `capturedAmount` = amount.
4. Order totals updated immediately — outstanding decreases.
5. Receipt number generated and stored.

**From Pay Link** (customer-facing):

When cash is offered on a pay link (useful for "pay at pickup" scenarios), the public checkout page shows:

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  Cash / In-Person Payment                                  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Amount Due: $742.50 USD                             │  │
│  │                                                      │  │
│  │  Please bring the exact amount to:                   │  │
│  │                                                      │  │
│  │  Acme Commerce Ltd                                   │  │
│  │  123 Main Street, Suite 200                          │  │
│  │  Mon-Fri 9:00 AM - 5:00 PM                          │  │
│  │                                                      │  │
│  │  Reference your order number:                        │  │
│  │  ┌────────────────────────────────────────────┐      │  │
│  │  │  ORD-2024-0042                        [📋] │      │  │
│  │  └────────────────────────────────────────────┘      │  │
│  │                                                      │  │
│  │  Accepted: Cash, Check, Money Order                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ⓘ Your order will be marked as paid once we receive       │
│    your payment in person.                                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

Note: When initiated from a pay link, cash does **not** auto-capture (unlike the admin flow). Instead it creates a `pending` transaction because the customer hasn't actually paid yet — they've only seen the instructions. The admin later marks it as received, similar to wire transfer. The adapter detects pay link context via `sessionData.source === 'pay_link'` and adjusts initial status accordingly.

### 3b.5 Transaction Detail (Cash Variant)

In the Payment Transaction Detail panel, cash payments show:

```
┌──────────────────────────────────────────────────────────┐
│  Payment #143                                        [×] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Status     ● Captured                             │  │
│  │  Amount     $500.00 USD                            │  │
│  │  Method     Cash                                   │  │
│  │  Source     Gateway                                │  │
│  │  Receipt #  CASH-20260309-A7F2                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Order                                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │  ORD-2024-0042  →  Acme Corp  │  $2,140.00       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Timeline                                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Mar 9  15:45   ● Payment received (cash)          │  │
│  │                    Receipt: CASH-20260309-A7F2      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Actions                                                 │
│  [Refund]  [Cancel]                                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 3b.6 Health Check

Always returns healthy — no external service dependency. No credentials validation needed (all fields are optional display config).

---

## Phase 4 — Pay Links

### Goal

Enable merchants to generate shareable payment links for orders, allowing customers to pay without logging in by selecting from available payment methods.

### 4.1 Data Model

**New entity: `SalesPayLink`**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | PK |
| `orderId` | uuid (FK → SalesOrder) | Target order |
| `token` | text (unique, indexed) | URL-safe token for public access (`crypto.randomBytes(32).toString('hex')`) |
| `status` | text | `active`, `expired`, `completed`, `cancelled` |
| `amount` | numeric(18,4) | Payment amount (typically = order outstanding amount at creation time) |
| `currencyCode` | text | Payment currency |
| `allowedMethodIds` | jsonb (nullable) | Optional restriction: array of `SalesPaymentMethod` IDs. Null = all active methods. |
| `expiresAt` | timestamp (nullable) | Auto-expiry. Null = no expiry. |
| `customerEmail` | text (nullable) | Email for sending the link |
| `sentAt` | timestamp (nullable) | When link was emailed |
| `completedAt` | timestamp (nullable) | When payment was completed through this link |
| `paymentId` | uuid (nullable, FK → SalesPayment) | Linked once payment is completed |
| `metadata` | jsonb (nullable) | Custom data, notes |
| `createdBy` | uuid (nullable) | Admin user who created the link |
| `organizationId`, `tenantId` | uuid | Tenant scoping |
| `createdAt`, `updatedAt`, `deletedAt` | timestamp | Standard timestamps |

**Index:** `UNIQUE(token)`, `INDEX(orderId, status)`

### 4.2 Pay Link Lifecycle

```
  [Create]         [Send Email]       [Customer Opens]     [Customer Pays]
     │                  │                    │                     │
     ▼                  ▼                    ▼                     ▼
   active ──────── active ──────────── active ──────────── completed
     │                                                            │
     │ (manual cancel)                              (creates SalesPayment
     ▼                                               + GatewayTransaction)
  cancelled
     │ (expiry worker)
     ▼
   expired
```

- A pay link is **single-use** — once a payment completes through it, status becomes `completed`.
- Multiple active pay links can exist for the same order (different amounts, methods).
- An expiry background worker marks expired links. Short polling interval (every 5 minutes).

### 4.3 API Endpoints

**Admin (authenticated):**

| Method | Path | Purpose | Feature |
|--------|------|---------|---------|
| `POST` | `/api/sales/pay-links` | Create pay link | `sales.payments.manage` |
| `GET` | `/api/sales/pay-links` | List pay links (filterable by orderId) | `sales.orders.view` |
| `GET` | `/api/sales/pay-links/[id]` | Get pay link detail | `sales.orders.view` |
| `DELETE` | `/api/sales/pay-links/[id]` | Cancel pay link | `sales.payments.manage` |
| `POST` | `/api/sales/pay-links/[id]/send` | Send pay link via email | `sales.payments.manage` |

**Public (no auth, token-based):**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sales/pay/[token]` | Validate token, return order summary + available payment methods |
| `POST` | `/api/sales/pay/[token]/initiate` | Initiate payment: create SalesPayment + gateway session, return redirect URL or bank details |

### 4.4 Pay Link Creation Dialog

Triggered from "Send Pay Link" button on order detail:

```
┌──────────────────────────────────────────────────────┐
│  Send Pay Link                                   [×] │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Amount                                              │
│  [$1,250.00 USD              ]  (pre-filled from     │
│                                  outstanding amount)  │
│                                                      │
│  Payment Methods                                     │
│  ┌────────────────────────────────────────────────┐  │
│  │  ☑  Credit / Debit Card (Stripe)               │  │
│  │  ☑  Wire Transfer                              │  │
│  │  ☑  Cash / In-Person                           │  │
│  │  ☐  PayU                                       │  │
│  └────────────────────────────────────────────────┘  │
│  All active methods selected by default              │
│                                                      │
│  Expires After                                       │
│  [7 days                     ▾]                      │
│  Options: 24 hours, 3 days, 7 days, 30 days, Never   │
│                                                      │
│  ── Send via Email (optional) ────────────────────   │
│                                                      │
│  Customer Email                                      │
│  [john@example.com           ]                       │
│  (pre-filled from order contact if available)        │
│                                                      │
│  Message (optional)                                  │
│  [Hi John, here is the payment link for your order.] │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │     [Copy Link]     [Create & Send Email]    │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│                   Cmd+Enter to send · Esc to cancel   │
└──────────────────────────────────────────────────────┘
```

**Behavior:**
- "Copy Link" creates the pay link and copies URL to clipboard (no email sent).
- "Create & Send Email" creates the pay link, sends email, and copies URL to clipboard.
- If no email is entered, only "Copy Link" is shown.
- Amount is editable (partial payment links are supported).

### 4.5 Public Checkout Page

**Route:** `sales/frontend/pay/[token]/page.tsx`
**Metadata:** `requireAuth: false`

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│                      [Company Logo]                        │
│                                                            │
│           Payment for Order #ORD-2024-0042                 │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Order Summary                                       │  │
│  │                                                      │  │
│  │  Ergonomic Keyboard × 2              $500.00         │  │
│  │  Wireless Mouse × 1                  $150.00         │  │
│  │  Shipping                             $25.00         │  │
│  │  Tax                                  $67.50         │  │
│  │  ────────────────────────────────────────────         │  │
│  │  Total Due                          $742.50          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  Select Payment Method                                     │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Credit / Debit Card                                 │  │
│  │  Pay securely via Stripe                        [→]  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Wire Transfer                                       │  │
│  │  Bank transfer with payment reference           [→]  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Cash / In-Person                                    │  │
│  │  Pay at our location                            [→]  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Powered by Open Mercato                             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Flow by method type:**

**Card (Stripe/PayU/P24):**
1. Customer clicks payment method card.
2. Frontend calls `POST /api/sales/pay/[token]/initiate` with `{ methodId }`.
3. Backend creates `SalesPayment` (source: `pay_link`) + calls gateway `createSession()`.
4. Response includes `redirectUrl` (Stripe Checkout, PayU payment page, etc.).
5. Customer is redirected to provider.
6. After payment, provider redirects to success/failure page.
7. Webhook updates payment status → pay link marked `completed`.

**Wire Transfer:**
1. Customer clicks wire transfer card.
2. Frontend calls `POST /api/sales/pay/[token]/initiate` with `{ methodId }`.
3. Backend creates `SalesPayment` (source: `pay_link`) + calls wire-transfer adapter `createSession()`.
4. Response includes `bankDetails` object (no redirect needed).
5. Frontend renders bank details view with payment reference and copy button.
6. Admin later marks payment as received from the transactions page.

**Cash / In-Person:**
1. Customer clicks cash/in-person card.
2. Frontend calls `POST /api/sales/pay/[token]/initiate` with `{ methodId }`.
3. Backend creates `SalesPayment` (source: `pay_link`) + calls cash adapter `createSession()` in pay-link mode → `pending` status.
4. Response includes `collectionDetails` object (instructions, accepted types, location).
5. Frontend renders collection instructions with order reference.
6. Admin later marks payment as received when customer pays in person.

### 4.6 Pay Link States Display

**Success page** (after gateway redirect):
```
┌────────────────────────────────────────────┐
│           [Company Logo]                   │
│                                            │
│        ✓  Payment Successful               │
│                                            │
│  Your payment of $742.50 for order         │
│  #ORD-2024-0042 has been received.         │
│                                            │
│  You will receive a confirmation email     │
│  shortly.                                  │
│                                            │
└────────────────────────────────────────────┘
```

**Wire transfer confirmation page:**
```
┌────────────────────────────────────────────┐
│           [Company Logo]                   │
│                                            │
│        Wire Transfer Details               │
│                                            │
│  Please transfer $742.50 USD to:           │
│                                            │
│  Bank:      First National Bank            │
│  IBAN:      PL61 1090 1014 ...             │
│  BIC:       WBKPPLPP                       │
│  Holder:    Acme Commerce Ltd              │
│                                            │
│  Payment Reference:                        │
│  ┌──────────────────────────────────┐      │
│  │  ORD-2024-0042              [📋] │      │
│  └──────────────────────────────────┘      │
│                                            │
│  Include this reference in your wire       │
│  transfer. Processing takes 1-3 business   │
│  days.                                     │
│                                            │
└────────────────────────────────────────────┘
```

**Expired/cancelled/already-used link:**
```
┌────────────────────────────────────────────┐
│           [Company Logo]                   │
│                                            │
│        This link is no longer valid.       │
│                                            │
│  This payment link has expired / been      │
│  cancelled / already been used.            │
│                                            │
│  Please contact the merchant for a new     │
│  payment link.                             │
│                                            │
└────────────────────────────────────────────┘
```

### 4.7 Email Template

**Template file:** `sales/emails/PayLinkEmail.tsx`

Email includes:
- Company name / logo
- Order summary (number, total, line items)
- Prominent "Pay Now" button linking to `{baseUrl}/pay/{token}`
- Expiry notice if applicable
- Optional custom message from the merchant
- Unbranded footer

### 4.8 Events

| Event ID | Trigger | `clientBroadcast` |
|----------|---------|-------------------|
| `sales.pay_link.created` | Pay link created | false |
| `sales.pay_link.sent` | Email sent | true |
| `sales.pay_link.opened` | Customer opens link | true |
| `sales.pay_link.completed` | Payment completed | true |
| `sales.pay_link.expired` | Expiry worker triggered | false |
| `sales.pay_link.cancelled` | Admin cancels link | false |

`clientBroadcast: true` events enable real-time UI updates — when a customer pays via a pay link, the order detail page updates automatically if the admin is viewing it.

### 4.9 Notifications

| Type | When | Severity | Action |
|------|------|----------|--------|
| `sales.pay_link.completed` | Customer pays via link | `success` | View order |
| `sales.pay_link.opened` | Customer opens link | `info` | View order |

### 4.10 ACL Features

| Feature | Description |
|---------|-------------|
| `sales.pay_links.manage` | Create, cancel, send pay links |
| `sales.pay_links.view` | View pay link list and details |

---

## Phase 5 — Unified Order Payment UX

### Goal

Redesign the payments section on the order detail page to integrate pay links, provide deep transaction navigation, and give outstanding-amount prominence.

### 5.1 Order Header: Payment Status Badge

Add a payment status indicator to the order header, next to the order status:

```
┌──────────────────────────────────────────────────────────────────┐
│  Order #ORD-2024-0042                                            │
│  Status: Confirmed        Payment: ⚠ Partially Paid ($500 due)  │
└──────────────────────────────────────────────────────────────────┘
```

**Badge states:**

| State | Condition | Style |
|-------|-----------|-------|
| `Paid` | `outstandingAmount == 0` and `paidTotalAmount > 0` | Green badge |
| `Partially Paid` | `outstandingAmount > 0` and `paidTotalAmount > 0` | Yellow badge with amount |
| `Pending` | `paidTotalAmount == 0` and pending payments exist | Yellow badge |
| `Unpaid` | `paidTotalAmount == 0` and no pending payments | Gray badge |
| `Refunded` | `refundedTotalAmount > 0` and fully refunded | Red badge |
| `Overpaid` | `paidTotalAmount > grandTotal` | Blue badge with excess |

### 5.2 Redesigned Payments Section

```
┌──────────────────────────────────────────────────────────────────┐
│  Payments                         [Record Payment] [Send Pay Link]│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Summary                                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Order Total     $1,250.00                                 │  │
│  │  Paid              $750.00    (1 payment captured)         │  │
│  │  Pending           $500.00    (1 wire transfer awaiting)   │  │
│  │  Outstanding         $0.00    ✓                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Payment Records                                                 │
│  ┌───────┬──────────┬──────────┬──────────┬───────┬───────────┐  │
│  │  Ref  │  Method  │  Status  │  Amount  │  Date │           │  │
│  ├───────┼──────────┼──────────┼──────────┼───────┼───────────┤  │
│  │  #142 │  Stripe  │  ● Paid  │  $750.00 │  3/9  │  [↗] [⋮] │  │
│  │  #141 │  Wire    │  ○ Pend  │  $500.00 │  3/8  │  [↗] [⋮] │  │
│  └───────┴──────────┴──────────┴──────────┴───────┴───────────┘  │
│                                                                  │
│  Pay Links                                                       │
│  ┌────────────────┬──────────┬──────────┬───────┬─────────────┐  │
│  │  Link          │  Status  │  Expires │  Sent │             │  │
│  ├────────────────┼──────────┼──────────┼───────┼─────────────┤  │
│  │  /pay/a8f3...  │ ● Active │  Mar 16  │  Yes  │  [📋] [⋮]  │  │
│  └────────────────┴──────────┴──────────┴───────┴─────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Key UX decisions:**

1. **Summary first** — the payment summary (totals) appears at the top, before individual records. Finance users care about the bottom line first.

2. **[↗] deep link** — clicking the arrow icon on a payment row opens the transaction detail panel (same as Phase 2). This reuses the `PaymentTransactionDetail` panel component.

3. **[⋮] row actions** — contextual actions based on payment state:
   - Pending wire transfer: "Mark as Received", "Cancel", "Edit"
   - Captured cash payment: "Refund", "Cancel", "View Details"
   - Captured gateway payment: "Refund", "View Details"
   - Manual payment: "Edit", "Delete"

4. **Pay Links sub-table** — shows active pay links for this order with:
   - Truncated link (clickable → copies full URL)
   - Status badge
   - Expiry date
   - Whether email was sent
   - [📋] copy link, [⋮] cancel link / resend email

5. **"Send Pay Link" button** — opens the pay link creation dialog (Phase 4.4).

6. **"Record Payment" button** — opens the existing PaymentDialog for manual payment entry (unchanged).

### 5.3 Empty State

When an order has no payments and no pay links:

```
┌──────────────────────────────────────────────────────────────────┐
│  Payments                                                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     No payments yet                              │
│                                                                  │
│     Record a payment manually or send a pay link                 │
│     to the customer.                                             │
│                                                                  │
│     [Record Payment]       [Send Pay Link]                       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.4 Real-Time Updates

When a customer pays via a pay link while the admin has the order open:

1. `sales.pay_link.completed` event (with `clientBroadcast: true`) arrives via SSE.
2. `useAppEvent('sales.pay_link.completed')` handler in `PaymentsSection` triggers a data reload.
3. Summary totals, payment records, and pay link status all update without page refresh.
4. A subtle flash message: "Payment received via pay link" (success toast).

---

## Data Model Summary

### New Entities

| Entity | Table | Module | Phase |
|--------|-------|--------|-------|
| `SalesPaymentEvent` | `sales_payment_events` | sales | 2 |
| `SalesPayLink` | `sales_pay_links` | sales | 4 |

### Modified Entities

| Entity | Changes | Phase |
|--------|---------|-------|
| `SalesPayment` | Add `gatewayTransactionId`, `source` | 1 |

### External Entities (used, not owned)

| Entity | Module | Usage |
|--------|--------|-------|
| `GatewayTransaction` | payment_gateways | Linked from SalesPayment |
| `IntegrationCredentials` | integrations | Wire transfer bank details, cash config |

---

## API Paths Affected

### Phase 1 (Gateway Refactor)
- `POST /api/sales/payments` — updated to support gateway session creation
- `POST /api/payment-gateways/sessions` — called by sales
- `POST /api/payment-gateways/capture`
- `POST /api/payment-gateways/refund`
- `POST /api/payment-gateways/cancel`
- `GET /api/payment-gateways/status`

### Phase 2 (Payment Transactions Hub)
- `GET /api/sales/payment-transactions` — new
- `GET /api/sales/payment-transactions/[id]` — new
- `POST /api/sales/payment-transactions/[id]/mark-received` — new
- `POST /api/sales/payment-transactions/[id]/capture` — new
- `POST /api/sales/payment-transactions/[id]/refund` — new
- `POST /api/sales/payment-transactions/[id]/cancel` — new

### Phase 3a (Wire Transfer)
- `POST /api/payment-gateways/webhook/wire-transfer` — no-op (placeholder for consistency)

### Phase 3b (Cash)
- No additional API routes — uses standard gateway session endpoints. Cash adapter handles `createSession` via `POST /api/payment-gateways/sessions`.

### Phase 4 (Pay Links)
- `POST /api/sales/pay-links` — new
- `GET /api/sales/pay-links` — new
- `GET /api/sales/pay-links/[id]` — new
- `DELETE /api/sales/pay-links/[id]` — new
- `POST /api/sales/pay-links/[id]/send` — new
- `GET /api/sales/pay/[token]` — new (public, no auth)
- `POST /api/sales/pay/[token]/initiate` — new (public, no auth)

---

## ACL Features

| Feature | Phase | Description |
|---------|-------|-------------|
| `sales.payments.manage` | 1 | Create, update, delete payments; access transactions page |
| `sales.pay_links.manage` | 4 | Create, cancel, send pay links |
| `sales.pay_links.view` | 4 | View pay link list/details |

---

## Integration Test Coverage (Required)

### Phase 1 — Gateway Refactor
1. Create sales payment → create gateway session → `GatewayTransaction` linked to `SalesPayment`.
2. Capture from gateway endpoint updates `SalesPayment` captured state and amounts.
3. Refund flow updates `SalesPayment` refunded state and amounts.
4. Webhook-driven success/failure transitions update sales payment status via subscriber.
5. Payment method config uses integration credentials only.
6. Tenant isolation across all sales + payment gateway operations.

### Phase 2 — Transactions Hub
7. Payment transactions list page loads with correct filters and enrichment.
8. Payment transaction detail panel shows timeline events.
9. "Mark as received" action transitions wire transfer payment to captured.
10. Capture/refund/cancel actions from transactions page delegate to gateway correctly.
11. Order link from transaction navigates to correct order.

### Phase 3a — Wire Transfer
12. Wire transfer integration can be installed and configured with bank details.
13. Wire transfer `createSession` creates pending transaction with payment reference.
14. Admin "Mark as Received" transitions wire transfer to captured and updates order totals.
15. Wire transfer health check passes when bank details are configured.

### Phase 3b — Cash
16. Cash integration can be installed and configured with receipt prefix and accepted types.
17. Cash `createSession` from admin flow creates immediately-captured transaction with receipt number.
18. Cash `createSession` from pay link flow creates pending transaction (awaiting in-person collection).
19. Admin "Mark as Received" transitions pay-link-initiated cash payment to captured.
20. Cash payment cancel reverses captured amount and updates order totals.
21. Cash health check always passes.

### Phase 4 — Pay Links
22. Create pay link for order → returns valid token and URL.
23. Public pay link page renders order summary and available methods (including wire transfer and cash).
24. Card payment through pay link creates SalesPayment + GatewayTransaction and redirects.
25. Wire transfer through pay link shows bank details with payment reference.
26. Cash through pay link shows collection instructions and order reference.
27. Pay link email sends correctly with payment URL.
28. Expired pay link returns appropriate error page.
29. Completed pay link cannot be reused.
30. Pay link events emit correctly (created, sent, opened, completed).
31. Real-time update: pay link completion triggers order detail refresh.

### Phase 5 — Order UX
32. Order header shows correct payment status badge.
33. Payments section renders summary, payment records, and pay link tables.
34. Deep link from payment row opens transaction detail panel.
35. Pay link management (create, copy, cancel, resend) works from order detail.

All tests must be self-contained and clean up created records.

---

## Migration & Backward Compatibility

### Phase 1
- Release note: sales payment gateway path is now integration-native only.
- Migration script to move active credentials from `providerSettings` to `IntegrationCredentials`.
- Explicit cutover checklist in rollout docs.
- New fields on `SalesPayment` (`gatewayTransactionId`, `source`) have defaults and are nullable — no breaking change.

### Phase 2
- New `SalesPaymentEvent` table — additive only.
- New API endpoints — no existing endpoints changed.
- New sidebar menu item gated behind existing `sales.payments.manage` feature.

### Phase 3a
- New npm package (`@open-mercato/gateway-wire-transfer`) — opt-in installation.
- No changes to existing entities or contracts.

### Phase 3b
- New npm package (`@open-mercato/gateway-cash`) — opt-in installation.
- No changes to existing entities or contracts.
- Cash adapter uses dual-mode status logic (instant capture for admin, pending for pay link) — no schema impact.

### Phase 4
- New `SalesPayLink` table — additive only.
- New ACL features (`sales.pay_links.manage`, `sales.pay_links.view`) — must be added to `defaultRoleFeatures` in `setup.ts`.
- Public routes use token-based access — no auth changes.
- Email sending uses existing `sendEmail` infrastructure.

### Phase 5
- UI-only changes to order detail page.
- Payment status badge is computed from existing fields — no schema change.
- Pay links sub-table only renders when Phase 4 is active.

---

## Risks

| Risk | Severity | Area | Mitigation | Residual Risk |
|------|----------|------|------------|---------------|
| Incomplete credential migration before Phase 1 cutover | High | Payments | Pre-cutover validator + blocking health checks | Low — validator prevents deployment |
| Divergent sales/payment statuses | High | Data integrity | Command-driven transitions + invariant tests + monotonic status rules | Low |
| Webhook ordering/retries cause wrong final status | Medium | Payment state | Idempotency keys + monotonic transition rules | Low |
| Pay link token brute-force | Medium | Security | 64-char hex tokens (256-bit entropy), rate limiting on public endpoint | Very low |
| Pay link email deliverability | Medium | UX | Use existing Resend infrastructure, add delivery tracking event | Low — existing infra proven |
| Wire transfer marked as received for wrong amount | Medium | Finance | Pre-fill amount, require confirmation dialog, audit trail via `SalesPaymentEvent` | Low |
| Cash payment recorded without actual collection | Medium | Finance | Receipt number generation for audit trail, admin-only instant capture, pay-link flow stays pending until confirmed | Low |
| Public checkout page abuse (enumeration, DoS) | Medium | Security | Rate limiting, token validation before any DB reads, no PII in error responses | Low |
| Expired pay link race condition (customer starts payment, link expires mid-flow) | Low | UX | Check expiry at initiation time, not at page load. Gateway session has its own timeout. | Very low |
| Multiple active pay links for same order cause overpayment | Low | Finance | Outstanding amount check at initiation time. Warning in UI when creating link for fully-covered order. | Very low |

---

## Final Compliance Report

| Check | Status |
|-------|--------|
| No direct ORM relationships between modules | PASS — SalesPayment references GatewayTransaction by ID, no ORM relation |
| All inputs validated with zod | PASS — all new endpoints use zod validators |
| Tenant isolation (`organization_id` filter) | PASS — all entities and queries scoped |
| Public endpoints use token-based access, no PII leakage | PASS — token validated before data access |
| Event IDs follow `module.entity.action` convention | PASS — `sales.pay_link.created` etc. |
| New features gated behind ACL features | PASS — `sales.pay_links.manage`, `sales.pay_links.view` |
| Backward compatibility: no contract surface broken | PASS — all changes additive |
| Command pattern for write operations | PASS — pay link CRUD, mark-received, capture/refund via commands |
| No raw fetch — uses apiCall | PASS — all UI code uses apiCall |
| Keyboard UX: Cmd+Enter submit, Esc cancel | PASS — pay link dialog follows convention |
| Search indexing configured | PASS — payment transactions use query engine |
| Integration tests specified | PASS — 35 test cases covering all phases |

---

## Changelog

| Date | Change |
|---|---|
| 2026-03-05 | Initial draft created for sales-native payment gateway refactor |
| 2026-03-11 | Major expansion: added Pay Links (Phase 4), Wire Transfer Provider (Phase 3a), Cash Payment Provider (Phase 3b), Payment Transactions Hub (Phase 2), Unified Order Payment UX (Phase 5). Added UI designs, data models, API contracts, events, ACL features, 35 integration test cases. Restructured into 6 phases. |
