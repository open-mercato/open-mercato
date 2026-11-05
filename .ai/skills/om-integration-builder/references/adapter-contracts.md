# Adapter Contracts Reference

Full TypeScript type definitions for each integration hub adapter contract. Load this file during Pre-Flight to understand the interface your integration must implement.

---

## 1. IntegrationDefinition & Registry (ALL categories)

**Source**: `packages/shared/src/modules/integrations/types.ts`

Every integration MUST export an `IntegrationDefinition`. Bundle integrations also export an `IntegrationBundle`.

```typescript
export type IntegrationCategory =
  | 'payment'
  | 'shipping'
  | 'data_sync'
  | 'communication'
  | 'webhook'
  | 'storage'
  | 'other'

export type IntegrationHubId =
  | 'payment_gateways'
  | 'shipping_carriers'
  | 'data_sync'
  | 'communication_channels'
  | 'webhook_endpoints'
  | 'storage_hubs'
  | string

export type CredentialFieldType =
  | 'text'
  | 'secret'
  | 'select'
  | 'boolean'
  | 'url'
  | 'oauth'
  | 'ssh_keypair'

export interface CredentialFieldOption {
  value: string
  label: string
}

export interface CredentialFieldVisibleWhen {
  field: string
  equals: string | number | boolean
}

export interface IntegrationCredentialWebhookHelp {
  kind: 'webhook_setup'
  title: string
  summary: string
  endpointPath: string
  dashboardPathLabel: string
  steps: string[]
  events?: string[]
  localDevelopment?: {
    tunnelCommand: string
    publicUrlExample: string
    note?: string
  }
}

export interface IntegrationCredentialFieldBase {
  key: string
  label: string
  required?: boolean
  placeholder?: string
  helpText?: string
  helpDetails?: IntegrationCredentialWebhookHelp
  visibleWhen?: CredentialFieldVisibleWhen
}

export interface IntegrationCredentialFieldText extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'text' | 'secret' | 'url'>
}

export interface IntegrationCredentialFieldBoolean extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'boolean'>
}

export interface IntegrationCredentialFieldSelect extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'select'>
  options: CredentialFieldOption[]
}

export interface IntegrationCredentialFieldOauth extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'oauth'>
  authUrl?: string
  tokenUrl?: string
  scopes?: string[]
  clientIdField?: string
  clientSecretField?: string
}

export interface IntegrationCredentialFieldSshKeypair extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'ssh_keypair'>
  algorithm?: 'ed25519' | 'rsa'
  rsaBits?: 2048 | 3072 | 4096
}

export type IntegrationCredentialField =
  | IntegrationCredentialFieldText
  | IntegrationCredentialFieldBoolean
  | IntegrationCredentialFieldSelect
  | IntegrationCredentialFieldOauth
  | IntegrationCredentialFieldSshKeypair

export interface IntegrationCredentialsSchema {
  fields: IntegrationCredentialField[]
}

export interface IntegrationHealthCheckConfig {
  service: string
}

export interface ApiVersionDefinition {
  id: string
  label: string
  status: 'stable' | 'deprecated' | 'experimental'
  default?: boolean
  changelog?: string
  deprecatedAt?: string
  sunsetAt?: string
  migrationGuide?: string
}

export interface IntegrationBundle {
  id: string
  title: string
  description: string
  icon?: string
  package?: string
  version?: string
  author?: string
  credentials: IntegrationCredentialsSchema
  healthCheck?: IntegrationHealthCheckConfig
}

export interface IntegrationDefinition {
  id: string
  title: string
  icon?: string
  buildExternalUrl?: (externalId: string) => string
  bundleId?: string
  apiVersions?: ApiVersionDefinition[]
  description?: string
  category?: IntegrationCategory | string
  hub?: IntegrationHubId
  providerKey?: string
  docsUrl?: string
  package?: string
  version?: string
  author?: string
  company?: string
  license?: string
  tags?: string[]
  credentials?: IntegrationCredentialsSchema
  healthCheck?: IntegrationHealthCheckConfig
}

// Registry functions
export function registerIntegration(definition: IntegrationDefinition): void
export function registerIntegrations(definitions: IntegrationDefinition[]): void
export function registerBundle(bundle: IntegrationBundle): void
export function registerBundles(bundles: IntegrationBundle[]): void
export function clearRegisteredIntegrations(): void
export function getIntegration(integrationId: string): IntegrationDefinition | undefined
export function getAllIntegrations(): IntegrationDefinition[]
export function getBundle(bundleId: string): IntegrationBundle | undefined
export function getAllBundles(): IntegrationBundle[]
export function getBundleIntegrations(bundleId: string): IntegrationDefinition[]
export function resolveIntegrationCredentialsSchema(integrationId: string): IntegrationCredentialsSchema | undefined
export function getIntegrationTitle(integrationId: string): string
```

