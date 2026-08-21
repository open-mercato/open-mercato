/** @jest-environment node */

import { NextResponse } from 'next/server'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'

const inviteIpConfig: RateLimitConfig = { points: 20, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite-ip' }
const inviteCompoundConfig: RateLimitConfig = { points: 5, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite' }

const mockCheckAuthRateLimit = jest.fn()
const mockCreateInvitation = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockGetCustomerAuthFromRequest = jest.fn()
const mockRequireCustomerFeature = jest.fn()
const mockSendCustomerInvitationEmail = jest.fn()

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
  customerInviteIpRateLimitConfig: inviteIpConfig,
  customerInviteRateLimitConfig: inviteCompoundConfig,
}))

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'customerRbacService') return {}
    if (token === 'customerInvitationService') return { createInvitation: mockCreateInvitation }
    if (token === 'em') return { find: jest.fn() }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
  requireCustomerFeature: (...args: unknown[]) => mockRequireCustomerFeature(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/invitationEmail', () => ({
  sendCustomerInvitationEmail: (...args: unknown[]) => mockSendCustomerInvitationEmail(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

function makeInviteRequest(path: string, email: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, roleIds: ['11111111-1111-4111-8111-111111111111'] }),
  })
}

function rateLimitResponse(): NextResponse {
  return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
}

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'

describe('customer invitation endpoints — rate limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null, compoundKey: null })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockRequireCustomerFeature.mockResolvedValue(undefined)
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'staff-1', tenantId, orgId: organizationId })
    mockGetCustomerAuthFromRequest.mockResolvedValue({
      sub: 'portal-1',
      tenantId,
      orgId: organizationId,
      customerEntityId: '44444444-4444-4444-8444-444444444444',
    })
    mockCreateInvitation.mockResolvedValue({
      invitation: { id: 'inv-1', email: 'buyer@example.com', expiresAt: new Date().toISOString() },
      rawToken: 'raw',
    })
    mockSendCustomerInvitationEmail.mockResolvedValue(undefined)
  })

  it('admin route checks the invite rate limit with the normalized invitee email', async () => {
    const { POST } = await import('../admin/users-invite')
    const req = makeInviteRequest('/api/customer_accounts/admin/users-invite', '  Buyer@Example.COM  ')

    await POST(req)

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith({
      req,
      ipConfig: inviteIpConfig,
      compoundConfig: inviteCompoundConfig,
      compoundIdentifier: 'buyer@example.com',
    })
  })

  it('admin route returns the 429 and never reaches the invitation service when rate limited', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ error: rateLimitResponse(), compoundKey: null })
    const { POST } = await import('../admin/users-invite')
    const req = makeInviteRequest('/api/customer_accounts/admin/users-invite', 'buyer@example.com')

    const res = await POST(req)

    expect(res.status).toBe(429)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
  })

  it('portal route checks the invite rate limit with the normalized invitee email', async () => {
    const { POST } = await import('../portal/users-invite')
    const req = makeInviteRequest('/api/customer_accounts/portal/users-invite', '  Buyer@Example.COM  ')

    await POST(req)

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith({
      req,
      ipConfig: inviteIpConfig,
      compoundConfig: inviteCompoundConfig,
      compoundIdentifier: 'buyer@example.com',
    })
  })

  it('portal route returns the 429 and never reaches the invitation service when rate limited', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ error: rateLimitResponse(), compoundKey: null })
    const { POST } = await import('../portal/users-invite')
    const req = makeInviteRequest('/api/customer_accounts/portal/users-invite', 'buyer@example.com')

    const res = await POST(req)

    expect(res.status).toBe(429)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
  })
})
