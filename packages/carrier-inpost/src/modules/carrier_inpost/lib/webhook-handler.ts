import * as crypto from 'node:crypto'
import { match, P } from 'ts-pattern'
import type { ShippingWebhookEvent } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'
import { inpostErrors } from './errors'

type VerifyWebhookInput = {
  rawBody: string | Buffer
  headers: Record<string, string | string[] | undefined>
  credentials: Record<string, unknown>
}

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return match(value)
    .with(P.array(P.string), (arr) => arr[0])
    .otherwise((v) => v)
}

function resolveWebhookSecret(credentials: Record<string, unknown>): string | null {
  const secret = credentials.webhookSecret
  if (typeof secret === 'string' && secret.trim().length > 0) return secret.trim()
  return null
}

export async function verifyInpostWebhook(input: VerifyWebhookInput): Promise<ShippingWebhookEvent> {
  const body = match(input.rawBody)
    .with(P.string, (s) => s)
    .otherwise((buf) => buf.toString('utf-8'))
  const secret = resolveWebhookSecret(input.credentials)

  if (secret) {
    const signature = readHeader(input.headers, 'x-inpost-signature')
    if (!signature) {
      throw inpostErrors.missingWebhookSignatureHeader()
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
      throw inpostErrors.webhookSignatureMismatch()
    }
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    throw inpostErrors.webhookInvalidJson()
  }

  const eventType = match(payload.status)
    .with(P.string, (s) => s)
    .otherwise(() => 'unknown')

  const eventId = match(payload.id)
    .with(P.string, (s) => s)
    .otherwise(() => crypto.randomUUID())

  const timestamp = match(payload.created_at)
    .with(P.string, (s) => new Date(s))
    .otherwise(() => new Date())

  return {
    eventType,
    eventId,
    idempotencyKey: eventId,
    data: payload,
    timestamp,
  }
}