---

## 2. GatewayAdapter (Payment Gateways Hub)

**Source**: `packages/shared/src/modules/payment_gateways/types.ts`
**Hub**: `payment_gateways` | **Category**: `payment` | **Package prefix**: `gateway-`

```typescript
export type UnifiedPaymentStatus =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'partially_captured'
  | 'refunded'
  | 'partially_refunded'
  | 'cancelled'
  | 'failed'
  | 'expired'
  | 'unknown'

export interface GatewayAdapter {
  readonly providerKey: string
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>
  capture(input: CaptureInput): Promise<CaptureResult>
  refund(input: RefundInput): Promise<RefundResult>
  cancel(input: CancelInput): Promise<CancelResult>
  getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus>
  verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent>
  mapStatus(providerStatus: string, eventType?: string): UnifiedPaymentStatus
}

export interface CreateSessionInput {
  orderId?: string
  paymentId: string
  tenantId: string
  organizationId: string
  amount: number
  currencyCode: string
  captureMethod?: 'automatic' | 'manual'
  paymentTypes?: string[]
  description?: string
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
  credentials: Record<string, unknown>
  lineItems?: SessionLineItem[]
}

export interface SessionLineItem {
  name: string
  quantity: number
  unitAmount: number
  currencyCode: string
}

export interface CreateSessionResult {
  sessionId: string
  clientSecret?: string
  redirectUrl?: string
  status: UnifiedPaymentStatus
  providerData?: Record<string, unknown>
}

export interface CaptureInput {
  sessionId: string
  amount?: number
  credentials: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface CaptureResult {
  status: UnifiedPaymentStatus
  capturedAmount: number
  providerData?: Record<string, unknown>
}

export interface RefundInput {
  sessionId: string
  amount?: number
  reason?: string
  credentials: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface RefundResult {
  refundId: string
  status: UnifiedPaymentStatus
  refundedAmount: number
  providerData?: Record<string, unknown>
}

export interface CancelInput {
  sessionId: string
  reason?: string
  credentials: Record<string, unknown>
}

export interface CancelResult {
  status: UnifiedPaymentStatus
  providerData?: Record<string, unknown>
}

export interface GetStatusInput {
  sessionId: string
  credentials: Record<string, unknown>
}

export interface GatewayPaymentStatus {
  status: UnifiedPaymentStatus
  amount: number
  amountReceived: number
  currencyCode: string
  providerData?: Record<string, unknown>
}

export interface VerifyWebhookInput {
  rawBody: string | Buffer
  headers: Record<string, string | string[] | undefined>
  credentials: Record<string, unknown>
}

export interface WebhookEvent {
  eventType: string
  eventId: string
  data: Record<string, unknown>
  idempotencyKey: string
  timestamp: Date
}

export interface RegisterAdapterOptions {
  version?: string
}

// Registry functions
export function registerGatewayAdapter(adapter: GatewayAdapter, options?: RegisterAdapterOptions): () => void
export function getGatewayAdapter(providerKey: string, version?: string): GatewayAdapter | undefined
export function listGatewayAdapters(): GatewayAdapter[]
export function clearGatewayAdapters(): void
export function registerWebhookHandler(
  providerKey: string,
  handler: (input: VerifyWebhookInput) => Promise<WebhookEvent>,
  options?: { queue?: string },
): () => void
export function getWebhookHandler(providerKey: string): WebhookHandlerRegistration | undefined
export function clearWebhookHandlers(): void
```

