export type UnifiedPaymentStatus =
  | 'pending'
  | 'processing'
  | 'authorized'
  | 'captured'
  | 'partially_captured'
  | 'refunded'
  | 'partially_refunded'
  | 'failed'
  | 'cancelled'
  | 'disputed'
  | 'unknown'

export interface SessionLineItem {
  name: string
  quantity: number
  amount: number
}

export interface CreateSessionInput {
  orderId?: string
  orderNumber?: string
  amount: number
  currencyCode: string
  customerEmail?: string
  customerName?: string
  lineItems?: SessionLineItem[]
  settings: Record<string, unknown>
  successUrl: string
  cancelUrl: string
  webhookUrl?: string
  paymentMethodTypes?: string[]
  organizationId: string
  tenantId: string
  locale?: string
  metadata?: Record<string, string>
}

export interface CreateSessionResult {
  sessionId: string
  redirectUrl?: string
  clientSecret?: string
  gatewayStatus?: string
  unifiedStatus?: UnifiedPaymentStatus
  providerData?: Record<string, unknown>
}

export interface CaptureInput {
  sessionId: string
  settings: Record<string, unknown>
  amount?: number
  organizationId: string
  tenantId: string
}

export interface CaptureResult {
  gatewayStatus: string
  unifiedStatus: UnifiedPaymentStatus
  capturedAmount?: number
  providerData?: Record<string, unknown>
}

export interface RefundInput {
  sessionId: string
  settings: Record<string, unknown>
  amount?: number
  reason?: string
  metadata?: Record<string, string>
  organizationId: string
  tenantId: string
}

export interface RefundResult {
  refundId?: string
  gatewayStatus: string
  unifiedStatus: UnifiedPaymentStatus
  refundedAmount?: number
  providerData?: Record<string, unknown>
}

export interface CancelInput {
  sessionId: string
  settings: Record<string, unknown>
  organizationId: string
  tenantId: string
}

export interface CancelResult {
  gatewayStatus: string
  unifiedStatus: UnifiedPaymentStatus
  providerData?: Record<string, unknown>
}

export interface GetStatusInput {
  sessionId: string
  settings: Record<string, unknown>
  organizationId: string
  tenantId: string
}

export interface GatewayPaymentStatus {
  gatewayStatus: string
  unifiedStatus: UnifiedPaymentStatus
  amount?: number
  capturedAmount?: number
  refundedAmount?: number
  currencyCode?: string
  providerData?: Record<string, unknown>
}

export interface VerifyWebhookInput {
  rawBody: string | Buffer
  headers: Record<string, string | string[] | undefined>
  settings: Record<string, unknown>
}

export interface GatewayWebhookEvent {
  eventType: string
  eventId: string
  sessionId?: string
  gatewayStatus?: string
  unifiedStatus?: UnifiedPaymentStatus
  occurredAt?: Date
  payload: Record<string, unknown>
  idempotencyKey?: string
}

export interface GatewayAdapter {
  readonly providerKey: string

  createSession(input: CreateSessionInput): Promise<CreateSessionResult>
  capture(input: CaptureInput): Promise<CaptureResult>
  refund(input: RefundInput): Promise<RefundResult>
  cancel(input: CancelInput): Promise<CancelResult>
  getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus>
  verifyWebhook(input: VerifyWebhookInput): Promise<GatewayWebhookEvent>
  mapStatus(gatewayStatus: string, eventType?: string): UnifiedPaymentStatus
}
