import { createHmac } from 'node:crypto'
import {
  MOCK_GATEWAY_DEV_WEBHOOK_SECRET,
  MOCK_GATEWAY_SIGNATURE_HEADER,
  computeMockWebhookSignature,
  mockGatewayAdapter,
} from '../mock-gateway-adapter'

const ORIGINAL_ENV = process.env.MOCK_GATEWAY_WEBHOOK_SECRET
const ORIGINAL_NODE_ENV = process.env.NODE_ENV

function resetEnv() {
  if (ORIGINAL_ENV === undefined) delete process.env.MOCK_GATEWAY_WEBHOOK_SECRET
  else process.env.MOCK_GATEWAY_WEBHOOK_SECRET = ORIGINAL_ENV
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV
}

describe('mockGatewayAdapter.verifyWebhook', () => {
  afterEach(() => {
    resetEnv()
  })

  it('throws when the signature header is missing', async () => {
    const rawBody = JSON.stringify({ type: 'mock.event', data: {} })
    await expect(
      mockGatewayAdapter.verifyWebhook({
        rawBody,
        headers: {},
        credentials: {},
      }),
    ).rejects.toThrow(/Missing .* header/)
  })

  it('throws when the signature does not match the dev secret', async () => {
    const rawBody = JSON.stringify({ type: 'payment.captured', data: { id: 'mock_pi_1' } })
    const bogus = createHmac('sha256', 'wrong-secret').update(rawBody, 'utf-8').digest('hex')
    await expect(
      mockGatewayAdapter.verifyWebhook({
        rawBody,
        headers: { [MOCK_GATEWAY_SIGNATURE_HEADER]: bogus },
        credentials: {},
      }),
    ).rejects.toThrow(/Invalid mock webhook signature/)
  })

  it('rejects signatures that were valid for a different body (tamper detection)', async () => {
    const originalBody = JSON.stringify({ type: 'mock.event', data: { id: 'mock_pi_good' } })
    const tamperedBody = JSON.stringify({ type: 'mock.event', data: { id: 'mock_pi_evil' } })
    const goodSig = computeMockWebhookSignature(originalBody, MOCK_GATEWAY_DEV_WEBHOOK_SECRET)
    await expect(
      mockGatewayAdapter.verifyWebhook({
        rawBody: tamperedBody,
        headers: { [MOCK_GATEWAY_SIGNATURE_HEADER]: goodSig },
        credentials: {},
      }),
    ).rejects.toThrow(/Invalid mock webhook signature/)
  })

  it('accepts a payload signed with the dev fallback secret', async () => {
    const rawBody = JSON.stringify({
      type: 'payment.captured',
      id: 'evt_abc',
      data: { id: 'mock_pi_abc', status: 'captured', amount: 100 },
    })
    const sig = computeMockWebhookSignature(rawBody, MOCK_GATEWAY_DEV_WEBHOOK_SECRET)
    const event = await mockGatewayAdapter.verifyWebhook({
      rawBody,
      headers: { [MOCK_GATEWAY_SIGNATURE_HEADER]: sig },
      credentials: {},
    })
    expect(event.eventType).toBe('payment.captured')
    expect(event.eventId).toBe('evt_abc')
  })

  it('prefers credentials.webhookSecret over the env fallback', async () => {
    process.env.MOCK_GATEWAY_WEBHOOK_SECRET = 'env-only-secret'
    const rawBody = JSON.stringify({ type: 'mock.event', data: {} })
    const sig = computeMockWebhookSignature(rawBody, 'tenant-secret')
    const event = await mockGatewayAdapter.verifyWebhook({
      rawBody,
      headers: { [MOCK_GATEWAY_SIGNATURE_HEADER]: sig },
      credentials: { webhookSecret: 'tenant-secret' },
    })
    expect(event.eventType).toBe('mock.event')
  })

  it('falls back to MOCK_GATEWAY_WEBHOOK_SECRET when credentials omit the secret', async () => {
    process.env.MOCK_GATEWAY_WEBHOOK_SECRET = 'env-only-secret'
    const rawBody = JSON.stringify({ type: 'mock.event', data: {} })
    const sig = computeMockWebhookSignature(rawBody, 'env-only-secret')
    await expect(
      mockGatewayAdapter.verifyWebhook({
        rawBody,
        headers: { [MOCK_GATEWAY_SIGNATURE_HEADER]: sig },
        credentials: {},
      }),
    ).resolves.toMatchObject({ eventType: 'mock.event' })
  })

  it('refuses to fall back to the dev secret in production', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MOCK_GATEWAY_WEBHOOK_SECRET
    const rawBody = JSON.stringify({ type: 'mock.event', data: {} })
    const sig = computeMockWebhookSignature(rawBody, MOCK_GATEWAY_DEV_WEBHOOK_SECRET)
    await expect(
      mockGatewayAdapter.verifyWebhook({
        rawBody,
        headers: { [MOCK_GATEWAY_SIGNATURE_HEADER]: sig },
        credentials: {},
      }),
    ).rejects.toThrow(/Mock gateway webhook secret is not configured/)
  })
})
