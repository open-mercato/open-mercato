// ── Unified Payment Status ──────────────────────────────────────────────────

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

// ── GatewayAdapter Interface ────────────────────────────────────────────────

export interface GatewayAdapter {
  readonly providerKey: string

  /** Create a payment session / payment intent */
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>

  /** Capture an authorized payment */
  capture(input: CaptureInput): Promise<CaptureResult>

  /** Refund a captured payment (full or partial) */
  refund(input: RefundInput): Promise<RefundResult>

  /** Cancel / void an authorized payment before capture */
  cancel(input: CancelInput): Promise<CancelResult>

  /** Get current payment status from provider */
  getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus>

  /** Verify and parse an inbound webhook event */
  verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent>

  /** Map provider status to unified status */
  mapStatus(providerStatus: string, eventType?: string): UnifiedPaymentStatus
}

// ── Input / Output Types ────────────────────────────────────────────────────

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

// ── Webhook Handler ─────────────────────────────────────────────────────────

export interface WebhookHandlerRegistration {
  handler: (input: VerifyWebhookInput) => Promise<WebhookEvent>
  queue?: string
  readSessionIdHint?: (payload: Record<string, unknown> | null) => string | null
}

// ── Adapter Registry Options ────────────────────────────────────────────────

export interface RegisterAdapterOptions {
  version?: string
}

// ── Registries ──────────────────────────────────────────────────────────────

const ADAPTER_REGISTRY_KEY = '__openMercatoPaymentGatewayAdapters__'
const WEBHOOK_REGISTRY_KEY = '__openMercatoPaymentGatewayWebhookHandlers__'

function getAdapterRegistry(): Map<string, GatewayAdapter> {
  const globalState = globalThis as typeof globalThis & {
    [ADAPTER_REGISTRY_KEY]?: Map<string, GatewayAdapter>
  }
  if (!globalState[ADAPTER_REGISTRY_KEY]) {
    globalState[ADAPTER_REGISTRY_KEY] = new Map<string, GatewayAdapter>()
  }
  return globalState[ADAPTER_REGISTRY_KEY]
}

function getWebhookHandlerRegistry(): Map<string, WebhookHandlerRegistration> {
  const globalState = globalThis as typeof globalThis & {
    [WEBHOOK_REGISTRY_KEY]?: Map<string, WebhookHandlerRegistration>
  }
  if (!globalState[WEBHOOK_REGISTRY_KEY]) {
    globalState[WEBHOOK_REGISTRY_KEY] = new Map<string, WebhookHandlerRegistration>()
  }
  return globalState[WEBHOOK_REGISTRY_KEY]
}

function adapterKey(providerKey: string, version?: string): string {
  return version ? `${providerKey}:${version}` : providerKey
}

export function registerGatewayAdapter(adapter: GatewayAdapter, options?: RegisterAdapterOptions): () => void {
  const adapterRegistry = getAdapterRegistry()
  const key = adapterKey(adapter.providerKey, options?.version)
  adapterRegistry.set(key, adapter)
  if (options?.version) {
    // Also register as default if no default exists
    if (!adapterRegistry.has(adapter.providerKey)) {
      adapterRegistry.set(adapter.providerKey, adapter)
    }
  }
  return () => {
    adapterRegistry.delete(key)
  }
}

export function getGatewayAdapter(providerKey: string, version?: string): GatewayAdapter | undefined {
  const adapterRegistry = getAdapterRegistry()
  if (version) {
    return adapterRegistry.get(adapterKey(providerKey, version)) ?? adapterRegistry.get(providerKey)
  }
  return adapterRegistry.get(providerKey)
}

export function listGatewayAdapters(): GatewayAdapter[] {
  const adapterRegistry = getAdapterRegistry()
  const seen = new Set<string>()
  const result: GatewayAdapter[] = []
  for (const [key, adapter] of adapterRegistry) {
    if (!key.includes(':') && !seen.has(adapter.providerKey)) {
      seen.add(adapter.providerKey)
      result.push(adapter)
    }
  }
  return result
}

export function clearGatewayAdapters(): void {
  getAdapterRegistry().clear()
}

export function registerWebhookHandler(
  providerKey: string,
  handler: (input: VerifyWebhookInput) => Promise<WebhookEvent>,
  options?: {
    queue?: string
    readSessionIdHint?: (payload: Record<string, unknown> | null) => string | null
  },
): () => void {
  const webhookHandlerRegistry = getWebhookHandlerRegistry()
  webhookHandlerRegistry.set(providerKey, {
    handler,
    queue: options?.queue,
    readSessionIdHint: options?.readSessionIdHint,
  })
  return () => {
    webhookHandlerRegistry.delete(providerKey)
  }
}

export function getWebhookHandler(providerKey: string): WebhookHandlerRegistration | undefined {
  return getWebhookHandlerRegistry().get(providerKey)
}

export function clearWebhookHandlers(): void {
  getWebhookHandlerRegistry().clear()
}
