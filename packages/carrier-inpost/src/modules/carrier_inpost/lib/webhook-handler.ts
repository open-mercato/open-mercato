import * as crypto from 'node:crypto'
import type { ShippingWebhookEvent } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'

type VerifyWebhookInput = {
  rawBody: string | Buffer
  headers: Record<string, string | string[] | undefined>
  credentials: Record<string, unknown>
}

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

function resolveWebhookSecret(credentials: Record<string, unknown>): string | null {
  const secret = credentials.webhookSecret
  if (typeof secret === 'string' && secret.trim().length > 0) return secret.trim()
  return null
}

export async function verifyInpostWebhook(input: VerifyWebhookInput): Promise<ShippingWebhookEvent> {
  const body = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf-8')
  const secret = resolveWebhookSecret(input.credentials)

  if (secret) {
    const signature = readHeader(input.headers, 'x-inpost-signature')
    if (!signature) {
      throw new Error('Missing X-Inpost-Signature header')
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex')

    const signatureBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expected, 'hex')

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new Error('InPost webhook signature verification failed')
    }
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new Error('InPost webhook payload is not valid JSON')
  }

  const eventType = typeof payload.status === 'string' ? payload.status : 'unknown'
  const eventId = typeof payload.id === 'string' ? payload.id : crypto.randomUUID()
  const timestamp = typeof payload.created_at === 'string'
    ? new Date(payload.created_at)
    : new Date()

  return {
    eventType,
    eventId,
    idempotencyKey: eventId,
    data: payload,
    timestamp,
  }
}
