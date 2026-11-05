import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  GatewayAdapter,
  CreateSessionInput,
  CreateSessionResult,
  CaptureInput,
  CaptureResult,
  RefundInput,
  RefundResult,
  CancelInput,
  CancelResult,
  GetStatusInput,
  GatewayPaymentStatus,
  VerifyWebhookInput,
  WebhookEvent,
  UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'

/**
 * Deterministic dev-only secret used when no `credentials.webhookSecret` is configured
 * and `MOCK_GATEWAY_WEBHOOK_SECRET` is not set. Exported so integration tests can sign
 * mock webhook payloads. MUST NOT be used in production: the mock adapter refuses to
 * fall back to this constant when `NODE_ENV === 'production'`.
 */
export const MOCK_GATEWAY_DEV_WEBHOOK_SECRET = 'open-mercato-mock-dev-webhook-secret'

export const MOCK_GATEWAY_SIGNATURE_HEADER = 'x-mock-signature'

function resolveMockWebhookSecret(credentials: Record<string, unknown> | undefined): string {
  const fromCredentials = typeof credentials?.webhookSecret === 'string'
    ? credentials.webhookSecret.trim()
    : ''
  if (fromCredentials) return fromCredentials

  const fromEnv = (process.env.MOCK_GATEWAY_WEBHOOK_SECRET ?? '').trim()
  if (fromEnv) return fromEnv

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Mock gateway webhook secret is not configured. Set credentials.webhookSecret or MOCK_GATEWAY_WEBHOOK_SECRET.',
    )
  }

  return MOCK_GATEWAY_DEV_WEBHOOK_SECRET
}

export function computeMockWebhookSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf-8').digest('hex')
}

function readSignatureHeader(headers: Record<string, string | string[] | undefined>): string {
  const direct = headers[MOCK_GATEWAY_SIGNATURE_HEADER]
    ?? headers[MOCK_GATEWAY_SIGNATURE_HEADER.toUpperCase()]
    ?? headers[MOCK_GATEWAY_SIGNATURE_HEADER.replace(/-/g, '_')]
  if (Array.isArray(direct)) return typeof direct[0] === 'string' ? direct[0] : ''
  return typeof direct === 'string' ? direct : ''
}

const sessionStore = new Map<string, { status: UnifiedPaymentStatus; amount: number; capturedAmount: number; refundedAmount: number; currencyCode: string }>()

export const mockGatewayAdapter: GatewayAdapter = {
  providerKey: 'mock',

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const sessionId = `mock_pi_${crypto.randomUUID().slice(0, 8)}`
    const status: UnifiedPaymentStatus = input.captureMethod === 'manual' ? 'authorized' : 'captured'

    sessionStore.set(sessionId, {
      status,
      amount: input.amount,
      capturedAmount: status === 'captured' ? input.amount : 0,
      refundedAmount: 0,
      currencyCode: input.currencyCode,
    })

    return {
      sessionId,
      clientSecret: `mock_secret_${sessionId}`,
      redirectUrl: undefined,
      status,
      providerData: { mockPaymentIntentId: sessionId },
    }
  },

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const session = sessionStore.get(input.sessionId)
    if (!session) throw new Error(`Mock session not found: ${input.sessionId}`)

    const capturedAmount = input.amount ?? session.amount
    session.status = 'captured'
    session.capturedAmount = capturedAmount

    return {
      status: 'captured',
      capturedAmount,
      providerData: { mockChargeId: `mock_ch_${crypto.randomUUID().slice(0, 8)}` },
    }
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const session = sessionStore.get(input.sessionId)
    if (!session) throw new Error(`Mock session not found: ${input.sessionId}`)

    const refundedAmount = input.amount ?? session.capturedAmount
    session.refundedAmount += refundedAmount
    session.status = session.refundedAmount >= session.capturedAmount ? 'refunded' : 'partially_refunded'

    return {
      refundId: `mock_re_${crypto.randomUUID().slice(0, 8)}`,
      status: session.status,
      refundedAmount,
    }
  },

  async cancel(input: CancelInput): Promise<CancelResult> {
    const session = sessionStore.get(input.sessionId)
    if (session) session.status = 'cancelled'

    return { status: 'cancelled' }
  },

  async getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus> {
    const session = sessionStore.get(input.sessionId)
    if (!session) throw new Error(`Mock session not found: ${input.sessionId}`)

    return {
      status: session.status,
      amount: session.amount,
      amountReceived: session.capturedAmount,
      currencyCode: session.currencyCode,
    }
  },

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
    const rawBodyString = typeof input.rawBody === 'string'
      ? input.rawBody
      : input.rawBody.toString('utf-8')

    const providedSignature = readSignatureHeader(input.headers)
    if (!providedSignature) {
      throw new Error(`Missing ${MOCK_GATEWAY_SIGNATURE_HEADER} header`)
    }

    const secret = resolveMockWebhookSecret(input.credentials)
    const expectedSignature = computeMockWebhookSignature(rawBodyString, secret)
    const providedBuffer = Buffer.from(providedSignature, 'utf-8')
    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8')
    if (
      providedBuffer.length !== expectedBuffer.length
      || !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new Error('Invalid mock webhook signature')
    }

    const body = JSON.parse(rawBodyString)
    const sessionId = typeof body?.data?.id === 'string' ? body.data.id : null
    const nextStatus = typeof body?.data?.status === 'string' ? body.data.status : null
    const amount = typeof body?.data?.amount === 'number' ? body.data.amount : null

    if (sessionId && nextStatus) {
      const session = sessionStore.get(sessionId)
      if (session) {
        if (nextStatus === 'captured') {
          session.status = 'captured'
          session.capturedAmount = amount ?? session.amount
        } else if (nextStatus === 'cancelled') {
          session.status = 'cancelled'
        } else if (nextStatus === 'refunded') {
          session.status = 'refunded'
          session.refundedAmount = amount ?? session.capturedAmount
        } else if (nextStatus === 'partially_refunded') {
          session.status = 'partially_refunded'
          session.refundedAmount = amount ?? session.refundedAmount
        } else if (nextStatus === 'failed') {
          session.status = 'failed'
        }
      }
    }

    return {
      eventType: body.type ?? 'mock.event',
      eventId: body.id ?? crypto.randomUUID(),
      data: body.data ?? {},
      idempotencyKey: body.id ?? crypto.randomUUID(),
      timestamp: new Date(),
    }
  },

  mapStatus(providerStatus: string): UnifiedPaymentStatus {
    const map: Record<string, UnifiedPaymentStatus> = {
      authorized: 'authorized',
      captured: 'captured',
      refunded: 'refunded',
      cancelled: 'cancelled',
      failed: 'failed',
    }
    return map[providerStatus] ?? 'unknown'
  },
}
