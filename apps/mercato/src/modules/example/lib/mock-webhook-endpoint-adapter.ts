import { createHmac, timingSafeEqual } from 'node:crypto'
import type { WebhookEndpointAdapter } from '@open-mercato/webhooks/modules/webhooks/lib/adapter-registry'

/**
 * Deterministic dev-only secret used when `MOCK_INBOUND_WEBHOOK_SECRET` is not set.
 * Exported so integration tests can sign mock inbound webhook payloads. MUST NOT be
 * used in production: the mock adapter refuses to fall back to this constant when
 * `NODE_ENV === 'production'`.
 */
export const MOCK_INBOUND_DEV_WEBHOOK_SECRET = 'open-mercato-mock-dev-inbound-webhook-secret'

export const MOCK_INBOUND_SIGNATURE_HEADER = 'x-mock-webhook-signature'

function parseJsonBody(body: string): Record<string, unknown> {
  const parsed = JSON.parse(body) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid mock webhook payload')
  }
  return parsed as Record<string, unknown>
}

function resolveMockInboundWebhookSecret(): string {
  const fromEnv = (process.env.MOCK_INBOUND_WEBHOOK_SECRET ?? '').trim()
  if (fromEnv) return fromEnv

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Mock inbound webhook secret is not configured. Set MOCK_INBOUND_WEBHOOK_SECRET.',
    )
  }

  return MOCK_INBOUND_DEV_WEBHOOK_SECRET
}

export function computeMockInboundWebhookSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf-8').digest('hex')
}

function readSignatureHeader(headers: Record<string, string>): string {
  const direct = headers[MOCK_INBOUND_SIGNATURE_HEADER]
    ?? headers[MOCK_INBOUND_SIGNATURE_HEADER.toUpperCase()]
    ?? headers[MOCK_INBOUND_SIGNATURE_HEADER.replace(/-/g, '_')]
  return typeof direct === 'string' ? direct : ''
}

export const mockWebhookEndpointAdapter: WebhookEndpointAdapter = {
  providerKey: 'mock_inbound',
  subscribedEvents: ['*'],
  async verifyWebhook(input) {
    const providedSignature = readSignatureHeader(input.headers)
    if (!providedSignature) {
      throw new Error(`Missing ${MOCK_INBOUND_SIGNATURE_HEADER} header`)
    }

    const secret = resolveMockInboundWebhookSecret()
    const expectedSignature = computeMockInboundWebhookSignature(input.body, secret)
    const providedBuffer = Buffer.from(providedSignature, 'utf-8')
    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8')
    if (
      providedBuffer.length !== expectedBuffer.length
      || !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new Error('Invalid mock webhook signature')
    }

    const payload = parseJsonBody(input.body)
    const eventType = typeof payload.type === 'string' && payload.type.trim().length > 0
      ? payload.type
      : 'mock.inbound.received'

    return {
      eventType,
      payload,
    }
  },
  async processInbound() {
    return
  },
}

export default mockWebhookEndpointAdapter
