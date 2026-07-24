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
const mockEmit = jest.fn(async () => undefined)

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

const mockFindWithDecryption = jest.fn(async () => [] as unknown[])
const mockFindOneWithDecryption = jest.fn(async () => null as unknown)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const foreignOrganizationId = '33333333-3333-4333-8333-333333333334'
const customerEntityId = '44444444-4444-4444-8444-444444444444'
const invitationId = '55555555-5555-4555-8555-555555555555'
const roleId = '11111111-1111-4111-8111-111111111111'

function makeInviteRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function rateLimitResponse(): NextResponse {
  return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
}

function invitedEvents(): unknown[][] {
  return mockEmit.mock.calls.filter((call: unknown[]) => call[0] === 'customer_accounts.user.invited')
}

describe('customer invitation endpoints — invitation-created event', () => {
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
      customerEntityId,
    })
    mockCreateInvitation.mockResolvedValue({
      invitation: {
        id: invitationId,
        email: 'buyer@example.com',
        customerEntityId,
        expiresAt: new Date().toISOString(),
      },
      rawToken: 'raw-secret-token',
    })
    mockEmit.mockResolvedValue(undefined)
    mockFindWithDecryption.mockResolvedValue([{ id: roleId, name: 'Buyer', customerAssignable: true }])
    mockFindOneWithDecryption.mockResolvedValue(null)
  })

  it('admin route emits the invitation-created event once with staff context and no raw token', async () => {
    const { POST } = await import('../admin/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/admin/users-invite', { email: 'buyer@example.com', roleIds: [roleId] }),
    )

    expect(res.status).toBe(201)
    const events = invitedEvents()
    expect(events).toHaveLength(1)
    expect(events[0][1]).toEqual({
      invitationId,
      email: 'buyer@example.com',
      customerEntityId,
      invitedByType: 'staff',
      tenantId,
      organizationId,
    })
    expect(JSON.stringify(events[0][1])).not.toContain('raw-secret-token')
  })

  it('portal route emits the invitation-created event once with portal context', async () => {
    const { POST } = await import('../portal/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/portal/users-invite', { email: 'buyer@example.com', roleIds: [roleId] }),
    )

    expect(res.status).toBe(201)
    const events = invitedEvents()
    expect(events).toHaveLength(1)
    expect(events[0][1]).toEqual({
      invitationId,
      email: 'buyer@example.com',
      customerEntityId,
      invitedByType: 'portal',
      tenantId,
      organizationId,
    })
  })

  it('portal route rejects an assignable role owned by another organization in the same tenant', async () => {
    mockFindWithDecryption.mockImplementation(async (_em, _entity, where: Record<string, unknown>) => (
      where.organizationId === organizationId
        ? []
        : [{ id: roleId, name: 'Foreign Buyer', customerAssignable: true, organizationId: foreignOrganizationId }]
    ))
    const { POST } = await import('../portal/users-invite')

    const res = await POST(
      makeInviteRequest('/api/customer_accounts/portal/users-invite', { email: 'buyer@example.com', roleIds: [roleId] }),
    )

    expect(res.status).toBe(400)
    expect(mockFindWithDecryption.mock.calls[0][2]).toEqual(expect.objectContaining({
      id: { $in: [roleId] },
      tenantId,
      organizationId,
      deletedAt: null,
    }))
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(invitedEvents()).toHaveLength(0)
  })

  it('admin route does NOT emit when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)
    const { POST } = await import('../admin/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/admin/users-invite', { email: 'buyer@example.com', roleIds: [roleId] }),
    )

    expect(res.status).toBe(401)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(invitedEvents()).toHaveLength(0)
  })

  it('admin route does NOT emit when the caller lacks customer_accounts.invite', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)
    const { POST } = await import('../admin/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/admin/users-invite', { email: 'buyer@example.com', roleIds: [roleId] }),
    )

    expect(res.status).toBe(403)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(invitedEvents()).toHaveLength(0)
  })

  it('admin route rejects a customerEntityId the caller does not own without inviting', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const foreignCompanyId = '66666666-6666-4666-8666-666666666666'
    const { POST } = await import('../admin/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/admin/users-invite', {
        email: 'buyer@example.com',
        roleIds: [roleId],
        customerEntityId: foreignCompanyId,
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'Company not found' })
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(invitedEvents()).toHaveLength(0)
  })

  it('admin route invites when the customerEntityId is an owned company', async () => {
    const ownedCompanyId = '77777777-7777-4777-8777-777777777777'
    mockFindOneWithDecryption.mockResolvedValue({ id: ownedCompanyId, kind: 'company' })
    const { POST } = await import('../admin/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/admin/users-invite', {
        email: 'buyer@example.com',
        roleIds: [roleId],
        customerEntityId: ownedCompanyId,
      }),
    )

    expect(res.status).toBe(201)
    expect(mockCreateInvitation).toHaveBeenCalledTimes(1)
    expect((mockCreateInvitation.mock.calls[0][2] as any)?.customerEntityId).toBe(ownedCompanyId)
    expect(invitedEvents()).toHaveLength(1)
  })

  it('admin route does NOT emit when validation fails', async () => {
    const { POST } = await import('../admin/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/admin/users-invite', { email: 'not-an-email', roleIds: [roleId] }),
    )

    expect(res.status).toBe(400)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(invitedEvents()).toHaveLength(0)
  })

  it('admin route does NOT emit when rate limited', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ error: rateLimitResponse(), compoundKey: null })
    const { POST } = await import('../admin/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/admin/users-invite', { email: 'buyer@example.com', roleIds: [roleId] }),
    )

    expect(res.status).toBe(429)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(invitedEvents()).toHaveLength(0)
  })

  it('portal route does NOT emit when the portal feature check rejects', async () => {
    mockRequireCustomerFeature.mockRejectedValue(NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 }))
    const { POST } = await import('../portal/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/portal/users-invite', { email: 'buyer@example.com', roleIds: [] }),
    )

    expect(res.status).toBe(403)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(invitedEvents()).toHaveLength(0)
  })

  it('portal route does NOT emit when rate limited', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ error: rateLimitResponse(), compoundKey: null })
    const { POST } = await import('../portal/users-invite')
    const res = await POST(
      makeInviteRequest('/api/customer_accounts/portal/users-invite', { email: 'buyer@example.com', roleIds: [] }),
    )

    expect(res.status).toBe(429)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(invitedEvents()).toHaveLength(0)
  })
})
