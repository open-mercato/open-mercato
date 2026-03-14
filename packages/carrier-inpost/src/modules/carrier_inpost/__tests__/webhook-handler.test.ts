import * as crypto from 'node:crypto'
import { verifyInpostWebhook } from '../lib/webhook-handler'

function makeSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyInpostWebhook', () => {
  const secret = 'test-webhook-secret-abc123'
  const body = JSON.stringify({ id: 'evt_001', status: 'delivered', created_at: '2026-03-14T10:00:00Z' })
  const credentials = { webhookSecret: secret }

  it('verifies a valid HMAC-SHA256 signature', async () => {
    const signature = makeSignature(secret, body)
    const event = await verifyInpostWebhook({
      rawBody: body,
      headers: { 'x-inpost-signature': signature },
      credentials,
    })
    expect(event.eventType).toBe('delivered')
    expect(event.eventId).toBe('evt_001')
    expect(event.idempotencyKey).toBe('evt_001')
    expect(event.timestamp).toBeInstanceOf(Date)
    expect(event.data).toMatchObject({ id: 'evt_001', status: 'delivered' })
  })

  it('rejects a tampered signature', async () => {
    const badSignature = makeSignature('wrong-secret', body)
    await expect(
      verifyInpostWebhook({
        rawBody: body,
        headers: { 'x-inpost-signature': badSignature },
        credentials,
      }),
    ).rejects.toThrow('InPost webhook signature verification failed')
  })

  it('rejects when signature header is missing', async () => {
    await expect(
      verifyInpostWebhook({
        rawBody: body,
        headers: {},
        credentials,
      }),
    ).rejects.toThrow('Missing X-Inpost-Signature header')
  })

  it('accepts any payload when no webhookSecret is configured', async () => {
    const event = await verifyInpostWebhook({
      rawBody: body,
      headers: {},
      credentials: {},
    })
    expect(event.eventType).toBe('delivered')
  })

  it('rejects non-JSON payload', async () => {
    await expect(
      verifyInpostWebhook({
        rawBody: 'not-json',
        headers: {},
        credentials: {},
      }),
    ).rejects.toThrow('not valid JSON')
  })

  it('handles Buffer rawBody', async () => {
    const signature = makeSignature(secret, body)
    const event = await verifyInpostWebhook({
      rawBody: Buffer.from(body),
      headers: { 'x-inpost-signature': signature },
      credentials,
    })
    expect(event.eventType).toBe('delivered')
  })
})
