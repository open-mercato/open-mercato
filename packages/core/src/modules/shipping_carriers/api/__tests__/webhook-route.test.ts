/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/shipping_carriers/api/webhook/[provider]/route'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import { getShippingCarrierQueue } from '@open-mercato/core/modules/shipping_carriers/lib/queue'

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

jest.mock('@open-mercato/core/modules/shipping_carriers/lib/adapter-registry', () => ({
  getShippingAdapter: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/shipping_carriers/lib/queue', () => ({
  getShippingCarrierQueue: jest.fn(),
}))

function createMockRequest(body: string, headers: Record<string, string> = {}): Request {
  return {
    method: 'POST',
    headers: new Headers(headers),
    text: jest.fn(async () => body),
  } as unknown as Request
}

describe('shipping carrier webhook route security', () => {
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
      if (token === 'integrationCredentialsService') return mockCredentialsService
      throw new Error(`Unexpected token: ${token}`)
    })
    ;(getShippingCarrierQueue as jest.Mock).mockReturnValue(mockQueue)
  })

  test('rate limits unauthenticated provider webhooks before parsing the body', async () => {
    const request = createMockRequest('{"shipmentId":"ship_1"}', { 'x-forwarded-for': '203.0.113.10' })
    ;(getShippingAdapter as jest.Mock).mockReturnValue({
      verifyWebhook: jest.fn(),
    })
    mockRateLimiterService.consume.mockResolvedValueOnce({
      allowed: false,
      remainingPoints: 0,
      msBeforeNext: 30_000,
      consumedPoints: 61,
    })

    const response = await POST(request, { params: { provider: 'shippo' } })

    expect(response.status).toBe(429)
    expect(mockRateLimiterService.consume).toHaveBeenCalledWith('shippo:203.0.113.10', {
      points: 60,
      duration: 60,
      keyPrefix: 'shipping_carriers:webhook',
    })
    expect(request.text).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  test('does not reflect verifier exception details to unauthenticated callers', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    ;(getShippingAdapter as jest.Mock).mockReturnValue({
      verifyWebhook: jest.fn().mockRejectedValue(new Error('carrier verifier internals')),
    })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([{
      id: 'shipment_1',
      organizationId: 'org_1',
      tenantId: 'tenant_1',
    }])

    const response = await POST(createMockRequest('{"shipmentId":"ship_1"}'), { params: { provider: 'shippo' } })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Webhook verification failed' })
    expect(JSON.stringify(body)).not.toContain('carrier verifier internals')
    expect(mockQueue.enqueue).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
