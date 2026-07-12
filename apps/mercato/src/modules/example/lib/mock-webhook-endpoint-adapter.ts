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

/**
 * Static-token alternative to the HMAC signature, for senders that can only attach
 * fixed headers (e.g. the outbound webhook delivery worker, whose per-delivery body
 * is generated server-side and cannot be pre-signed). The header value must equal the
 * resolved webhook secret (timing-safe compare), so authentication still requires
 * knowledge of the shared secret. Prefer the HMAC signature whenever the sender can
 * compute it — the token does not bind the request body.
 */
export const MOCK_INBOUND_TOKEN_HEADER = 'x-mock-webhook-token'

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

function readHeader(headers: Record<string, string>, name: string): string {
  const direct = headers[name]
    ?? headers[name.toUpperCase()]
    ?? headers[name.replace(/-/g, '_')]
  return typeof direct === 'string' ? direct : ''
}

function timingSafeEqualStrings(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf-8')
  const expectedBuffer = Buffer.from(expected, 'utf-8')
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer)
}

export const mockWebhookEndpointAdapter: WebhookEndpointAdapter = {
  providerKey: 'mock_inbound',
  subscribedEvents: ['*'],
  async verifyWebhook(input) {
    const providedSignature = readHeader(input.headers, MOCK_INBOUND_SIGNATURE_HEADER)
    const providedToken = readHeader(input.headers, MOCK_INBOUND_TOKEN_HEADER)
    if (!providedSignature && !providedToken) {
      throw new Error(
        `Missing ${MOCK_INBOUND_SIGNATURE_HEADER} or ${MOCK_INBOUND_TOKEN_HEADER} header`,
      )
    }

    const secret = resolveMockInboundWebhookSecret()
    if (providedSignature) {
      const expectedSignature = computeMockInboundWebhookSignature(input.body, secret)
      if (!timingSafeEqualStrings(providedSignature, expectedSignature)) {
        throw new Error('Invalid mock webhook signature')
      }
    } else if (!timingSafeEqualStrings(providedToken, secret)) {
      throw new Error('Invalid mock webhook token')
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
