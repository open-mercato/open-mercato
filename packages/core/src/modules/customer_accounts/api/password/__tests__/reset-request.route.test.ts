/** @jest-environment node */

const mockFindByEmail = jest.fn()
const mockCreateToken = jest.fn()
const mockSendEmail = jest.fn()
const mockEmit = jest.fn()
const mockLoggerError = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerUserService') return { findByEmail: mockFindByEmail }
    if (token === 'customerTokenService') return { createPasswordReset: mockCreateToken }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
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

jest.mock('@open-mercato/core/modules/customer_accounts/lib/authLinkEmails', () => ({
  sendCustomerPasswordResetEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: (...args: unknown[]) => mockLoggerError(...args) }) }),
}))

import { POST } from '@open-mercato/core/modules/customer_accounts/api/password/reset-request'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '33333333-3333-4333-8333-333333333333'
const userId = '22222222-2222-4222-8222-222222222222'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/customer_accounts/password/reset-request', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('customer /api/customer_accounts/password/reset-request — token delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindByEmail.mockResolvedValue({ id: userId, tenantId, organizationId: orgId, email: 'buyer@example.com' })
    mockCreateToken.mockResolvedValue('raw-one-time-token')
    mockSendEmail.mockResolvedValue(undefined)
    mockEmit.mockResolvedValue(undefined)
  })

  it('delivers the minted raw token by email to the matching user', async () => {
    const res = await POST(makeRequest({ email: 'buyer@example.com', tenantId }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockCreateToken).toHaveBeenCalledWith(userId, tenantId)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith({
      container: mockContainer,
      tenantId,
      organizationId: orgId,
      email: 'buyer@example.com',
      rawToken: 'raw-one-time-token',
    })
  })

  it('never puts the raw token on the event bus', async () => {
    await POST(makeRequest({ email: 'buyer@example.com', tenantId }))
    await new Promise((resolve) => setImmediate(resolve))

    for (const call of mockEmit.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('raw-one-time-token')
    }
  })

  it('sends nothing and still answers 200 for an unknown email', async () => {
    mockFindByEmail.mockResolvedValue(null)

    const res = await POST(makeRequest({ email: 'nobody@example.com', tenantId }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockCreateToken).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('logs and still answers 200 when email delivery fails', async () => {
    mockSendEmail.mockRejectedValue(new Error('smtp down'))

    const res = await POST(makeRequest({ email: 'buyer@example.com', tenantId }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockLoggerError).toHaveBeenCalledTimes(1)
  })
})
