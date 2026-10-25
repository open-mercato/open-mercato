import Chance from 'chance'
import * as crypto from 'node:crypto'
import { extractInpostWebhookShipmentId, verifyInpostWebhook } from '../lib/webhook-handler'

const chance = new Chance()

function makeSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function signed(body: string) {
  const secret = chance.string({ length: 32 })
  return {
    rawBody: body,
    headers: { 'x-inpost-signature': makeSignature(secret, body) },
    credentials: { webhookSecret: secret },
  }
}

// Build a realistic InPost webhook envelope matching the official docs shape:
//   { event, event_ts, organization_id, payload: { shipment_id, status?, tracking_number? } }
function makeStatusChangedEnvelope(overrides: Record<string, unknown> = {}): string {
  const shipmentId = chance.integer({ min: 1000, max: 999999 })
  return JSON.stringify({
    event: 'shipment_status_changed',
    event_ts: new Date().toISOString(),
    organization_id: chance.integer({ min: 1, max: 9999 }),
    payload: {
      shipment_id: shipmentId,
      status: chance.pickone(['delivered', 'taken_by_courier', 'canceled', 'out_for_delivery']),
      tracking_number: chance.string({ length: 24, pool: '0123456789' }),
    },
    ...overrides,
  })
}

function makeConfirmedEnvelope(shipmentId: number, trackingNumber: string): string {
  return JSON.stringify({
    event: 'shipment_confirmed',
    event_ts: new Date().toISOString(),
    organization_id: chance.integer({ min: 1, max: 9999 }),
    payload: {
      shipment_id: shipmentId,
      tracking_number: trackingNumber,
    },
  })
}

