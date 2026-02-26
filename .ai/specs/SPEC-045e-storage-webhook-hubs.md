# SPEC-045e — Storage & Webhook Hubs

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 5 of 6

---

## Goal

Build `storage_providers` hub (allowing attachments to use S3, MinIO, GCS etc.) and `webhook_endpoints` hub (custom inbound/outbound webhook integrations).

---

## 1. Storage Providers Hub — `storage_providers`

### 1.1 StorageAdapter Contract

```typescript
// storage_providers/lib/adapter.ts

interface StorageAdapter {
  readonly providerKey: string

  /** Upload a file */
  upload(input: UploadInput): Promise<UploadResult>

  /** Download / get a readable stream */
  download(input: DownloadInput): Promise<ReadableStream>

  /** Delete a file */
  delete(input: DeleteInput): Promise<void>

  /** Generate a signed URL (for direct browser access) */
  getSignedUrl?(input: SignedUrlInput): Promise<string>

  /** List files in a path/prefix */
  list?(input: ListInput): Promise<StorageFileInfo[]>

  /** Check if a file exists */
  exists?(input: ExistsInput): Promise<boolean>
}

interface UploadInput {
  key: string               // File path/key in storage
  content: ReadableStream | Buffer
  contentType: string
  contentLength?: number
  metadata?: Record<string, string>
  credentials: Record<string, unknown>
}

interface UploadResult {
  key: string
  url?: string              // Public URL (if applicable)
  etag?: string
  size: number
}
```

### 1.2 Relationship with Attachments Module

The existing `attachments` module uses local filesystem storage. The `storage_providers` hub provides an abstraction:

1. Current local storage becomes the **default** `StorageAdapter` (`storage_local`)
2. Admin can configure S3, MinIO, etc. via the integrations marketplace
3. The attachments module resolves the active storage adapter via DI
4. Per-partition storage configuration possible (e.g., products media → S3, private docs → local)

### 1.3 First Provider — `storage_s3`

Credentials:
```typescript
credentials: {
  fields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'secret', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'secret', required: true },
    { key: 'region', label: 'Region', type: 'text', required: true, placeholder: 'eu-central-1' },
    { key: 'bucket', label: 'Bucket Name', type: 'text', required: true },
    { key: 'endpoint', label: 'Custom Endpoint (MinIO)', type: 'url', description: 'Leave empty for AWS S3' },
    { key: 'forcePathStyle', label: 'Force Path Style', type: 'boolean', description: 'Required for MinIO' },
  ],
}
```

---

## 2. Webhook Endpoints Hub — `webhook_endpoints`

### 2.1 WebhookEndpointAdapter Contract

For custom inbound/outbound webhook integrations (e.g., Zapier triggers, n8n, custom automation):

```typescript
// webhook_endpoints/lib/adapter.ts

interface WebhookEndpointAdapter {
  readonly providerKey: string

  /** Which Open Mercato events trigger outbound webhooks */
  readonly subscribedEvents: string[]

  /** Format an outbound payload for a given event */
  formatPayload(event: EventPayload): Promise<WebhookPayload>

  /** Verify an inbound webhook signature */
  verifyWebhook(input: VerifyWebhookInput): Promise<InboundWebhookEvent>

  /** Process an inbound webhook event */
  processInbound(event: InboundWebhookEvent): Promise<void>
}

interface WebhookPayload {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  method: 'POST' | 'PUT' | 'PATCH'
}
```

### 2.2 Outbound Webhook Flow

1. Platform event fires (e.g., `sales.order.created`)
2. Webhook hub subscriber checks if any enabled webhook endpoint subscribes to this event
3. Calls `adapter.formatPayload(event)` to build the payload
4. Enqueues delivery via worker (retry with exponential backoff)
5. Logs delivery result via `integrationLog`

### 2.3 Custom Webhook Configuration

Admin can configure custom webhook endpoints without code — a generic `webhook_custom` provider:

```typescript
credentials: {
  fields: [
    { key: 'targetUrl', label: 'Target URL', type: 'url', required: true },
    { key: 'secret', label: 'Signing Secret', type: 'secret', description: 'For HMAC signature verification' },
    { key: 'headers', label: 'Custom Headers', type: 'json', description: 'Additional headers to send' },
    { key: 'events', label: 'Subscribed Events', type: 'json', description: 'Array of event IDs to send' },
  ],
}
```

---

## 3. Implementation Steps

### Storage Providers Hub
1. Create `storage_providers` hub module with `StorageAdapter` contract
2. Extract current local storage into `storage_local` default adapter
3. Create `storage_s3` provider module (works for S3 + MinIO + GCS with S3 compat)
4. Wire hub into attachments module via DI (resolve active adapter)
5. Integration tests for upload, download, signed URL, list

### Webhook Endpoints Hub
1. Create `webhook_endpoints` hub module
2. Implement outbound webhook subscriber + delivery worker
3. Create `webhook_custom` generic provider
4. Admin UI for configuring webhook targets and subscribed events
5. Delivery logging + retry with exponential backoff (max 5 attempts)
6. Integration tests for outbound delivery, inbound verification, retry logic
