/** @jest-environment node */
import Stripe from 'stripe'
import { POST } from '@open-mercato/core/modules/payment_gateways/api/webhook/[provider]/route'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import { DEFAULT_WEBHOOK_BODY_LIMIT_BYTES } from '@open-mercato/shared/lib/webhooks'
import { register } from '../di'
import { readStripeSessionIdHint, verifyStripeWebhook } from '../lib/webhook-handler'

const mockResolve = jest.fn()
const mockRateLimiterService = { trustProxyDepth: 1, consume: jest.fn() }
const mockEnqueue = jest.fn(async () => undefined)
const mockCredentialsResolve = jest.fn(async () => ({}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockResolve })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/payment_gateways/lib/queue', () => ({
  getPaymentGatewayQueue: jest.fn(() => ({ enqueue: mockEnqueue })),
}))

jest.mock('../lib/webhook-handler', () => {
  const actual = jest.requireActual('../lib/webhook-handler')
  return {
    ...actual,
    verifyStripeWebhook: jest.fn(actual.verifyStripeWebhook),
    readStripeSessionIdHint: jest.fn(actual.readStripeSessionIdHint),
  }
})

const WEBHOOK_URL = 'http://localhost/api/payment_gateways/webhook/stripe'

function chunkedBody(totalBytes: number, chunkBytes = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()
        return
      }
      const size = Math.min(chunkBytes, totalBytes - sent)
      controller.enqueue(new Uint8Array(size).fill(0x20))
      sent += size
    },
  })
}

function streamedRequest(totalBytes: number, headers: Record<string, string> = {}): Request {
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00', ...headers },
    body: chunkedBody(totalBytes),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

function paddedEventJson(totalBytes: number): string {
  const prefix = '{"id":"evt_test","type":"payment_intent.succeeded","data":{"object":{"id":"pi_test"}},"pad":"'
  const suffix = '"}'
  return prefix + 'x'.repeat(totalBytes - prefix.length - suffix.length) + suffix
}

describe('Stripe webhook body limit', () => {
  const originalLimitEnv = process.env.OM_WEBHOOK_MAX_BODY_BYTES

  beforeAll(() => {
    delete process.env.OM_WEBHOOK_MAX_BODY_BYTES
  })

  afterAll(() => {
    if (originalLimitEnv === undefined) delete process.env.OM_WEBHOOK_MAX_BODY_BYTES
    else process.env.OM_WEBHOOK_MAX_BODY_BYTES = originalLimitEnv
  })

  beforeEach(() => {
    register({ register: jest.fn() } as never)
    jest.clearAllMocks()
    mockRateLimiterService.consume.mockResolvedValue({
      allowed: true,
      remainingPoints: 59,
      msBeforeNext: 0,
      consumedPoints: 1,
    })
    mockResolve.mockImplementation((token: string) => {
      if (token === 'rateLimiterService') return mockRateLimiterService
      if (token === 'em') return {}
      if (token === 'paymentGatewayService') return {}
      if (token === 'integrationCredentialsService') return { resolve: mockCredentialsResolve }
      if (token === 'integrationLogService') return {}
      throw new Error(`[internal] Unexpected token: ${token}`)
    })
  })

  test('the Stripe registration caps bodies at the shared webhook limit', () => {
    expect(getWebhookHandler('stripe')?.maxBodyBytes).toBe(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES)
  })

  test.each([
    ['4096', 4096],
    [String(10 * 1024 * 1024), DEFAULT_WEBHOOK_BODY_LIMIT_BYTES],
  ])('honours OM_WEBHOOK_MAX_BODY_BYTES=%s only when it is lower than 1 MiB', (envValue, expected) => {
    const previous = process.env.OM_WEBHOOK_MAX_BODY_BYTES
    process.env.OM_WEBHOOK_MAX_BODY_BYTES = envValue
    try {
      jest.isolateModules(() => {
        const isolatedTypes = require('@open-mercato/shared/modules/payment_gateways/types') as typeof import('@open-mercato/shared/modules/payment_gateways/types')
        const isolatedDi = require('../di') as typeof import('../di')
        isolatedDi.register({ register: jest.fn() } as never)
        expect(isolatedTypes.getWebhookHandler('stripe')?.maxBodyBytes).toBe(expected)
      })
    } finally {
      if (previous === undefined) delete process.env.OM_WEBHOOK_MAX_BODY_BYTES
      else process.env.OM_WEBHOOK_MAX_BODY_BYTES = previous
      register({ register: jest.fn() } as never)
    }
  })

  test('rejects a body whose Content-Length exceeds the limit without verifying or locating', async () => {
    const response = await POST(
      new Request(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES + 1),
        },
        body: '{}',
      }),
      { params: { provider: 'stripe' } },
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Webhook payload too large' })
    expect(readStripeSessionIdHint).not.toHaveBeenCalled()
    expect(verifyStripeWebhook).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  test('rejects an oversized chunked body without a Content-Length', async () => {
    const response = await POST(streamedRequest(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES * 4), { params: { provider: 'stripe' } })

    expect(response.status).toBe(413)
    expect(readStripeSessionIdHint).not.toHaveBeenCalled()
    expect(verifyStripeWebhook).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  test('rejects an oversized body that declares a small Content-Length', async () => {
    const response = await POST(
      streamedRequest(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES + 1, { 'content-length': '2' }),
      { params: { provider: 'stripe' } },
    )

    expect(response.status).toBe(413)
    expect(readStripeSessionIdHint).not.toHaveBeenCalled()
    expect(verifyStripeWebhook).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  test('still reads an event of exactly the limit and looks up its transaction', async () => {
    const response = await POST(
      new Request(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' },
        body: paddedEventJson(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES),
      }),
      { params: { provider: 'stripe' } },
    )

    expect(response.status).toBe(401)
    expect(readStripeSessionIdHint).toHaveBeenCalledTimes(1)
    expect(findWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ providerKey: 'stripe', providerSessionId: 'pi_test' }),
      expect.anything(),
    )
  })

  test('accepts a correctly signed event just under the limit and queues it', async () => {
    const previousStrategy = process.env.QUEUE_STRATEGY
    process.env.QUEUE_STRATEGY = 'async'
    const webhookSecret = 'whsec_body_limit_test'
    const payload = paddedEventJson(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES - 4096)
    const signature = new Stripe('sk_test_body_limit').webhooks.generateTestHeaderString({ payload, secret: webhookSecret })
    ;(findWithDecryption as jest.Mock).mockResolvedValueOnce([
      {
        id: 'transaction-1',
        paymentId: 'payment-1',
        providerSessionId: 'pi_test',
        amount: '10.00',
        currencyCode: 'USD',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    ])
    mockCredentialsResolve.mockResolvedValueOnce({ secretKey: 'sk_test_body_limit', webhookSecret })
    try {
      const response = await POST(
        new Request(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'stripe-signature': signature },
          body: payload,
        }),
        { params: { provider: 'stripe' } },
      )

      expect(response.status).toBe(202)
      expect(verifyStripeWebhook).toHaveBeenCalledTimes(1)
      expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
        providerKey: 'stripe',
        transactionId: 'transaction-1',
        event: expect.objectContaining({ eventId: 'evt_test', eventType: 'payment_intent.succeeded' }),
      }))
    } finally {
      if (previousStrategy === undefined) delete process.env.QUEUE_STRATEGY
      else process.env.QUEUE_STRATEGY = previousStrategy
    }
  })
})
