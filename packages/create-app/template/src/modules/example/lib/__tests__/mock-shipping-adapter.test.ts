import { createHmac } from 'node:crypto'
import {
  MOCK_CARRIER_DEV_WEBHOOK_SECRET,
  MOCK_CARRIER_SIGNATURE_HEADER,
  computeMockCarrierWebhookSignature,
  mockShippingAdapter,
} from '../mock-shipping-adapter'

const ORIGINAL_ENV = process.env.MOCK_CARRIER_WEBHOOK_SECRET
const ORIGINAL_NODE_ENV = process.env.NODE_ENV

function resetEnv() {
  if (ORIGINAL_ENV === undefined) delete process.env.MOCK_CARRIER_WEBHOOK_SECRET
  else process.env.MOCK_CARRIER_WEBHOOK_SECRET = ORIGINAL_ENV
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV
}

describe('mockShippingAdapter.verifyWebhook', () => {
  afterEach(() => {
    resetEnv()
  })

  it('throws when the signature header is missing', async () => {
    const rawBody = JSON.stringify({ type: 'shipment.delivered', data: {} })
    await expect(
      mockShippingAdapter.verifyWebhook({
        rawBody,
        headers: {},
        credentials: {},
      }),
    ).rejects.toThrow(/Missing .* header/)
  })

  it('throws when the signature does not match the dev secret', async () => {
    const rawBody = JSON.stringify({ type: 'shipment.delivered', data: { shipmentId: 'mock_shp_1' } })
    const bogus = createHmac('sha256', 'wrong-secret').update(rawBody, 'utf-8').digest('hex')
    await expect(
      mockShippingAdapter.verifyWebhook({
        rawBody,
        headers: { [MOCK_CARRIER_SIGNATURE_HEADER]: bogus },
        credentials: {},
      }),
    ).rejects.toThrow(/Invalid mock carrier webhook signature/)
  })

  it('rejects signatures that were valid for a different body (tamper detection)', async () => {
    const originalBody = JSON.stringify({ type: 'shipment.delivered', data: { shipmentId: 'good' } })
    const tamperedBody = JSON.stringify({ type: 'shipment.delivered', data: { shipmentId: 'evil' } })
    const goodSig = computeMockCarrierWebhookSignature(originalBody, MOCK_CARRIER_DEV_WEBHOOK_SECRET)
    await expect(
      mockShippingAdapter.verifyWebhook({
        rawBody: tamperedBody,
        headers: { [MOCK_CARRIER_SIGNATURE_HEADER]: goodSig },
        credentials: {},
      }),
    ).rejects.toThrow(/Invalid mock carrier webhook signature/)
  })

  it('accepts a payload signed with the dev fallback secret', async () => {
    const rawBody = JSON.stringify({
      type: 'shipment.delivered',
      id: 'evt_abc',
      data: { shipmentId: 'mock_shp_abc', status: 'delivered' },
    })
    const sig = computeMockCarrierWebhookSignature(rawBody, MOCK_CARRIER_DEV_WEBHOOK_SECRET)
    const event = await mockShippingAdapter.verifyWebhook({
      rawBody,
      headers: { [MOCK_CARRIER_SIGNATURE_HEADER]: sig },
      credentials: {},
    })
    expect(event.eventType).toBe('shipment.delivered')
    expect(event.eventId).toBe('evt_abc')
  })

  it('prefers credentials.webhookSecret over the env fallback', async () => {
    process.env.MOCK_CARRIER_WEBHOOK_SECRET = 'env-only-secret'
    const rawBody = JSON.stringify({ type: 'shipment.in_transit', data: {} })
    const sig = computeMockCarrierWebhookSignature(rawBody, 'tenant-secret')
    const event = await mockShippingAdapter.verifyWebhook({
      rawBody,
      headers: { [MOCK_CARRIER_SIGNATURE_HEADER]: sig },
      credentials: { webhookSecret: 'tenant-secret' },
    })
    expect(event.eventType).toBe('shipment.in_transit')
  })

  it('falls back to MOCK_CARRIER_WEBHOOK_SECRET when credentials omit the secret', async () => {
    process.env.MOCK_CARRIER_WEBHOOK_SECRET = 'env-only-secret'
    const rawBody = JSON.stringify({ type: 'shipment.in_transit', data: {} })
    const sig = computeMockCarrierWebhookSignature(rawBody, 'env-only-secret')
    await expect(
      mockShippingAdapter.verifyWebhook({
        rawBody,
        headers: { [MOCK_CARRIER_SIGNATURE_HEADER]: sig },
        credentials: {},
      }),
    ).resolves.toMatchObject({ eventType: 'shipment.in_transit' })
  })

  it('refuses to fall back to the dev secret in production', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MOCK_CARRIER_WEBHOOK_SECRET
    const rawBody = JSON.stringify({ type: 'shipment.delivered', data: {} })
    const sig = computeMockCarrierWebhookSignature(rawBody, MOCK_CARRIER_DEV_WEBHOOK_SECRET)
    await expect(
      mockShippingAdapter.verifyWebhook({
        rawBody,
        headers: { [MOCK_CARRIER_SIGNATURE_HEADER]: sig },
        credentials: {},
      }),
    ).rejects.toThrow(/Mock carrier webhook secret is not configured/)
  })
})