---

## 3. ShippingAdapter (Shipping Carriers Hub)

**Source**: `packages/core/src/modules/shipping_carriers/lib/adapter.ts`
**Hub**: `shipping_carriers` | **Category**: `shipping` | **Package prefix**: `carrier-`

```typescript
export type UnifiedShipmentStatus =
  | 'label_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed_delivery'
  | 'returned'
  | 'cancelled'
  | 'unknown'

export type Address = {
  countryCode: string
  postalCode: string
  city: string
  line1: string
  line2?: string
}

export type PackageInfo = {
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
}

export type ShippingRate = {
  serviceCode: string
  serviceName: string
  amount: number
  currencyCode: string
  estimatedDays?: number
  guaranteedDelivery?: boolean
}

export type CreateShipmentInput = {
  orderId: string
  origin: Address
  destination: Address
  packages: PackageInfo[]
  serviceCode: string
  credentials: Record<string, unknown>
  labelFormat?: 'pdf' | 'zpl' | 'png'
}

export type CreateShipmentResult = {
  shipmentId: string
  trackingNumber: string
  labelUrl?: string
  labelData?: string
  estimatedDelivery?: Date
}

export type TrackingResult = {
  trackingNumber: string
  status: UnifiedShipmentStatus
  events: Array<{
    status: UnifiedShipmentStatus
    occurredAt: string
    location?: string
  }>
}

export type ShippingWebhookEvent = {
  eventType: string
  eventId: string
  idempotencyKey: string
  data: Record<string, unknown>
  timestamp: Date
}

export interface ShippingAdapter {
  readonly providerKey: string

  calculateRates(input: {
    origin: Address
    destination: Address
    packages: PackageInfo[]
    credentials: Record<string, unknown>
  }): Promise<ShippingRate[]>

  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>

  getTracking(input: {
    shipmentId?: string
    trackingNumber?: string
    credentials: Record<string, unknown>
  }): Promise<TrackingResult>

  cancelShipment(input: {
    shipmentId: string
    reason?: string
    credentials: Record<string, unknown>
  }): Promise<{ status: UnifiedShipmentStatus }>

  verifyWebhook(input: {
    rawBody: string | Buffer
    headers: Record<string, string | string[] | undefined>
    credentials: Record<string, unknown>
  }): Promise<ShippingWebhookEvent>

  mapStatus(carrierStatus: string): UnifiedShipmentStatus
}

// Registry functions
export function registerShippingAdapter(adapter: ShippingAdapter): () => void
export function getShippingAdapter(providerKey: string): ShippingAdapter | undefined
export function listShippingAdapters(): ShippingAdapter[]
export function clearShippingAdapters(): void
```

---

## 4. DataSyncAdapter (Data Sync Hub)

**Source**: `packages/core/src/modules/data_sync/lib/adapter.ts`
**Hub**: `data_sync` | **Category**: `data_sync` | **Package prefix**: `sync-`