describe('verifyInpostWebhook', () => {
  it('verifies a valid HMAC-SHA256 signature and extracts fields from nested payload', async () => {
    const secret = chance.string({ length: 32 })
    const shipmentId = chance.integer({ min: 1000, max: 999999 })
    const eventTs = '2020-03-20T15:08:42.000Z'
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: eventTs,
      organization_id: 1,
      payload: {
        shipment_id: shipmentId,
        status: 'delivered',
        tracking_number: '602677439331630337653846',
      },
    })
    const signature = makeSignature(secret, body)

    const event = await verifyInpostWebhook({
      rawBody: body,
      headers: { 'x-inpost-signature': signature },
      credentials: { webhookSecret: secret },
    })

    expect(event.eventType).toBe('delivered')
    expect(event.eventId).toBe(`${shipmentId}:shipment_status_changed:delivered:${eventTs}`)
    expect(event.idempotencyKey).toBe(event.eventId)
    expect(event.data.status).toBe('delivered')
    expect(event.timestamp).toBeInstanceOf(Date)
    expect(event.timestamp.toISOString()).toBe(eventTs)
  })

  it('maps InPost status to unified status via mapInpostStatus', async () => {
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 1,
      payload: { shipment_id: 42, status: 'taken_by_courier', tracking_number: '123' },
    })

    const event = await verifyInpostWebhook(signed(body))

    expect(event.eventType).toBe('in_transit')
  })

  it('maps shipment_confirmed event to label_created (no status field in payload)', async () => {
    const shipmentId = chance.integer({ min: 1000, max: 999999 })
    const body = makeConfirmedEnvelope(shipmentId, chance.string({ length: 24, pool: '0123456789' }))

    const event = await verifyInpostWebhook(signed(body))

    expect(event.eventType).toBe('label_created')
    expect(event.eventId.startsWith(`${shipmentId}:shipment_confirmed::`)).toBe(true)
    expect(event.data.status).toBe('confirmed')
  })

  it('builds the idempotency key per delivery, not per shipment', async () => {
    const shipmentId = 709709700
    const confirmed = await verifyInpostWebhook(signed(JSON.stringify({
      event: 'shipment_confirmed',
      event_ts: '2020-03-20 15:00:00 +0100',
      organization_id: 12345,
      payload: { shipment_id: shipmentId, tracking_number: '630055758325001130630004' },
    })))
    const inTransit = await verifyInpostWebhook(signed(JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: '2020-03-21 09:00:00 +0100',
      organization_id: 12345,
      payload: { shipment_id: shipmentId, status: 'taken_by_courier' },
    })))
    const delivered = await verifyInpostWebhook(signed(JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: '2020-03-22 12:00:00 +0100',
      organization_id: 12345,
      payload: { shipment_id: shipmentId, status: 'delivered' },
    })))

    const keys = [confirmed, inTransit, delivered].map((event) => event.idempotencyKey)
    expect(new Set(keys).size).toBe(3)
    for (const key of keys) expect(key.startsWith('709709700:')).toBe(true)
  })

  it('produces the same idempotency key for a redelivery of the same event', async () => {
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: '2020-03-22 12:00:00 +0100',
      organization_id: 12345,
      payload: { shipment_id: 42, status: 'delivered' },
    })

    const first = await verifyInpostWebhook(signed(body))
    const retry = await verifyInpostWebhook(signed(body))

    expect(retry.idempotencyKey).toBe(first.idempotencyKey)
  })

  it('exposes the raw InPost status as data.status so the worker maps it exactly once', async () => {
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 1,
      payload: { shipment_id: 7, status: 'taken_by_courier' },
    })

    const event = await verifyInpostWebhook(signed(body))

    expect(event.eventType).toBe('in_transit')
    expect(event.data.status).toBe('taken_by_courier')
  })

  it('extracts timestamp from event_ts field', async () => {
    const eventTs = '2020-03-20 15:08:42 +0100'
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: eventTs,
      organization_id: 1,
      payload: { shipment_id: 49, status: 'delivered', tracking_number: '602677439331630337653846' },
    })

    const event = await verifyInpostWebhook(signed(body))

    expect(event.timestamp).toBeInstanceOf(Date)
    expect(event.timestamp.getTime()).toBe(new Date(eventTs).getTime())
  })

  it('returns unknown eventType when event is unrecognised and status is absent', async () => {
    const body = JSON.stringify({
      event: 'some_future_event',
      event_ts: new Date().toISOString(),
      organization_id: 1,
      payload: { shipment_id: 1 },
    })

    const event = await verifyInpostWebhook(signed(body))

    expect(event.eventType).toBe('unknown')
  })

  it('surfaces return_tracking_number inside data.payload for returned_to_sender events', async () => {
    const returnTrackingNumber = '520107015145404000176000'
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 12345,
      payload: {
        shipment_id: 709709700,
        status: 'returned_to_sender',
        tracking_number: '630055758325001130630004',
        return_tracking_number: returnTrackingNumber,
      },
    })

    const event = await verifyInpostWebhook(signed(body))

    expect(event.eventType).toBe('returned')
    const payload = (event.data as { payload?: { return_tracking_number?: string } }).payload
    expect(payload?.return_tracking_number).toBe(returnTrackingNumber)
  })

  it('rejects a tampered signature', async () => {
    const secret = chance.string({ length: 32 })
    const body = makeStatusChangedEnvelope()
    const badSignature = makeSignature(chance.string({ length: 32 }), body)

    await expect(
      verifyInpostWebhook({
        rawBody: body,
        headers: { 'x-inpost-signature': badSignature },
        credentials: { webhookSecret: secret },
      }),
    ).rejects.toThrow('InPost webhook signature verification failed')
  })

  it('rejects when signature header is missing', async () => {
    const body = makeStatusChangedEnvelope()

    await expect(
      verifyInpostWebhook({
        rawBody: body,
        headers: {},
        credentials: { webhookSecret: chance.string({ length: 32 }) },
      }),
    ).rejects.toThrow('Missing X-Inpost-Signature header')
  })

  it('fails closed when no webhookSecret is configured', async () => {
    const body = makeStatusChangedEnvelope()

    await expect(verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} }))
      .rejects.toThrow('InPost webhook secret is not configured')
    await expect(verifyInpostWebhook({ rawBody: body, headers: {}, credentials: { webhookSecret: '   ' } }))
      .rejects.toThrow('InPost webhook secret is not configured')
  })

  it('rejects a forged status change signed with an arbitrary key when no secret is configured', async () => {
    const body = makeStatusChangedEnvelope()

    await expect(
      verifyInpostWebhook({
        rawBody: body,
        headers: { 'x-inpost-signature': makeSignature(chance.string({ length: 32 }), body) },
        credentials: {},
      }),
    ).rejects.toThrow('InPost webhook secret is not configured')
  })

  it('rejects non-JSON payload', async () => {
    await expect(verifyInpostWebhook(signed(`not-json-${chance.word()}`))).rejects.toThrow('not valid JSON')
  })

  it('handles Buffer rawBody', async () => {
    const secret = chance.string({ length: 32 })
    const shipmentId = chance.integer({ min: 1000, max: 999999 })
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 1,
      payload: { shipment_id: shipmentId, status: 'delivered', tracking_number: '123' },
    })
    const signature = makeSignature(secret, body)

    const event = await verifyInpostWebhook({
      rawBody: Buffer.from(body),
      headers: { 'x-inpost-signature': signature },
      credentials: { webhookSecret: secret },
    })

    expect(event.eventType).toBe('delivered')
    expect(event.eventId.startsWith(`${shipmentId}:`)).toBe(true)
  })

  it('falls back to random UUID when shipment_id is absent', async () => {
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 1,
      payload: { status: 'delivered' },
    })

    const event = await verifyInpostWebhook(signed(body))

    expect(typeof event.eventId).toBe('string')
    expect(event.eventId.length).toBeGreaterThan(0)
  })

  it('falls back to current time when event_ts is absent', async () => {
    const before = Date.now()
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      organization_id: 1,
      payload: { shipment_id: 1, status: 'delivered' },
    })

    const event = await verifyInpostWebhook(signed(body))

    expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('surfaces tracking_number from shipment_confirmed payload as trackingNumber', async () => {
    const trackingNumber = '602677439331630337653846'
    const shipmentId = chance.integer({ min: 1000, max: 999999 })
    const body = makeConfirmedEnvelope(shipmentId, trackingNumber)

    const event = await verifyInpostWebhook(signed(body))

    expect(event.trackingNumber).toBe(trackingNumber)
  })

  it('surfaces tracking_number from shipment_status_changed payload as trackingNumber', async () => {
    const trackingNumber = '630055758325001130630004'
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 1,
      payload: { shipment_id: 42, status: 'delivered', tracking_number: trackingNumber },
    })

    const event = await verifyInpostWebhook(signed(body))

    expect(event.trackingNumber).toBe(trackingNumber)
  })

  it('omits trackingNumber when payload has no tracking_number field', async () => {
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 1,
      payload: { shipment_id: 1, status: 'delivered' },
    })

    const event = await verifyInpostWebhook(signed(body))

    expect(event.trackingNumber).toBeUndefined()
  })
})

describe('extractInpostWebhookShipmentId', () => {
  it('reads payload.shipment_id as a string', () => {
    expect(extractInpostWebhookShipmentId({ payload: { shipment_id: 49 } })).toBe('49')
    expect(extractInpostWebhookShipmentId({ payload: { shipment_id: 'abc' } })).toBe('abc')
  })

  it('returns null when the envelope has no usable shipment id', () => {
    expect(extractInpostWebhookShipmentId({})).toBeNull()
    expect(extractInpostWebhookShipmentId({ payload: 'x' })).toBeNull()
    expect(extractInpostWebhookShipmentId({ payload: { shipment_id: '  ' } })).toBeNull()
    expect(extractInpostWebhookShipmentId({ payload: { shipment_id: null } })).toBeNull()
  })
})
