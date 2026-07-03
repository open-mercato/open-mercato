# Step 3 — Adapter, status mapping, and credential-resolving client

Read `../references/adapter-contracts.md` for the full type definitions per category. Implement
the adapter under `src/modules/<module_id>/lib/adapters/v<version>.ts`.

## 3.1 Payment Gateway (`GatewayAdapter`)

```typescript
// lib/adapters/v<version>.ts
import type { GatewayAdapter, CreateSessionInput, CreateSessionResult } from '@open-mercato/shared/modules/payment_gateways/types'
import { createClient } from '../client'

export class MyGatewayAdapter implements GatewayAdapter {
  readonly providerKey = '<provider>'

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> { /* ... */ }
  async capture(input: CaptureInput): Promise<CaptureResult> { /* ... */ }
  async refund(input: RefundInput): Promise<RefundResult> { /* ... */ }
  async cancel(input: CancelInput): Promise<CancelResult> { /* ... */ }
  async getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus> { /* ... */ }
  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> { /* ... */ }
  mapStatus(providerStatus: string, eventType?: string): UnifiedPaymentStatus { /* ... */ }
}
```

**DI registration** (in `di.ts`):

```typescript
import { registerGatewayAdapter, registerWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import { MyGatewayAdapter } from './lib/adapters/v2025'

export function register(container: AppContainer): void {
  const adapter = new MyGatewayAdapter()
  registerGatewayAdapter(adapter, { version: '2025-01-01' })
  registerWebhookHandler('<provider>', (input) => adapter.verifyWebhook(input), { queue: '<provider>-webhook' })
}
```

## 3.2 Shipping Carrier (`ShippingAdapter`)

```typescript
import type { ShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'

export class MyShippingAdapter implements ShippingAdapter {
  readonly providerKey = '<provider>'

  async calculateRates(input): Promise<ShippingRate[]> { /* ... */ }
  async createShipment(input): Promise<CreateShipmentResult> { /* ... */ }
  async getTracking(input): Promise<TrackingResult> { /* ... */ }
  async cancelShipment(input): Promise<{ status: UnifiedShipmentStatus }> { /* ... */ }
  async verifyWebhook(input): Promise<ShippingWebhookEvent> { /* ... */ }
  mapStatus(carrierStatus: string): UnifiedShipmentStatus { /* ... */ }
}
```

## 3.3 Data Sync (`DataSyncAdapter`)

```typescript
import type { DataSyncAdapter, StreamImportInput, ImportBatch } from '@open-mercato/core/modules/data_sync/lib/adapter'

export class MySyncAdapter implements DataSyncAdapter {
  readonly providerKey = '<provider>'
  readonly direction = 'import' // or 'export' | 'bidirectional'
  readonly supportedEntities = ['products', 'customers']

  async *streamImport(input: StreamImportInput): AsyncIterable<ImportBatch> {
    let cursor = input.cursor
    let hasMore = true
    let batchIndex = 0
    while (hasMore) {
      const page = await this.fetchPage(input.entityType, cursor, input.credentials)
      yield { items: page.items, cursor: page.nextCursor, hasMore: page.hasMore, batchIndex }
      cursor = page.nextCursor
      hasMore = page.hasMore
      batchIndex++
    }
  }

  async getMapping(input): Promise<DataMapping> { /* ... */ }
  async validateConnection(input): Promise<ValidationResult> { /* ... */ }
}
```

## 3.4 Status mapping

Every adapter MUST implement provider → unified status mapping with an `'unknown'` fallback:

```typescript
// lib/status-map.ts
const STATUS_MAP: Record<string, UnifiedPaymentStatus> = {
  'provider_pending': 'pending',
  'provider_paid': 'captured',
  'provider_refunded': 'refunded',
  // ... map ALL provider statuses
}

export function mapProviderStatus(providerStatus: string): UnifiedPaymentStatus {
  return STATUS_MAP[providerStatus] ?? 'unknown'
}
```

## 3.5 Credential-resolving client factory

```typescript
// lib/client.ts
export function createClient(credentials: Record<string, unknown>) {
  const apiKey = credentials.secretKey as string
  if (!apiKey) throw new Error('[internal] Missing secretKey credential')
  return new ProviderSDK(apiKey)
}
```

**MUST**: Never store or cache credentials — resolve them fresh from the `credentials` parameter
on every call. Credentials are encrypted at rest by the `IntegrationCredentials` service; never
persist raw secrets yourself and never log them.

Proceed to `step-4-webhooks-health-widgets.md`.
