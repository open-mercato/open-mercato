/** @jest-environment node */

const mockEnqueue = jest.fn()

jest.mock('@open-mercato/core/modules/customer_accounts/lib/authLinkQueue', () => ({
  getPasswordResetDeliveryQueue: () => ({ enqueue: (...args: unknown[]) => mockEnqueue(...args) }),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: jest.fn(async () => ({ error: null })),
  customerPasswordResetRateLimitConfig: {},
  customerPasswordResetIpRateLimitConfig: {},
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimitIdentifier', () => ({
  readNormalizedEmailFromJsonRequest: jest.fn(async () => 'buyer@example.com'),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/resolveTenantContext', () => {
  class TenantResolutionError extends Error {}
  return {
    TenantResolutionError,
    resolveTenantContext: jest.fn(async () => ({ tenantId: '11111111-1111-4111-8111-111111111111' })),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  detectLocale: jest.fn(async () => 'en'),
}))

import { POST } from '@open-mercato/core/modules/customer_accounts/api/password/reset-request'

const tenantId = '11111111-1111-4111-8111-111111111111'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/customer_accounts/password/reset-request', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('customer /api/customer_accounts/password/reset-request — account-independent response timing (#8889)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEnqueue.mockResolvedValue('job-1')
  })

  it('enqueues durable delivery work for a known email and answers 200', async () => {
    const res = await POST(makeRequest({ email: 'buyer@example.com', tenantId }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith({ email: 'buyer@example.com', tenantId, locale: 'en' })
  })

  it('enqueues the exact same shape for an unknown email — the route never looks up the account', async () => {
    const res = await POST(makeRequest({ email: 'nobody@example.com', tenantId }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith({ email: 'nobody@example.com', tenantId, locale: 'en' })
  })

  it('resolves the requester locale identically regardless of account existence', async () => {
    const { detectLocale } = jest.requireMock('@open-mercato/shared/lib/i18n/server') as { detectLocale: jest.Mock }
    detectLocale.mockResolvedValueOnce('pl')

    await POST(makeRequest({ email: 'buyer@example.com', tenantId }))

    expect(mockEnqueue).toHaveBeenCalledWith({ email: 'buyer@example.com', tenantId, locale: 'pl' })
  })

  it('never puts a raw token or any secret on the queue payload', async () => {
    await POST(makeRequest({ email: 'buyer@example.com', tenantId }))

    const [payload] = mockEnqueue.mock.calls[0]
    expect(Object.keys(payload).sort()).toEqual(['email', 'locale', 'tenantId'])
  })

  it('still answers 200 without enqueueing when the request body is invalid', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
