import Chance from 'chance'
import * as crypto from 'node:crypto'
import { verifyInpostWebhook } from '../lib/webhook-handler'

const chance = new Chance()

function makeSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
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
    expect(event.eventId).toBe(String(shipmentId))
    expect(event.idempotencyKey).toBe(String(shipmentId))
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

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

    expect(event.eventType).toBe('in_transit')
  })

  it('maps shipment_confirmed event to label_created (no status field in payload)', async () => {
    const shipmentId = chance.integer({ min: 1000, max: 999999 })
    const body = makeConfirmedEnvelope(shipmentId, chance.string({ length: 24, pool: '0123456789' }))

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

    expect(event.eventType).toBe('label_created')
    expect(event.eventId).toBe(String(shipmentId))
  })

  it('extracts eventId from payload.shipment_id (integer)', async () => {
    const shipmentId = 709709700
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 12345,
      payload: { shipment_id: shipmentId, status: 'returned_to_sender', tracking_number: '630055758325001130630004' },
    })

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

    expect(event.eventId).toBe('709709700')
    expect(event.idempotencyKey).toBe('709709700')
  })

  it('extracts timestamp from event_ts field', async () => {
    const eventTs = '2020-03-20 15:08:42 +0100'
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: eventTs,
      organization_id: 1,
      payload: { shipment_id: 49, status: 'delivered', tracking_number: '602677439331630337653846' },
    })

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

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

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

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

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

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

  it('accepts any payload when no webhookSecret is configured', async () => {
    const body = makeStatusChangedEnvelope()

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

    expect(event.eventType).toBeDefined()
  })

  it('rejects non-JSON payload', async () => {
    await expect(
      verifyInpostWebhook({
        rawBody: `not-json-${chance.word()}`,
        headers: {},
        credentials: {},
      }),
    ).rejects.toThrow('not valid JSON')
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
    expect(event.eventId).toBe(String(shipmentId))
  })

  it('falls back to random UUID when shipment_id is absent', async () => {
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 1,
      payload: { status: 'delivered' },
    })

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

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

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

    expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('surfaces tracking_number from shipment_confirmed payload as trackingNumber', async () => {
    const trackingNumber = '602677439331630337653846'
    const shipmentId = chance.integer({ min: 1000, max: 999999 })
    const body = makeConfirmedEnvelope(shipmentId, trackingNumber)

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

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

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

    expect(event.trackingNumber).toBe(trackingNumber)
  })

  it('omits trackingNumber when payload has no tracking_number field', async () => {
    const body = JSON.stringify({
      event: 'shipment_status_changed',
      event_ts: new Date().toISOString(),
      organization_id: 1,
      payload: { shipment_id: 1, status: 'delivered' },
    })

    const event = await verifyInpostWebhook({ rawBody: body, headers: {}, credentials: {} })

    expect(event.trackingNumber).toBeUndefined()
  })
})
