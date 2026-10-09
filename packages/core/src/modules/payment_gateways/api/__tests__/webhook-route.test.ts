/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/payment_gateways/api/webhook/[provider]/route'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  getWebhookHandler,
  WebhookVerificationUnavailableError,
  type WebhookResponseOutcome,
} from '@open-mercato/shared/modules/payment_gateways/types'
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
  ...jest.requireActual('@open-mercato/shared/modules/payment_gateways/types'),
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

    test('uses a non-empty session hint exactly as returned', async () => {
      registerHandler({ handler: jest.fn().mockRejectedValue(new Error('nope')), session: ' sess_1 ' })
      ;(findWithDecryption as jest.Mock).mockResolvedValue([])

      await POST(createMockRequest('{}'), { params: { provider: 'stripe' } })

      expect((findWithDecryption as jest.Mock).mock.calls[0][2]).toEqual({
        providerKey: 'stripe',
        providerSessionId: ' sess_1 ',
        deletedAt: null,
      })
    })

    test('accepts a non-v4 UUID as a payment id hint', async () => {
      const legacyPaymentId = '11111111-1111-1111-1111-111111111111'
      registerHandler({ handler: jest.fn().mockRejectedValue(new Error('nope')), payment: legacyPaymentId })
      ;(findWithDecryption as jest.Mock).mockResolvedValue([])

      await POST(createMockRequest('{}'), { params: { provider: 'mock' } })

      expect((findWithDecryption as jest.Mock).mock.calls[0][2]).toEqual({
        providerKey: 'mock',
        paymentId: legacyPaymentId,
        deletedAt: null,
      })
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
      registerHandler({ handler, session: '', payment: 'invalid' })

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

  describe('typed webhook outcomes and provider response formatting', () => {
    const mockReportError = jest.fn()
    const acceptedEvent = { eventType: 'payment.captured', eventId: 'evt_1', data: {}, idempotencyKey: 'evt_1' }
    const transaction = {
      id: 'txn_1',
      paymentId: '11111111-1111-4111-8111-111111111111',
      providerSessionId: 'sess_1',
      amount: '100.0000',
      currencyCode: 'PLN',
      organizationId: 'org_1',
      tenantId: 'tenant_1',
    }
    const outcomes: WebhookResponseOutcome[] = [
      'accepted',
      'no_candidate',
      'verification_failed',
      'verification_unavailable',
      'processing_failed',
      'payload_too_large',
      'rate_limited',
    ]
    const fixtureResponses: Record<WebhookResponseOutcome, { status: number; body: string }> = {
      accepted: { status: 200, body: 'TRUE' },
      no_candidate: { status: 400, body: 'FALSE - no candidate' },
      verification_failed: { status: 401, body: 'FALSE - verification failed' },
      verification_unavailable: { status: 503, body: 'RETRY - verification unavailable' },
      processing_failed: { status: 500, body: 'RETRY - processing failed' },
      payload_too_large: { status: 413, body: 'FALSE - payload too large' },
      rate_limited: { status: 429, body: 'RETRY - rate limited' },
    }
    const legacyResponses: Record<WebhookResponseOutcome, { status: number; body: Record<string, unknown> }> = {
      accepted: { status: 202, body: { received: true, queued: true } },
      no_candidate: { status: 401, body: { error: 'Webhook verification failed' } },
      verification_failed: { status: 401, body: { error: 'Webhook verification failed' } },
      verification_unavailable: { status: 401, body: { error: 'Webhook verification failed' } },
      processing_failed: { status: 401, body: { error: 'Webhook verification failed' } },
      payload_too_large: { status: 413, body: { error: 'Webhook payload too large' } },
      rate_limited: { status: 429, body: { error: 'Too many requests. Please try again later.' } },
    }
    let originalStrategy: string | undefined
    let consoleSpies: jest.SpyInstance[] = []

    function register(handler: jest.Mock, extra: Record<string, unknown> = {}) {
      ;(getWebhookHandler as jest.Mock).mockReturnValue({
        handler,
        readSessionIdHint: () => 'sess_1',
        ...extra,
      })
    }

    function arrange(outcome: WebhookResponseOutcome, extra: Record<string, unknown> = {}): Request {
      ;(findWithDecryption as jest.Mock).mockResolvedValue([transaction])
      const handler = jest.fn().mockResolvedValue(acceptedEvent)
      if (outcome === 'no_candidate') (findWithDecryption as jest.Mock).mockResolvedValue([])
      if (outcome === 'verification_failed') handler.mockRejectedValue(new Error('bad signature'))
      if (outcome === 'verification_unavailable') handler.mockRejectedValue(new WebhookVerificationUnavailableError())
      if (outcome === 'processing_failed') {
        ;(processPaymentGatewayWebhookJob as jest.Mock).mockRejectedValue(new Error('database down'))
      }
      if (outcome === 'rate_limited') {
        mockRateLimiterService.consume.mockResolvedValueOnce({
          allowed: false,
          remainingPoints: 0,
          msBeforeNext: 30_000,
          consumedPoints: 61,
        })
      }
      register(handler, { ...(outcome === 'payload_too_large' ? { maxBodyBytes: 4 } : {}), ...extra })
      return createMockRequest('{"session":"sess_1"}')
    }

    function fixtureFormatter(outcome: WebhookResponseOutcome) {
      return fixtureResponses[outcome]
    }

    beforeEach(() => {
      originalStrategy = process.env.QUEUE_STRATEGY
      delete process.env.QUEUE_STRATEGY
      mockReportError.mockReset()
      ;(getTelemetryRuntime as jest.Mock).mockReturnValue({ reportError: mockReportError })
      ;(processPaymentGatewayWebhookJob as jest.Mock).mockResolvedValue(undefined)
      mockQueue.enqueue.mockResolvedValue(undefined)
      consoleSpies = (['info', 'warn', 'error'] as const).map((method) =>
        jest.spyOn(console, method).mockImplementation(() => undefined),
      )
    })

    afterEach(() => {
      consoleSpies.forEach((spy) => spy.mockRestore())
      if (originalStrategy === undefined) delete process.env.QUEUE_STRATEGY
      else process.env.QUEUE_STRATEGY = originalStrategy
    })

    test.each(outcomes)('keeps the exact legacy response for %s without a formatter', async (outcome) => {
      const response = await POST(arrange(outcome), { params: { provider: 'stripe' } })

      expect(response.status).toBe(legacyResponses[outcome].status)
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(await response.text()).toBe(JSON.stringify(legacyResponses[outcome].body))
    })

    test('keeps the legacy rate limiter response headers without a formatter', async () => {
      const response = await POST(arrange('rate_limited'), { params: { provider: 'stripe' } })

      expect(response.headers.get('retry-after')).toBe('30')
      expect(response.headers.get('x-ratelimit-limit')).toBe('60')
    })

    test.each(outcomes)('formats the %s outcome with the provider formatter', async (outcome) => {
      const formatResponse = jest.fn(fixtureFormatter)

      const response = await POST(arrange(outcome, { formatResponse }), { params: { provider: 'tpay' } })

      expect(formatResponse).toHaveBeenCalledWith(outcome)
      expect(response.status).toBe(fixtureResponses[outcome].status)
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(await response.text()).toBe(fixtureResponses[outcome].body)
      expect(mockReportError).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        code: 'payment_gateways.webhook_formatter_invalid',
      }))
    })

    test('keeps the rate limiter headers on a formatted rate limited response', async () => {
      const response = await POST(arrange('rate_limited', { formatResponse: fixtureFormatter }), {
        params: { provider: 'tpay' },
      })

      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('30')
      expect(response.headers.get('x-ratelimit-remaining')).toBe('0')
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    })

    test('formats an object body as JSON with a custom JSON content type', async () => {
      const formatResponse = () => ({ status: 200, body: { ok: true }, contentType: 'application/vnd.provider+json' })

      const response = await POST(arrange('accepted', { formatResponse }), { params: { provider: 'tpay' } })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/vnd.provider+json')
      expect(await response.text()).toBe('{"ok":true}')
    })

    test.each(['async', 'local'])('never reports accepted when %s processing fails', async (mode) => {
      if (mode === 'async') {
        process.env.QUEUE_STRATEGY = 'async'
        mockQueue.enqueue.mockRejectedValue(new Error('redis down'))
      } else {
        ;(processPaymentGatewayWebhookJob as jest.Mock).mockRejectedValue(new Error('database down'))
      }
      ;(findWithDecryption as jest.Mock).mockResolvedValue([transaction])
      const formatResponse = jest.fn(fixtureFormatter)
      register(jest.fn().mockResolvedValue(acceptedEvent), { formatResponse })

      const response = await POST(createMockRequest('{}'), { params: { provider: 'tpay' } })

      expect(formatResponse).toHaveBeenCalledWith('processing_failed')
      expect(formatResponse).not.toHaveBeenCalledWith('accepted')
      expect(response.status).toBe(500)
      expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
        module: 'payment_gateways',
        code: 'payment_gateways.webhook_processing_failed',
      })
    })

    test('returns the legacy 401 when async enqueue fails without a formatter', async () => {
      process.env.QUEUE_STRATEGY = 'async'
      mockQueue.enqueue.mockRejectedValue(new Error('redis down'))
      ;(findWithDecryption as jest.Mock).mockResolvedValue([transaction])
      register(jest.fn().mockResolvedValue(acceptedEvent))

      const response = await POST(createMockRequest('{}'), { params: { provider: 'stripe' } })

      expect(response.status).toBe(401)
      expect(await response.text()).toBe('{"error":"Webhook verification failed"}')
    })

    test('classifies unavailable verification separately from failed verification', async () => {
      const formatResponse = jest.fn(fixtureFormatter)
      const handler = jest.fn()
        .mockRejectedValueOnce(new Error('bad signature'))
        .mockRejectedValueOnce(new WebhookVerificationUnavailableError())
      ;(findWithDecryption as jest.Mock).mockResolvedValue([transaction, { ...transaction, id: 'txn_2' }])
      register(handler, { formatResponse })

      const unavailable = await POST(createMockRequest('{}'), { params: { provider: 'tpay' } })

      expect(formatResponse).toHaveBeenLastCalledWith('verification_unavailable')
      expect(unavailable.status).toBe(503)

      handler.mockRejectedValue(new Error('bad signature'))
      const failed = await POST(createMockRequest('{}'), { params: { provider: 'tpay' } })

      expect(formatResponse).toHaveBeenLastCalledWith('verification_failed')
      expect(failed.status).toBe(401)
    })

    test('classifies an ambiguous match as verification failed', async () => {
      const formatResponse = jest.fn(fixtureFormatter)
      ;(findWithDecryption as jest.Mock).mockResolvedValue([transaction, { ...transaction, id: 'txn_2' }])
      register(jest.fn().mockResolvedValue(acceptedEvent), { formatResponse })

      const response = await POST(createMockRequest('{}'), { params: { provider: 'tpay' } })

      expect(formatResponse).toHaveBeenCalledWith('verification_failed')
      expect(response.status).toBe(401)
      expect(processPaymentGatewayWebhookJob).not.toHaveBeenCalled()
    })

    test.each([
      ['status below range', () => ({ status: 199, body: 'x' })],
      ['status above range', () => ({ status: 600, body: 'x' })],
      ['fractional status', () => ({ status: 1.5, body: 'x' })],
      ['array body', () => ({ status: 200, body: ['x'] })],
      ['class instance body', () => ({ status: 200, body: new Date() })],
      ['content type with a newline', () => ({ status: 200, body: 'x', contentType: 'text/plain\nX-Injected: 1' })],
      ['text body with JSON content type', () => ({ status: 200, body: 'x', contentType: 'application/json' })],
      ['object body with text content type', () => ({ status: 200, body: { ok: true }, contentType: 'text/plain' })],
      ['throwing formatter', () => {
        throw new Error('formatter exploded')
      }],
    ])('fails closed with a generic 500 for %s', async (_label, formatResponse) => {
      const response = await POST(arrange('accepted', { formatResponse }), { params: { provider: 'tpay' } })

      expect(response.status).toBe(500)
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(await response.text()).toBe('{"error":"Internal server error"}')
      expect(response.headers.get('x-injected')).toBeNull()
      expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
        module: 'payment_gateways',
        code: 'payment_gateways.webhook_formatter_invalid',
      })
    })

    test.each([
      ['without a formatter', undefined],
      ['with a formatter', fixtureFormatter],
    ])('stops before locating, resolving credentials or verifying on body overflow %s', async (_label, formatter) => {
      const handler = jest.fn()
      const readSessionIdHint = jest.fn(() => 'sess_1')
      ;(getWebhookHandler as jest.Mock).mockReturnValue({
        handler,
        readSessionIdHint,
        maxBodyBytes: 4,
        ...(formatter ? { formatResponse: formatter } : {}),
      })

      const response = await POST(createMockRequest('{"session":"sess_1"}'), { params: { provider: 'tpay' } })

      expect(response.status).toBe(413)
      expect(readSessionIdHint).not.toHaveBeenCalled()
      expect(findWithDecryption).not.toHaveBeenCalled()
      expect(mockCredentialsService.resolve).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
    })

    test('returns 404 for an unknown provider without formatting', async () => {
      ;(getWebhookHandler as jest.Mock).mockReturnValue(undefined)

      const response = await POST(createMockRequest('{}'), { params: { provider: 'unknown' } })

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'No webhook handler for provider: unknown' })
      expect(mockRateLimiterService.consume).not.toHaveBeenCalled()
    })
  })
  describe('infrastructure failures and duplicate candidates', () => {
    const paymentId = '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f'
    const mockReportError = jest.fn()
    let consoleSpies: jest.SpyInstance[] = []

    function transaction(overrides: Record<string, unknown> = {}) {
      return {
        id: 'txn_1',
        paymentId,
        providerSessionId: 'sess_1',
        amount: '100.0000',
        currencyCode: 'PLN',
        organizationId: 'org_1',
        tenantId: 'tenant_1',
        ...overrides,
      }
    }

    beforeEach(() => {
      mockReportError.mockReset()
      ;(getTelemetryRuntime as jest.Mock).mockReturnValue({ reportError: mockReportError })
      ;(processPaymentGatewayWebhookJob as jest.Mock).mockResolvedValue(undefined)
      consoleSpies = (['info', 'warn', 'error'] as const).map((method) =>
        jest.spyOn(console, method).mockImplementation(() => undefined),
      )
    })

    afterEach(() => {
      consoleSpies.forEach((spy) => spy.mockRestore())
    })

    test('maps a throwing locator to no_candidate and reports it', async () => {
      const handler = jest.fn()
      const formatResponse = jest.fn((outcome: WebhookResponseOutcome) => ({ status: 400, body: outcome }))
      ;(getWebhookHandler as jest.Mock).mockReturnValue({
        handler,
        readSessionIdHint: () => {
          throw new Error('malformed form body')
        },
        formatResponse,
      })

      const response = await POST(createMockRequest('a=b'), { params: { provider: 'tpay' } })

      expect(formatResponse).toHaveBeenCalledWith('no_candidate')
      expect(response.status).toBe(400)
      expect(findWithDecryption).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
      expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
        module: 'payment_gateways',
        code: 'payment_gateways.webhook_locator_failed',
      })
    })

    test('keeps the legacy 401 when the candidate lookup fails and reports processing_failed', async () => {
      ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler: jest.fn(), readSessionIdHint: () => 'sess_1' })
      ;(findWithDecryption as jest.Mock).mockRejectedValueOnce(new Error('database unavailable'))

      const legacy = await POST(createMockRequest('{}'), { params: { provider: 'stripe' } })

      expect(legacy.status).toBe(401)
      expect(await legacy.json()).toEqual({ error: 'Webhook verification failed' })
      expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
        module: 'payment_gateways',
        code: 'payment_gateways.webhook_lookup_failed',
      })

      const formatResponse = jest.fn((outcome: WebhookResponseOutcome) => ({ status: 503, body: outcome }))
      ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler: jest.fn(), readSessionIdHint: () => 'sess_1', formatResponse })
      ;(findWithDecryption as jest.Mock).mockRejectedValueOnce(new Error('database unavailable'))

      const formatted = await POST(createMockRequest('{}'), { params: { provider: 'tpay' } })

      expect(formatResponse).toHaveBeenCalledWith('processing_failed')
      expect(formatted.status).toBe(503)
    })

    test('skips a candidate whose credentials cannot be resolved and accepts the verified one', async () => {
      const handler = jest.fn(async () => ({ eventType: 'payment.captured', eventId: 'evt_1', data: {}, idempotencyKey: 'evt_1', timestamp: new Date() }))
      ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler, readSessionIdHint: () => 'sess_1' })
      ;(findWithDecryption as jest.Mock).mockResolvedValueOnce([
        transaction({ id: 'txn_other', organizationId: 'org_2', tenantId: 'tenant_2' }),
        transaction(),
      ])
      mockCredentialsService.resolve
        .mockRejectedValueOnce(new Error('decryption failed'))
        .mockResolvedValueOnce({ secret: 'tenant_1' })

      const response = await POST(createMockRequest('{}'), { params: { provider: 'stripe' } })

      expect(response.status).toBe(202)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(processPaymentGatewayWebhookJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ transactionId: 'txn_1', scope: { organizationId: 'org_1', tenantId: 'tenant_1' } }),
      )
      expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
        module: 'payment_gateways',
        code: 'payment_gateways.webhook_credentials_failed',
      })
    })

    test('classifies credential resolution failure without a verified candidate as verification_unavailable', async () => {
      const handler = jest.fn()
      const formatResponse = jest.fn((outcome: WebhookResponseOutcome) => ({ status: 503, body: outcome }))
      ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler, readSessionIdHint: () => 'sess_1', formatResponse })
      ;(findWithDecryption as jest.Mock).mockResolvedValueOnce([transaction()])
      mockCredentialsService.resolve.mockRejectedValueOnce(new Error('decryption failed'))

      const response = await POST(createMockRequest('{}'), { params: { provider: 'tpay' } })

      expect(formatResponse).toHaveBeenCalledWith('verification_unavailable')
      expect(response.status).toBe(503)
      expect(handler).not.toHaveBeenCalled()
    })

    test('rejects two same-tenant transactions located only by payment id unless the verifier narrows them', async () => {
      const event = { eventType: 'payment.captured', eventId: 'evt_1', data: {}, idempotencyKey: 'evt_1', timestamp: new Date() }
      ;(findWithDecryption as jest.Mock).mockResolvedValue([
        transaction({ id: 'txn_retry', providerSessionId: 'sess_2' }),
        transaction(),
      ])
      const permissive = jest.fn(async () => event)
      ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler: permissive, readPaymentIdHint: () => paymentId })

      const ambiguous = await POST(createMockRequest('{}'), { params: { provider: 'tpay' } })

      expect(ambiguous.status).toBe(401)
      expect(processPaymentGatewayWebhookJob).not.toHaveBeenCalled()

      const narrowing = jest.fn(async (input: { candidate?: { providerSessionId: string | null } }) => {
        if (input.candidate?.providerSessionId !== 'sess_1') throw new Error('session mismatch')
        return event
      })
      ;(getWebhookHandler as jest.Mock).mockReturnValue({ handler: narrowing, readPaymentIdHint: () => paymentId })

      const accepted = await POST(createMockRequest('{}'), { params: { provider: 'tpay' } })

      expect(accepted.status).toBe(202)
      expect(processPaymentGatewayWebhookJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ transactionId: 'txn_1' }),
      )
    })

    test('rejects a non-JSON media type such as text/json for an object body', async () => {
      ;(getWebhookHandler as jest.Mock).mockReturnValue({
        handler: jest.fn(),
        readSessionIdHint: () => null,
        formatResponse: () => ({ status: 400, body: { ok: false }, contentType: 'text/json' }),
      })

      const response = await POST(createMockRequest('{}'), { params: { provider: 'tpay' } })

      expect(response.status).toBe(500)
      expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
        module: 'payment_gateways',
        code: 'payment_gateways.webhook_formatter_invalid',
      })
    })
  })
})
