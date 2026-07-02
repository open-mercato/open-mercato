import { createHmac } from 'node:crypto'
import {
  MOCK_INBOUND_DEV_WEBHOOK_SECRET,
  MOCK_INBOUND_SIGNATURE_HEADER,
  computeMockInboundWebhookSignature,
  mockWebhookEndpointAdapter,
} from '../mock-webhook-endpoint-adapter'

const ORIGINAL_SECRET_ENV = process.env.MOCK_INBOUND_WEBHOOK_SECRET
const ORIGINAL_NODE_ENV = process.env.NODE_ENV

function resetEnv() {
  if (ORIGINAL_SECRET_ENV === undefined) delete process.env.MOCK_INBOUND_WEBHOOK_SECRET
  else process.env.MOCK_INBOUND_WEBHOOK_SECRET = ORIGINAL_SECRET_ENV
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV
}

describe('mockWebhookEndpointAdapter.verifyWebhook', () => {
  afterEach(() => {
    resetEnv()
  })

  it('throws when the signature header is missing', async () => {
    const body = JSON.stringify({ type: 'mock.inbound.received', data: {} })
    await expect(
      mockWebhookEndpointAdapter.verifyWebhook({
        headers: {},
        body,
        method: 'POST',
      }),
    ).rejects.toThrow(/Missing .* header/)
  })

  it('rejects the legacy hardcoded literal signature', async () => {
    const body = JSON.stringify({ type: 'mock.inbound.received', data: {} })
    await expect(
      mockWebhookEndpointAdapter.verifyWebhook({
        headers: { [MOCK_INBOUND_SIGNATURE_HEADER]: 'valid' },
        body,
        method: 'POST',
      }),
    ).rejects.toThrow(/Invalid mock webhook signature/)
  })

  it('throws when the signature does not match the dev secret', async () => {
    const body = JSON.stringify({ type: 'mock.inbound.received', data: { id: 'evt_1' } })
    const bogus = createHmac('sha256', 'wrong-secret').update(body, 'utf-8').digest('hex')
    await expect(
      mockWebhookEndpointAdapter.verifyWebhook({
        headers: { [MOCK_INBOUND_SIGNATURE_HEADER]: bogus },
        body,
        method: 'POST',
      }),
    ).rejects.toThrow(/Invalid mock webhook signature/)
  })

  it('rejects signatures that were valid for a different body (tamper detection)', async () => {
    const originalBody = JSON.stringify({ type: 'mock.inbound.received', data: { id: 'good' } })
    const tamperedBody = JSON.stringify({ type: 'mock.inbound.received', data: { id: 'evil' } })
    const goodSignature = computeMockInboundWebhookSignature(originalBody, MOCK_INBOUND_DEV_WEBHOOK_SECRET)
    await expect(
      mockWebhookEndpointAdapter.verifyWebhook({
        headers: { [MOCK_INBOUND_SIGNATURE_HEADER]: goodSignature },
        body: tamperedBody,
        method: 'POST',
      }),
    ).rejects.toThrow(/Invalid mock webhook signature/)
  })

  it('accepts a payload signed with the dev fallback secret', async () => {
    const body = JSON.stringify({ type: 'order.created', data: { id: 'order_1' } })
    const signature = computeMockInboundWebhookSignature(body, MOCK_INBOUND_DEV_WEBHOOK_SECRET)
    const event = await mockWebhookEndpointAdapter.verifyWebhook({
      headers: { [MOCK_INBOUND_SIGNATURE_HEADER]: signature },
      body,
      method: 'POST',
    })
    expect(event.eventType).toBe('order.created')
    expect(event.payload).toMatchObject({ data: { id: 'order_1' } })
  })

  it('falls back to mock.inbound.received when the body omits a type', async () => {
    const body = JSON.stringify({ data: { id: 'order_2' } })
    const signature = computeMockInboundWebhookSignature(body, MOCK_INBOUND_DEV_WEBHOOK_SECRET)
    const event = await mockWebhookEndpointAdapter.verifyWebhook({
      headers: { [MOCK_INBOUND_SIGNATURE_HEADER]: signature },
      body,
      method: 'POST',
    })
    expect(event.eventType).toBe('mock.inbound.received')
  })

  it('verifies signatures computed with MOCK_INBOUND_WEBHOOK_SECRET', async () => {
    process.env.MOCK_INBOUND_WEBHOOK_SECRET = 'env-only-secret'
    const body = JSON.stringify({ type: 'mock.inbound.received', data: {} })
    const signature = computeMockInboundWebhookSignature(body, 'env-only-secret')
    await expect(
      mockWebhookEndpointAdapter.verifyWebhook({
        headers: { [MOCK_INBOUND_SIGNATURE_HEADER]: signature },
        body,
        method: 'POST',
      }),
    ).resolves.toMatchObject({ eventType: 'mock.inbound.received' })
  })

  it('verifies the production secret wired by the ephemeral integration harness', async () => {
    process.env.NODE_ENV = 'production'
    process.env.MOCK_INBOUND_WEBHOOK_SECRET = 'open-mercato-mock-dev-inbound-webhook-secret'
    const body = JSON.stringify({ type: 'mock.inbound.received', data: { externalId: 'ext-1' } })
    const signature = computeMockInboundWebhookSignature(body, 'open-mercato-mock-dev-inbound-webhook-secret')
    await expect(
      mockWebhookEndpointAdapter.verifyWebhook({
        headers: { [MOCK_INBOUND_SIGNATURE_HEADER]: signature },
        body,
        method: 'POST',
      }),
    ).resolves.toMatchObject({ eventType: 'mock.inbound.received' })
  })

  it('refuses to fall back to the dev secret in production', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MOCK_INBOUND_WEBHOOK_SECRET
    const body = JSON.stringify({ type: 'mock.inbound.received', data: {} })
    const signature = computeMockInboundWebhookSignature(body, MOCK_INBOUND_DEV_WEBHOOK_SECRET)
    await expect(
      mockWebhookEndpointAdapter.verifyWebhook({
        headers: { [MOCK_INBOUND_SIGNATURE_HEADER]: signature },
        body,
        method: 'POST',
      }),
    ).rejects.toThrow(/Mock inbound webhook secret is not configured/)
  })
})
