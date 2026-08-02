/**
 * Inbound webhook handler types (SPEC: 2026-03-23-inbound-webhook-handlers).
 *
 * These mirror the event-subscriber DX: a module exports `webhook-sources.ts`
 * (one or more `WebhookSourceConfig`) and `webhook-handlers/*.ts` files that each
 * export `metadata: WebhookHandlerMeta` plus a default handler function.
 */

/** Raw inbound request passed to a source verifier. */
export interface InboundWebhookRequest {
  /** Raw request body, required for signature verification. */
  body: string
  /** Lower-cased request headers. */
  headers: Record<string, string>
  /** Parsed request body (best-effort JSON). */
  parsedBody: Record<string, unknown>
}

/** Optional descriptor of the credential fields a source needs (drives the admin UI). */
export interface WebhookSourceCredentialField {
  key: string
  label: string
  secret?: boolean
  required?: boolean
}

/**
 * Configuration for an external webhook source (e.g. `stripe`, `resend`).
 * Declared in a module's `webhook-sources.ts` via the `webhookSources` export.
 */
export interface WebhookSourceConfig {
  /** Unique source identifier, e.g. `stripe`. Also the inbound path segment. */
  key: string
  /** Human-readable label. */
  label: string
  /**
   * Verify the authenticity of an inbound webhook.
   * Return true if valid, false to reject with 401. Throwing rejects with 400/500.
   */
  verifier: (
    request: InboundWebhookRequest,
    credentials: Record<string, string>,
  ) => Promise<boolean>
  /** Extract the event type from the parsed body/headers. */
  eventTypeExtractor: (
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ) => string
  /** Extract a unique message id for deduplication. Return undefined if unavailable. */
  messageIdExtractor?: (
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ) => string | undefined
  /** Optionally derive tenant scope from the payload/headers. */
  scopeExtractor?: (
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ) => { tenantId?: string; organizationId?: string }
  /** Credential fields this source needs; used by the source-credential admin UI. */
  credentialFields?: WebhookSourceCredentialField[]
}

/** Metadata exported by every `webhook-handlers/*.ts` file. */
export interface WebhookHandlerMeta {
  /** Source key this handler listens to, e.g. `stripe`. */
  source: string
  /** Event-type pattern (supports wildcards: `*`, `payment_intent.*`). */
  event: string
  /** Unique handler id, e.g. `payments:stripe-payment-succeeded`. */
  id: string
  /** If true (default), handler runs via the queue-backed dispatcher. */
  persistent?: boolean
}

/** Payload handed to a webhook handler. */
export interface WebhookHandlerPayload {
  /** Parsed webhook body. */
  data: Record<string, unknown>
  /** Extracted event type. */
  eventType: string
  /** Source key. */
  sourceKey: string
  /** Selected request headers. */
  headers: Record<string, string>
  /** WebhookIngestion record id. */
  ingestionId: string
  /** Tenant scope. */
  tenantId: string
  organizationId: string
}

/** DI accessor handed to a webhook handler. */
export interface WebhookHandlerContext {
  resolve: <T>(name: string) => T
}

/** A webhook handler function (default export of a `webhook-handlers/*.ts` file). */
export type WebhookHandler = (
  payload: WebhookHandlerPayload,
  ctx: WebhookHandlerContext,
) => Promise<void>

/** A generated registry entry binding handler metadata to a lazy module loader. */
export interface WebhookHandlerRegistryEntry {
  meta: WebhookHandlerMeta
  handler: () => Promise<{ default: WebhookHandler }>
}

/** Per-handler execution detail recorded on a WebhookIngestion. */
export interface WebhookHandlerResult {
  handlerId: string
  module: string
  status: 'success' | 'failed'
  errorMessage?: string
  durationMs: number
  startedAt: string
}

/** Lifecycle status of an inbound webhook ingestion. */
export type WebhookIngestionStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'duplicate'