```typescript
export interface TenantScope {
  organizationId: string
  tenantId: string
}

export interface FieldMapping {
  externalField: string
  localField: string
  transform?: string
  required?: boolean
  defaultValue?: unknown
}

export interface DataMapping {
  entityType: string
  fields: FieldMapping[]
  matchStrategy: 'externalId' | 'sku' | 'email' | 'custom'
  matchField?: string
}

export interface StreamImportInput {
  entityType: string
  cursor?: string
  batchSize: number
  credentials: Record<string, unknown>
  mapping: DataMapping
  scope: TenantScope
}

export interface ImportItem {
  externalId: string
  data: Record<string, unknown>
  action: 'create' | 'update' | 'skip'
  hash?: string
}

export interface ImportBatch {
  items: ImportItem[]
  cursor: string
  hasMore: boolean
  totalEstimate?: number
  batchIndex: number
}

export interface StreamExportInput {
  entityType: string
  cursor?: string
  batchSize: number
  credentials: Record<string, unknown>
  mapping: DataMapping
  scope: TenantScope
  filter?: Record<string, unknown>
}

export interface ExportItemResult {
  localId: string
  externalId?: string
  status: 'success' | 'error' | 'skipped'
  error?: string
}

export interface ExportBatch {
  results: ExportItemResult[]
  cursor: string
  hasMore: boolean
  batchIndex: number
}

export interface ValidationResult {
  ok: boolean
  message?: string
  details?: Record<string, unknown>
}

export interface DataSyncAdapter {
  readonly providerKey: string
  readonly direction: 'import' | 'export' | 'bidirectional'
  readonly supportedEntities: string[]

  streamImport?(input: StreamImportInput): AsyncIterable<ImportBatch>
  streamExport?(input: StreamExportInput): AsyncIterable<ExportBatch>
  getInitialCursor?(input: { entityType: string; scope: TenantScope }): Promise<string | null>
  getMapping(input: { entityType: string; scope: TenantScope }): Promise<DataMapping>
  validateConnection?(input: {
    entityType: string
    credentials: Record<string, unknown>
    mapping: DataMapping
    scope: TenantScope
  }): Promise<ValidationResult>
}

// Registry functions
export function registerDataSyncAdapter(adapter: DataSyncAdapter): void
export function getDataSyncAdapter(providerKey: string): DataSyncAdapter | undefined
export function getAllDataSyncAdapters(): DataSyncAdapter[]
```

---

## 5. ChannelAdapter (Communication Channels Hub)

**Source**: SPEC-045d (spec-only, not yet implemented in code)
**Hub**: `communication_channels` | **Category**: `communication` | **Package prefix**: `channel-`

```typescript
interface ChannelAdapter {
  readonly providerKey: string
  readonly channelType: 'whatsapp' | 'sms' | 'email' | string

  sendMessage(input: SendMessageInput): Promise<SendMessageResult>
  verifyWebhook(input: VerifyWebhookInput): Promise<InboundMessage>
  getStatus(input: GetMessageStatusInput): Promise<MessageStatus>
  listSenders?(input: ListSendersInput): Promise<SenderInfo[]>
}

interface SendMessageInput {
  channelId: string
  recipientId: string
  content: MessageContent
  conversationId?: string
  credentials: Record<string, unknown>
  scope: TenantScope
}

interface MessageContent {
  type: 'text' | 'template' | 'media' | 'interactive'
  text?: string
  templateId?: string
  templateParams?: Record<string, string>
  mediaUrl?: string
  buttons?: MessageButton[]
}

type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'unknown'
```

---

## 6. NotificationTransportAdapter (Notification Providers Hub)

**Source**: SPEC-045d (spec-only, not yet implemented in code)
**Hub**: `notification_providers` | **Category**: `communication` | **Package prefix**: `channel-`

```typescript
interface NotificationTransportAdapter {
  readonly providerKey: string
  readonly transportType: 'email' | 'sms' | 'push' | string

  send(input: SendNotificationInput): Promise<SendNotificationResult>
  getDeliveryStatus?(input: GetDeliveryStatusInput): Promise<DeliveryStatus>
  verifyWebhook?(input: VerifyWebhookInput): Promise<DeliveryReceipt>
}

interface SendNotificationInput {
  recipient: NotificationRecipient
  subject?: string
  body: string
  htmlBody?: string
  templateId?: string
  templateData?: Record<string, unknown>
  credentials: Record<string, unknown>
  metadata?: Record<string, string>
}

interface NotificationRecipient {
  email?: string
  phone?: string
  deviceToken?: string
  userId?: string
}

interface SendNotificationResult {
  externalId: string
  status: 'sent' | 'queued' | 'failed'
  error?: string
}
```

---

## 7. WebhookEndpointAdapter (Webhook Endpoints Hub)

