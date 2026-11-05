/** @jest-environment node */
import { createHmac } from 'node:crypto'
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
  return new Request('http://localhost/api/shipping_carriers/webhook/shippo', {
    method: 'POST',
    headers,
    body,
  })
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
    const getReaderSpy = jest.spyOn(request.body!, 'getReader')
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
    expect(getReaderSpy).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  test('rejects an oversized declared body before adapter verification', async () => {
    const verifyWebhook = jest.fn()
    ;(getShippingAdapter as jest.Mock).mockReturnValue({ verifyWebhook })
    const request = createMockRequest('{}', {
      'content-length': String(1024 * 1024 + 1),
    })

    const response = await POST(request, { params: { provider: 'shippo' } })

    expect(response.status).toBe(413)
    expect(verifyWebhook).not.toHaveBeenCalled()
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
  test('enqueues the job payload the webhook worker reads, without an extra envelope', async () => {
    const event = {
      eventType: 'shipment.delivered',
      eventId: 'evt_1',
      idempotencyKey: 'evt_1',
      data: { shipmentId: 'ship_1', status: 'delivered' },
      timestamp: new Date('2026-01-01T00:00:00Z'),
    }
    ;(getShippingAdapter as jest.Mock).mockReturnValue({ verifyWebhook: jest.fn().mockResolvedValue(event) })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([{
      id: 'shipment_1',
      organizationId: 'org_1',
      tenantId: 'tenant_1',
    }])

    const response = await POST(createMockRequest('{"shipmentId":"ship_1"}'), { params: { provider: 'shippo' } })

    expect(response.status).toBe(202)
    expect(mockQueue.enqueue).toHaveBeenCalledTimes(1)
    expect(mockQueue.enqueue).toHaveBeenCalledWith({
      providerKey: 'shippo',
      event,
      shipmentId: 'shipment_1',
      scope: { organizationId: 'org_1', tenantId: 'tenant_1' },
    })
  })

  test('locates the shipment through the adapter extractor when the carrier nests its shipment id', async () => {
    const event = { eventType: 'delivered', eventId: 'e1', idempotencyKey: 'e1', data: {}, timestamp: new Date() }
    const verifyWebhook = jest.fn().mockResolvedValue(event)
    const extractWebhookShipmentId = jest.fn().mockReturnValue('709709700')
    ;(getShippingAdapter as jest.Mock).mockReturnValue({ verifyWebhook, extractWebhookShipmentId })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([{
      id: 'shipment_1',
      organizationId: 'org_1',
      tenantId: 'tenant_1',
    }])
    const rawBody = JSON.stringify({ event: 'shipment_status_changed', payload: { shipment_id: 709709700, status: 'delivered' } })

    const response = await POST(createMockRequest(rawBody), { params: { provider: 'inpost' } })

    expect(response.status).toBe(202)
    expect(extractWebhookShipmentId).toHaveBeenCalledWith(JSON.parse(rawBody))
    expect(findWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ providerKey: 'inpost', carrierShipmentId: '709709700' }),
      expect.anything(),
    )
    expect(mockQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      providerKey: 'inpost',
      shipmentId: 'shipment_1',
      scope: { organizationId: 'org_1', tenantId: 'tenant_1' },
    }))
  })

  test('falls back to the generic shipmentId lookup when the adapter extractor finds nothing', async () => {
    const verifyWebhook = jest.fn().mockRejectedValue(new Error('bad signature'))
    ;(getShippingAdapter as jest.Mock).mockReturnValue({ verifyWebhook, extractWebhookShipmentId: () => null })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    const response = await POST(createMockRequest('{"shipmentId":"ship_1"}'), { params: { provider: 'shippo' } })

    expect(response.status).toBe(401)
    expect(findWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ carrierShipmentId: 'ship_1' }),
      expect.anything(),
    )
  })

  test.each([
    ['org_2', 'tenant_1'],
    ['org_2', 'tenant_2'],
    ['org_1', 'tenant_1'],
  ])('rejects multiple verified shipments, including scope %s / %s', async (organizationId, tenantId) => {
    const event = { eventType: 'delivered', eventId: 'e1', idempotencyKey: 'e1', data: {}, timestamp: new Date() }
    const rawBody = '{"shipmentId":"ship_1"}'
    const signature = createHmac('sha256', 'shared-test-secret').update(rawBody).digest('hex')
    const verifyWebhook = jest.fn(async (input: {
      rawBody: string; headers: Record<string, string>; credentials: { webhookSecret: string }
    }) => {
      const expected = createHmac('sha256', input.credentials.webhookSecret).update(input.rawBody).digest('hex')
      if (input.headers['x-signature'] !== expected) throw new Error('[internal] Invalid test signature')
      return event
    })
    ;(getShippingAdapter as jest.Mock).mockReturnValue({ verifyWebhook })
    mockCredentialsService.resolve.mockResolvedValue({ webhookSecret: 'shared-test-secret' })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      { id: 'shipment_1', organizationId: 'org_1', tenantId: 'tenant_1' },
      { id: 'shipment_2', organizationId, tenantId },
    ])

    const response = await POST(createMockRequest(rawBody, { 'x-signature': signature }), { params: { provider: 'shippo' } })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Webhook verification failed' })
    expect(verifyWebhook).toHaveBeenCalledTimes(2)
    expect(mockCredentialsService.resolve).toHaveBeenNthCalledWith(2, 'carrier_shippo', { organizationId, tenantId })
    expect(mockQueue.enqueue).not.toHaveBeenCalled()
  })

  test.each([true, false])('enqueues only the unique verified match, with matching candidate first: %s', async (matchingFirst) => {
    const event = { eventType: 'delivered', eventId: 'e1', idempotencyKey: 'e1', data: {}, timestamp: new Date() }
    const verifyWebhook = jest.fn(async ({ credentials }: { credentials: Record<string, unknown> }) => {
      if (credentials.webhookSecret !== 'matching-test-secret') throw new Error('[internal] Invalid test signature')
      return event
    })
    ;(getShippingAdapter as jest.Mock).mockReturnValue({ verifyWebhook })
    mockCredentialsService.resolve.mockImplementation(async (_key: string, scope: { tenantId: string }) => ({
      webhookSecret: scope.tenantId === 'tenant_1' ? 'matching-test-secret' : 'different-test-secret',
    }))
    const candidates = [
      { id: 'shipment_1', organizationId: 'org_1', tenantId: 'tenant_1' },
      { id: 'shipment_2', organizationId: 'org_2', tenantId: 'tenant_2' },
    ]
    ;(findWithDecryption as jest.Mock).mockResolvedValue(matchingFirst ? candidates : [...candidates].reverse())

    const response = await POST(createMockRequest('{"shipmentId":"ship_1"}'), { params: { provider: 'shippo' } })

    expect(response.status).toBe(202)
    expect(verifyWebhook).toHaveBeenCalledTimes(2)
    expect(mockQueue.enqueue).toHaveBeenCalledTimes(1)
    expect(mockQueue.enqueue).toHaveBeenCalledWith({
      providerKey: 'shippo', event, shipmentId: 'shipment_1',
      scope: { organizationId: 'org_1', tenantId: 'tenant_1' },
    })
  })

  test('rejects a truncated candidate search instead of assuming a unique match', async () => {
    const verifyWebhook = jest.fn().mockResolvedValue({ eventId: 'e1' })
    ;(getShippingAdapter as jest.Mock).mockReturnValue({ verifyWebhook })
    ;(findWithDecryption as jest.Mock).mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({
      id: `shipment_${index}`, organizationId: `org_${index}`, tenantId: `tenant_${index}`,
    })))

    const response = await POST(createMockRequest('{"shipmentId":"ship_1"}'), { params: { provider: 'shippo' } })

    expect(response.status).toBe(401)
    expect(findWithDecryption).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      { providerKey: 'shippo', carrierShipmentId: 'ship_1', deletedAt: null },
      { limit: 11, orderBy: { createdAt: 'desc' } },
    )
    expect(verifyWebhook).not.toHaveBeenCalled()
    expect(mockQueue.enqueue).not.toHaveBeenCalled()
  })

  test('fails closed when credentials for a later candidate cannot be resolved', async () => {
    const verifyWebhook = jest.fn().mockResolvedValue({ eventId: 'e1' })
    ;(getShippingAdapter as jest.Mock).mockReturnValue({ verifyWebhook })
    mockCredentialsService.resolve.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('[internal] Credential lookup failed'))
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      { id: 'shipment_1', organizationId: 'org_1', tenantId: 'tenant_1' },
      { id: 'shipment_2', organizationId: 'org_2', tenantId: 'tenant_2' },
    ])

    const response = await POST(createMockRequest('{"shipmentId":"ship_1"}'), { params: { provider: 'shippo' } })

    expect(response.status).toBe(401)
    expect(mockQueue.enqueue).not.toHaveBeenCalled()
  })
})
