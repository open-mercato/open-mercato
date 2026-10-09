/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/payment_gateways/api/webhook/[provider]/route'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import { getPaymentGatewayQueue } from '@open-mercato/core/modules/payment_gateways/lib/queue'
import { processPaymentGatewayWebhookJob } from '@open-mercato/core/modules/payment_gateways/lib/webhook-processor'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

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

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: jest.fn(),
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
      maxBodyBytes: 1024 * 1024,
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

  test('preserves the legacy body reader when the provider does not opt into a limit', async () => {
    ;(getWebhookHandler as jest.Mock).mockReturnValue({
      handler: jest.fn(),
      readSessionIdHint: jest.fn(() => null),
    })
    const request = new Request('http://localhost/api/payment_gateways/webhook/stripe', {
      method: 'POST',
      headers: { 'content-length': String(1024 * 1024 + 1) },
      body: '{}',
    })
    const textSpy = jest.spyOn(request, 'text')

    const response = await POST(request, { params: { provider: 'stripe' } })

    expect(response.status).toBe(401)
    expect(textSpy).toHaveBeenCalledTimes(1)
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

  test('passes locator context to one-argument JSON locators without changing the handler input', async () => {
    const rawBody = '{"session":"sess_1"}'
    const handler = jest.fn().mockRejectedValue(new Error('verification failed'))
    const readSessionIdHint = jest.fn((payload: Record<string, unknown> | null) => String(payload?.session))
    ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler, readSessionIdHint })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([{ id: 'txn_1', organizationId: 'org_1', tenantId: 'tenant_1' }])

    await POST(createMockRequest(rawBody, { 'content-type': 'application/json' }), { params: { provider: 'stripe' } })

    expect(readSessionIdHint).toHaveBeenCalledWith(
      { session: 'sess_1' },
      expect.objectContaining({ rawBody, headers: expect.objectContaining({ 'content-type': 'application/json' }) }),
    )
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ rawBody }))
    expect(typeof handler.mock.calls[0][0].rawBody).toBe('string')
  })

  test('locates the session from exact bytes and hands the identical Buffer to the handler', async () => {
    const bytes = Buffer.concat([Buffer.from('session_id=sess_9&note='), Buffer.from([0xff, 0xfe]), Buffer.from('&x=1')])
    const handler = jest.fn().mockRejectedValue(new Error('verification failed'))
    const readSessionIdHint = jest.fn((_payload: Record<string, unknown> | null, context?: { rawBody: string | Buffer }) => {
      const raw = context?.rawBody
      if (!Buffer.isBuffer(raw)) return null
      return new URLSearchParams(raw.toString('latin1')).get('session_id')
    })
    ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler, readSessionIdHint, rawBody: 'bytes', maxBodyBytes: 1024 })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([{ id: 'txn_1', organizationId: 'org_1', tenantId: 'tenant_1' }])
    const request = new Request('http://localhost/api/payment_gateways/webhook/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: bytes,
    })

    await POST(request, { params: { provider: 'stripe' } })

    const context = readSessionIdHint.mock.calls[0][1] as { rawBody: Buffer }
    expect(Buffer.isBuffer(context.rawBody)).toBe(true)
    expect(context.rawBody.equals(bytes)).toBe(true)
    expect(handler.mock.calls[0][0].rawBody).toBe(context.rawBody)
    expect((findWithDecryption as jest.Mock).mock.calls[0][2]).toMatchObject({ providerSessionId: 'sess_9' })
  })

  test('delivers lowercase header names to the locator and handler regardless of request casing', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('verification failed'))
    const readSessionIdHint = jest.fn(() => 'sess_1')
    ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler, readSessionIdHint })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([{ id: 'txn_1', organizationId: 'org_1', tenantId: 'tenant_1' }])

    await POST(createMockRequest('{}', { 'X-Provider-Signature': 'sig' }), { params: { provider: 'stripe' } })

    const context = (readSessionIdHint.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> }
    expect(context.headers['x-provider-signature']).toBe('sig')
    expect(context.headers['X-Provider-Signature']).toBeUndefined()
    expect(handler.mock.calls[0][0].headers).toBe(context.headers)
  })

  test('ignores tenant and organization fields in the body when querying candidates', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('verification failed'))
    ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler, readSessionIdHint: () => 'sess_1' })
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    await POST(
      createMockRequest('{"session":"sess_1","tenantId":"t_evil","organizationId":"o_evil"}'),
      { params: { provider: 'stripe' } },
    )

    expect((findWithDecryption as jest.Mock).mock.calls[0][2]).toEqual({
      providerKey: 'stripe',
      providerSessionId: 'sess_1',
      deletedAt: null,
    })
  })

  describe('payment locator, candidate snapshot and ambiguity rejection', () => {
    const paymentId = '11111111-1111-4111-8111-111111111111'
    const otherPaymentId = '22222222-2222-4222-8222-222222222222'
    const mockReportError = jest.fn()

    function buildTransaction(overrides: Record<string, unknown> = {}) {
      return {
        id: 'txn_1',
        paymentId,
        providerSessionId: 'sess_1',
        amount: '100.0000',
        currencyCode: 'PLN',
        organizationId: 'org_1',
        tenantId: 'tenant_1',
        gatewayMetadata: { secret: 'x' },
        ...overrides,
      }
    }

    function registerHandler(options: {
      handler: jest.Mock
      session?: string | null
      payment?: unknown
    }) {
      ;(getWebhookHandler as jest.Mock).mockReturnValue({
        handler: options.handler,
        ...(options.session !== undefined ? { readSessionIdHint: () => options.session } : {}),
        ...(options.payment !== undefined ? { readPaymentIdHint: () => options.payment } : {}),
      })
    }

    const acceptedEvent = { eventType: 'payment.captured', eventId: 'evt_1', data: {}, idempotencyKey: 'evt_1' }

    beforeEach(() => {
      mockReportError.mockReset()
      ;(getTelemetryRuntime as jest.Mock).mockReturnValue({ reportError: mockReportError })
      ;(processPaymentGatewayWebhookJob as jest.Mock).mockResolvedValue(undefined)
    })

    test('keeps the session-only where clause and query options unchanged', async () => {
      registerHandler({ handler: jest.fn().mockRejectedValue(new Error('nope')), session: 'sess_1' })
      ;(findWithDecryption as jest.Mock).mockResolvedValue([])

      await POST(createMockRequest('{}'), { params: { provider: 'stripe' } })

      expect((findWithDecryption as jest.Mock).mock.calls[0][2]).toEqual({
        providerKey: 'stripe',
        providerSessionId: 'sess_1',
        deletedAt: null,
      })
      expect((findWithDecryption as jest.Mock).mock.calls[0][3]).toEqual({ limit: 10, orderBy: { createdAt: 'desc' } })
    })

    test('locates candidates by payment id only', async () => {
      registerHandler({ handler: jest.fn().mockRejectedValue(new Error('nope')), payment: paymentId })
      ;(findWithDecryption as jest.Mock).mockResolvedValue([])

      await POST(createMockRequest('{}'), { params: { provider: 'mock' } })

      expect((findWithDecryption as jest.Mock).mock.calls[0][2]).toEqual({
        providerKey: 'mock',
        paymentId,
        deletedAt: null,
      })
      expect((findWithDecryption as jest.Mock).mock.calls[0][3]).toEqual({ limit: 10, orderBy: { createdAt: 'desc' } })
    })

    test('intersects session and payment hints when both are present', async () => {
      registerHandler({ handler: jest.fn().mockRejectedValue(new Error('nope')), session: 'sess_1', payment: paymentId })
      ;(findWithDecryption as jest.Mock).mockResolvedValue([])

      const response = await POST(createMockRequest('{}'), { params: { provider: 'mock' } })

      expect(response.status).toBe(401)
      expect((findWithDecryption as jest.Mock).mock.calls[0][2]).toEqual({
        providerKey: 'mock',
        providerSessionId: 'sess_1',
        paymentId,
        deletedAt: null,
      })
    })

    test('ignores a malformed payment id hint', async () => {
      registerHandler({ handler: jest.fn().mockRejectedValue(new Error('nope')), session: 'sess_1', payment: 'not-a-uuid' })
      ;(findWithDecryption as jest.Mock).mockResolvedValue([])

      await POST(createMockRequest('{}'), { params: { provider: 'mock' } })

      expect((findWithDecryption as jest.Mock).mock.calls[0][2]).toEqual({
        providerKey: 'mock',
        providerSessionId: 'sess_1',
        deletedAt: null,
      })
    })

    test('does not query and rejects when no valid hint is present', async () => {
      const handler = jest.fn()
      registerHandler({ handler, session: '   ', payment: 'invalid' })

      const response = await POST(createMockRequest('{}'), { params: { provider: 'mock' } })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Webhook verification failed' })
      expect(findWithDecryption).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
    })

    test('passes exactly the candidate snapshot fields to the handler', async () => {
      const handler = jest.fn().mockResolvedValue(acceptedEvent)
      registerHandler({ handler, payment: paymentId })
      ;(findWithDecryption as jest.Mock).mockResolvedValue([buildTransaction({ providerSessionId: undefined })])

      const response = await POST(createMockRequest('{}'), { params: { provider: 'mock' } })

      expect(response.status).toBe(202)
      expect(handler.mock.calls[0][0].candidate).toEqual({
        transactionId: 'txn_1',
        paymentId,
        providerSessionId: null,
        amount: '100.0000',
        currencyCode: 'PLN',
      })
    })

    test('continues to the next candidate when the first rejects on a snapshot mismatch', async () => {
      const handler = jest.fn(async (input: { candidate?: { amount: string } }) => {
        if (input.candidate?.amount !== '25.0000') throw new Error('amount mismatch')
        return acceptedEvent
      })
      registerHandler({ handler, session: 'sess_1' })
      ;(findWithDecryption as jest.Mock).mockResolvedValue([
        buildTransaction(),
        buildTransaction({ id: 'txn_2', amount: '25.0000', organizationId: 'org_2', tenantId: 'tenant_2' }),
      ])

      const response = await POST(createMockRequest('{}'), { params: { provider: 'mock' } })

      expect(response.status).toBe(202)
      expect(await response.json()).toEqual({ received: true, queued: true })
      expect(handler).toHaveBeenCalledTimes(2)
      expect(processPaymentGatewayWebhookJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          providerKey: 'mock',
          event: acceptedEvent,
          transactionId: 'txn_2',
          scope: { organizationId: 'org_2', tenantId: 'tenant_2' },
        }),
      )
    })

    test('verifies each candidate with its own tenant credentials and selects the matching scope', async () => {
      mockCredentialsService.resolve.mockImplementation(async (_key: string, scope: { tenantId: string }) => ({
        secret: `secret_${scope.tenantId}`,
      }))
      const handler = jest.fn(async (input: { credentials: Record<string, unknown> }) => {
        if (input.credentials.secret !== 'secret_tenant_b') throw new Error('bad signature')
        return acceptedEvent
      })
      registerHandler({ handler, payment: paymentId })
      ;(findWithDecryption as jest.Mock).mockResolvedValue([
        buildTransaction({ organizationId: 'org_a', tenantId: 'tenant_a' }),
        buildTransaction({ id: 'txn_b', paymentId: otherPaymentId, organizationId: 'org_b', tenantId: 'tenant_b' }),
      ])

      const response = await POST(createMockRequest('{}'), { params: { provider: 'mock' } })

      expect(response.status).toBe(202)
      expect(mockCredentialsService.resolve).toHaveBeenCalledWith('gateway_mock', { organizationId: 'org_a', tenantId: 'tenant_a' })
      expect(mockCredentialsService.resolve).toHaveBeenCalledWith('gateway_mock', { organizationId: 'org_b', tenantId: 'tenant_b' })
      expect(processPaymentGatewayWebhookJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ transactionId: 'txn_b', scope: { organizationId: 'org_b', tenantId: 'tenant_b' } }),
      )
    })

    test('fails closed when more than one candidate verifies', async () => {
      const originalStrategy = process.env.QUEUE_STRATEGY
      process.env.QUEUE_STRATEGY = 'async'
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const handler = jest.fn().mockResolvedValue(acceptedEvent)
        registerHandler({ handler, session: 'sess_1' })
        ;(findWithDecryption as jest.Mock).mockResolvedValue([
          buildTransaction(),
          buildTransaction({ id: 'txn_2', organizationId: 'org_2', tenantId: 'tenant_2' }),
        ])

        const response = await POST(createMockRequest('{}'), { params: { provider: 'mock' } })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({ error: 'Webhook verification failed' })
        expect(handler).toHaveBeenCalledTimes(2)
        expect(mockQueue.enqueue).not.toHaveBeenCalled()
        expect(processPaymentGatewayWebhookJob).not.toHaveBeenCalled()
        expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
          module: 'payment_gateways',
          code: 'payment_gateways.webhook_ambiguous_candidates',
        })
      } finally {
        errorSpy.mockRestore()
        if (originalStrategy === undefined) delete process.env.QUEUE_STRATEGY
        else process.env.QUEUE_STRATEGY = originalStrategy
      }
    })
  })
})