**Source**: SPEC-045e (spec-only, delegates to SPEC-057)
**Hub**: `webhook_endpoints` | **Category**: `webhook` | **Package prefix**: `webhook-`

```typescript
interface WebhookEndpointAdapter {
  readonly providerKey: string
  readonly subscribedEvents: string[]

  formatPayload(event: EventPayload): Promise<WebhookPayload>
  verifyWebhook(input: VerifyWebhookInput): Promise<InboundWebhookEvent>
  processInbound(event: InboundWebhookEvent): Promise<void>
}

interface WebhookPayload {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  method: 'POST' | 'PUT' | 'PATCH'
}
```

---

## 8. StorageAdapter (Storage Providers Hub)

**Source**: SPEC-045i (spec-only, not yet implemented in code)
**Hub**: `storage_hubs` | **Category**: `storage` | **Package prefix**: `storage-`

```typescript
interface StorageAdapter {
  readonly providerKey: string

  upload(input: UploadInput): Promise<UploadResult>
  download(input: DownloadInput): Promise<ReadableStream>
  delete(input: DeleteInput): Promise<void>
  getSignedUrl?(input: SignedUrlInput): Promise<string>
  list?(input: ListInput): Promise<StorageFileInfo[]>
  exists?(input: ExistsInput): Promise<boolean>
}
```

### StorageDriver (Attachments Module Level)

Used internally by the attachments module to interface with storage backends:

```typescript
export type StoreFilePayload = {
  partitionCode: string
  orgId: string | null | undefined
  tenantId: string | null | undefined
  fileName: string
  buffer: Buffer
}

export type StoredFile = {
  storagePath: string
  driverMeta?: Record<string, unknown> | null
}

export type ReadFileResult = {
  buffer: Buffer
  contentType?: string
}

export interface StorageDriver {
  readonly key: string
  store(payload: StoreFilePayload): Promise<StoredFile>
  read(partitionCode: string, storagePath: string): Promise<ReadFileResult>
  delete(partitionCode: string, storagePath: string): Promise<void>
  toLocalPath(partitionCode: string, storagePath: string): Promise<{
    filePath: string
    cleanup: () => Promise<void>
  }>
}
```

---

## Summary Table

| Adapter | Status | Source Location | Hub ID | Category |
|---------|--------|----------------|--------|----------|
| `GatewayAdapter` | Implemented | `packages/shared/src/modules/payment_gateways/types.ts` | `payment_gateways` | `payment` |
| `ShippingAdapter` | Implemented | `packages/core/src/modules/shipping_carriers/lib/adapter.ts` | `shipping_carriers` | `shipping` |
| `DataSyncAdapter` | Implemented | `packages/core/src/modules/data_sync/lib/adapter.ts` | `data_sync` | `data_sync` |
| `ChannelAdapter` | Spec-only | SPEC-045d | `communication_channels` | `communication` |
| `NotificationTransportAdapter` | Spec-only | SPEC-045d | `notification_providers` | `communication` |
| `WebhookEndpointAdapter` | Spec-only | SPEC-045e | `webhook_endpoints` | `webhook` |
| `StorageAdapter` | Spec-only | SPEC-045i | `storage_hubs` | `storage` |

---

## Common Patterns

### Webhook Verification Input (shared across all adapters)

```typescript
export interface VerifyWebhookInput {
  rawBody: string | Buffer
  headers: Record<string, string | string[] | undefined>
  credentials: Record<string, unknown>
}
```

### Tenant Scope (shared across adapters that need tenant context)

```typescript
export interface TenantScope {
  organizationId: string
  tenantId: string
}
```

### DI Registration Pattern

All adapters follow the same DI registration pattern in `di.ts`:

```typescript
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register<Category>Adapter } from '<hub-types-path>'

export function register(container: AppContainer): void {
  const adapter = new MyAdapter()
  register<Category>Adapter(adapter)
  // For gateways with versioning:
  // registerGatewayAdapter(adapter, { version: '2025-01-01' })
}
```
