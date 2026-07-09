/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/payment_gateways/api/webhook/[provider]/route'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import { getPaymentGatewayQueue } from '@open-mercato/core/modules/payment_gateways/lib/queue'
import { processPaymentGatewayWebhookJob } from '@open-mercato/core/modules/payment_gateways/lib/webhook-processor'

const mockResolve = jest.fn()
const mockRateLimiterService = { trustProxyDepth: 1, consume: jest.fn() }
const mockCredentialsService = { resolve: jest.fn() }
const mockQueue = { enqueue: jest.fn() }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: mockResolve,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/modules/payment_gateways/types', () => ({
  getWebhookHandler: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/payment_gateways/lib/queue', () => ({
  getPaymentGatewayQueue: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/payment_gateways/lib/webhook-processor', () => ({
  processPaymentGatewayWebhookJob: jest.fn(),
}))

function createMockRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/payment_gateways/webhook/stripe', {
    method: 'POST',
    headers,
    body,
  })
}

describe('payment gateway webhook route security', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRateLimiterService.consume.mockResolvedValue({
      allowed: true,
      remainingPoints: 59,
      msBeforeNext: 0,
      consumedPoints: 1,
    })
    mockCredentialsService.resolve.mockResolvedValue({})
    mockResolve.mockImplementation((token: string) => {
      if (token === 'rateLimiterService') return mockRateLimiterService
      if (token === 'em') return {}
      if (token === 'paymentGatewayService') return {}
      if (token === 'integrationCredentialsService') return mockCredentialsService
      if (token === 'integrationLogService') return {}
      throw new Error(`Unexpected token: ${token}`)
    })
    ;(getPaymentGatewayQueue as jest.Mock).mockReturnValue(mockQueue)
  })

  test('rate limits unauthenticated provider webhooks before parsing the body', async () => {
    const request = createMockRequest('{"session":"sess_1"}', { 'x-forwarded-for': '203.0.113.9' })
    const getReaderSpy = jest.spyOn(request.body!, 'getReader')
    ;(getWebhookHandler as jest.Mock).mockReturnValue({
      handler: jest.fn(),
      readSessionIdHint: jest.fn(),
    })
    mockRateLimiterService.consume.mockResolvedValueOnce({
      allowed: false,
      remainingPoints: 0,
      msBeforeNext: 30_000,
      consumedPoints: 61,
    })

    const response = await POST(request, { params: { provider: 'stripe' } })

    expect(response.status).toBe(429)
    expect(mockRateLimiterService.consume).toHaveBeenCalledWith('stripe:203.0.113.9', {
      points: 60,
      duration: 60,
      keyPrefix: 'payment_gateways:webhook',
    })
    expect(getReaderSpy).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  test('rejects an oversized declared body before verification', async () => {
    const handler = jest.fn()
    ;(getWebhookHandler as jest.Mock).mockReturnValue({
      handler,
      readSessionIdHint: jest.fn(),
    })
    const request = new Request('http://localhost/api/payment_gateways/webhook/stripe', {
      method: 'POST',
      headers: { 'content-length': String(1024 * 1024 + 1) },
      body: '{}',
    })

    const response = await POST(request, { params: { provider: 'stripe' } })

    expect(response.status).toBe(413)
    expect(handler).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  test('does not reflect verifier exception details to unauthenticated callers', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const handler = jest.fn().mockRejectedValue(new Error('secret verifier internals'))
    ;(getWebhookHandler as jest.Mock).mockReturnValue({
      handler,
      readSessionIdHint: () => 'sess_1',
    })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([{
      id: 'txn_1',
      organizationId: 'org_1',
      tenantId: 'tenant_1',
    }])

    const response = await POST(createMockRequest('{"session":"sess_1"}'), { params: { provider: 'stripe' } })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Webhook verification failed' })
    expect(JSON.stringify(body)).not.toContain('secret verifier internals')
    expect(processPaymentGatewayWebhookJob).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
