/** @jest-environment node */

import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'

const inviteIpConfig: RateLimitConfig = { points: 20, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite-ip' }
const inviteCompoundConfig: RateLimitConfig = { points: 5, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite' }

const mockCheckAuthRateLimit = jest.fn()
const mockCreateInvitation = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockEmit = jest.fn(async () => undefined)
const mockIsOwnedCompanyEntity = jest.fn()

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
  customerInviteIpRateLimitConfig: inviteIpConfig,
  customerInviteRateLimitConfig: inviteCompoundConfig,
}))

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'customerInvitationService') return { createInvitation: mockCreateInvitation }
    if (token === 'em') return {}
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerEntityOwnership', () => ({
  isOwnedCompanyEntity: (...args: unknown[]) => mockIsOwnedCompanyEntity(...args),
}))

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const invitationId = '55555555-5555-4555-8555-555555555555'
const roleId = '11111111-1111-4111-8111-111111111111'
const personEntityId = '66666666-6666-4666-8666-666666666666'
const companyEntityId = '77777777-7777-4777-8777-777777777777'

function makeInviteRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/customer_accounts/admin/users-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('admin users-invite — person link + company ownership (#4362)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null, compoundKey: null })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'staff-1', tenantId, orgId: organizationId })
    mockIsOwnedCompanyEntity.mockResolvedValue(true)
    mockCreateInvitation.mockResolvedValue({
      invitation: { id: invitationId, email: 'buyer@example.com', customerEntityId: null, expiresAt: new Date().toISOString() },
      rawToken: 'raw-secret-token',
    })
  })

  it('passes personEntityId through to the invitation service and does not require a company', async () => {
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({ email: 'buyer@example.com', roleIds: [roleId], personEntityId }))

    expect(res.status).toBe(201)
    expect(mockIsOwnedCompanyEntity).not.toHaveBeenCalled()
    expect(mockCreateInvitation).toHaveBeenCalledTimes(1)
    const options = mockCreateInvitation.mock.calls[0][2] as Record<string, unknown>
    expect(options.personEntityId).toBe(personEntityId)
    expect(options.customerEntityId).toBeNull()
  })

  it('succeeds without any entity link', async () => {
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({ email: 'buyer@example.com', roleIds: [roleId] }))

    expect(res.status).toBe(201)
    expect(mockIsOwnedCompanyEntity).not.toHaveBeenCalled()
    expect(mockCreateInvitation).toHaveBeenCalledTimes(1)
  })

  it('rejects a customerEntityId that is not an owned company with 400 "Company not found"', async () => {
    mockIsOwnedCompanyEntity.mockResolvedValue(false)
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({ email: 'buyer@example.com', roleIds: [roleId], customerEntityId: personEntityId }))

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual({ ok: false, error: 'Company not found' })
    expect(mockCreateInvitation).not.toHaveBeenCalled()
  })

  it('accepts a customerEntityId that is an owned company with 201', async () => {
    mockIsOwnedCompanyEntity.mockResolvedValue(true)
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({ email: 'buyer@example.com', roleIds: [roleId], customerEntityId: companyEntityId }))

    expect(res.status).toBe(201)
    expect(mockIsOwnedCompanyEntity).toHaveBeenCalledWith(expect.anything(), companyEntityId, { tenantId, organizationId })
    expect(mockCreateInvitation).toHaveBeenCalledTimes(1)
    const options = mockCreateInvitation.mock.calls[0][2] as Record<string, unknown>
    expect(options.customerEntityId).toBe(companyEntityId)
  })
})
