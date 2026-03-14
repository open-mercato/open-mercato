import Chance from 'chance'
import * as crypto from 'node:crypto'
import { verifyInpostWebhook } from '../lib/webhook-handler'

const chance = new Chance()

function makeSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function makeWebhookBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `evt_${chance.guid()}`,
    status: chance.pickone(['delivered', 'in_transit', 'canceled', 'out_for_delivery']),
    created_at: new Date().toISOString(),
    ...overrides,
  })
}

describe('verifyInpostWebhook', () => {
  it('verifies a valid HMAC-SHA256 signature', async () => {
    const secret = chance.string({ length: 32 })
    const eventId = `evt_${chance.guid()}`
    const status = chance.pickone(['delivered', 'in_transit', 'out_for_delivery'])
    const body = makeWebhookBody({ id: eventId, status })
    const signature = makeSignature(secret, body)

    const event = await verifyInpostWebhook({
      rawBody: body,
      headers: { 'x-inpost-signature': signature },
      credentials: { webhookSecret: secret },
    })

    expect(event.eventType).toBe(status)
    expect(event.eventId).toBe(eventId)
    expect(event.idempotencyKey).toBe(eventId)
    expect(event.timestamp).toBeInstanceOf(Date)
    expect(event.data).toMatchObject({ id: eventId, status })
  })

  it('rejects a tampered signature', async () => {
    const secret = chance.string({ length: 32 })
    const body = makeWebhookBody()
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
    const body = makeWebhookBody()

    await expect(
      verifyInpostWebhook({
        rawBody: body,
        headers: {},
        credentials: { webhookSecret: chance.string({ length: 32 }) },
      }),
    ).rejects.toThrow('Missing X-Inpost-Signature header')
  })

  it('accepts any payload when no webhookSecret is configured', async () => {
    const status = 'delivered'
    const body = makeWebhookBody({ status })

    const event = await verifyInpostWebhook({
      rawBody: body,
      headers: {},
      credentials: {},
    })

    expect(event.eventType).toBe(status)
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
    const status = 'delivered'
    const body = makeWebhookBody({ status })
    const signature = makeSignature(secret, body)

    const event = await verifyInpostWebhook({
      rawBody: Buffer.from(body),
      headers: { 'x-inpost-signature': signature },
      credentials: { webhookSecret: secret },
    })

    expect(event.eventType).toBe(status)
  })
})
