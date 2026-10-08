import * as crypto from 'node:crypto'
import { match, P } from 'ts-pattern'
import type { ShippingWebhookEvent } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'
import { inpostErrors } from './errors'
import { mapInpostStatus } from './status-map'

// InPost webhook payload envelope shape per official docs:
//   { event, event_ts, organization_id, payload: { shipment_id, status?, tracking_number?, ... } }
// Event types:
//   "shipment_confirmed"        — shipment created; nested payload has no "status" field
//   "shipment_status_changed"   — status transition; nested payload.status is the InPost status string
//   "offers_prepared"           — async offer array ready; nested payload has "offers" array

type InpostWebhookEnvelope = {
  event?: string
  event_ts?: string
  organization_id?: number
  payload?: {
    shipment_id?: number | string
    status?: string
    tracking_number?: string
    return_tracking_number?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

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

  let envelope: InpostWebhookEnvelope
  try {
    envelope = JSON.parse(body) as InpostWebhookEnvelope
  } catch {
    throw inpostErrors.webhookInvalidJson()
  }

  // Derive unified shipment status from the nested payload.
  // "shipment_confirmed" carries no status field — map to label_created.
  // All other events carry payload.status as an InPost status string.
  const inpostStatus = envelope.payload?.status
  const eventType = match([envelope.event, inpostStatus] as const)
    .with(['shipment_confirmed', P._], () => 'label_created' as const)
    .with([P._, P.string], ([, s]) => mapInpostStatus(s))
    .otherwise(() => 'unknown' as const)

  // eventId is the shipment_id from the nested payload (string-coerced for idempotency).
  // Fall back to a random UUID only when shipment_id is truly absent.
  const eventId = match(envelope.payload?.shipment_id)
    .with(P.string, (s) => s)
    .with(P.number, (n) => String(n))
    .otherwise(() => crypto.randomUUID())

  // event_ts is the canonical timestamp field per InPost docs (e.g. "2020-03-20 15:08:06 +0100").
  const timestamp = match(envelope.event_ts)
    .with(P.string, (s) => new Date(s))
    .otherwise(() => new Date())

  // tracking_number is present in both shipment_confirmed and shipment_status_changed payloads.
  const trackingNumber = match(envelope.payload?.tracking_number)
    .with(P.string, (s) => s)
    .otherwise(() => undefined)

  return {
    eventType,
    eventId,
    idempotencyKey: eventId,
    data: envelope as Record<string, unknown>,
    timestamp,
    ...(trackingNumber !== undefined && { trackingNumber }),
  }
}
