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
const mockIsOwnedPersonEntity = jest.fn()
const mockResolveOwnedCompanyForPerson = jest.fn()

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
  isOwnedPersonEntity: (...args: unknown[]) => mockIsOwnedPersonEntity(...args),
  resolveOwnedCompanyForPerson: (...args: unknown[]) => mockResolveOwnedCompanyForPerson(...args),
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
    mockIsOwnedPersonEntity.mockResolvedValue(true)
    mockResolveOwnedCompanyForPerson.mockResolvedValue(null)
    mockCreateInvitation.mockImplementation(async (_email: string, _scope: unknown, options: Record<string, unknown>) => ({
      invitation: {
        id: invitationId,
        email: 'buyer@example.com',
        customerEntityId: options.customerEntityId ?? null,
        personEntityId: options.personEntityId ?? null,
        expiresAt: new Date().toISOString(),
      },
      rawToken: 'raw-secret-token',
    }))
  })

  it('passes personEntityId through to the invitation service and does not require a company', async () => {
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({ email: 'buyer@example.com', roleIds: [roleId], personEntityId }))

    expect(res.status).toBe(201)
    expect(mockIsOwnedCompanyEntity).not.toHaveBeenCalled()
    expect(mockIsOwnedPersonEntity).toHaveBeenCalledWith(expect.anything(), personEntityId, { tenantId, organizationId })
    expect(mockCreateInvitation).toHaveBeenCalledTimes(1)
    const options = mockCreateInvitation.mock.calls[0][2] as Record<string, unknown>
    expect(options.personEntityId).toBe(personEntityId)
    expect(options.customerEntityId).toBeNull()
  })

  it('rejects a personEntityId that is not an owned person with 400 "Person not found"', async () => {
    // Symmetric to the company guard: an id from another org (or a company id)
    // would otherwise be copied onto the customer user and short-circuit
    // autoLinkCrm, permanently cross-linking the portal user.
    mockIsOwnedPersonEntity.mockResolvedValue(false)
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({ email: 'buyer@example.com', roleIds: [roleId], personEntityId: companyEntityId }))

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual({ ok: false, error: 'Person not found' })
    expect(mockCreateInvitation).not.toHaveBeenCalled()
  })

  it('does not check person ownership when no personEntityId is supplied', async () => {
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({ email: 'buyer@example.com', roleIds: [roleId], customerEntityId: companyEntityId }))

    expect(res.status).toBe(201)
    expect(mockIsOwnedPersonEntity).not.toHaveBeenCalled()
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

  it('derives the company from the person profile so the accepted user gets a portal scope key', async () => {
    // Without this the person-invited user accepts with customerEntityId null and
    // autoLinkCrm short-circuits on personEntityId, leaving the portal Users page,
    // portal invitations, and the company detail listing permanently empty.
    mockResolveOwnedCompanyForPerson.mockResolvedValue(companyEntityId)
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({ email: 'buyer@example.com', roleIds: [roleId], personEntityId }))

    expect(res.status).toBe(201)
    expect(mockResolveOwnedCompanyForPerson).toHaveBeenCalledWith(expect.anything(), personEntityId, { tenantId, organizationId })
    const options = mockCreateInvitation.mock.calls[0][2] as Record<string, unknown>
    expect(options.customerEntityId).toBe(companyEntityId)
    expect(options.personEntityId).toBe(personEntityId)
    // The response echoes the resolved links so callers (and integration tests)
    // can observe which company the person invite landed on.
    const json = await res.json() as { invitation: Record<string, unknown> }
    expect(json.invitation.customerEntityId).toBe(companyEntityId)
    expect(json.invitation.personEntityId).toBe(personEntityId)
  })

  it('leaves customerEntityId null when the person has no in-scope company', async () => {
    // The helper returns null both for a person without a company and for one whose
    // company sits outside the caller org; neither may become a portal scope key.
    mockResolveOwnedCompanyForPerson.mockResolvedValue(null)
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({ email: 'buyer@example.com', roleIds: [roleId], personEntityId }))

    expect(res.status).toBe(201)
    const options = mockCreateInvitation.mock.calls[0][2] as Record<string, unknown>
    expect(options.customerEntityId).toBeNull()
  })

  it('keeps an explicit customerEntityId instead of deriving one from the person', async () => {
    mockResolveOwnedCompanyForPerson.mockResolvedValue(personEntityId)
    const { POST } = await import('../admin/users-invite')
    const res = await POST(makeInviteRequest({
      email: 'buyer@example.com',
      roleIds: [roleId],
      personEntityId,
      customerEntityId: companyEntityId,
    }))

    expect(res.status).toBe(201)
    expect(mockResolveOwnedCompanyForPerson).not.toHaveBeenCalled()
    const options = mockCreateInvitation.mock.calls[0][2] as Record<string, unknown>
    expect(options.customerEntityId).toBe(companyEntityId)
  })
})
