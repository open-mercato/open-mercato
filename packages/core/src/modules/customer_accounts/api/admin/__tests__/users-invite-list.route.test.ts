/** @jest-environment node */

/**
 * Regression coverage for #4950: a pending invitation used to be invisible to
 * every admin read surface, so an invite raised from the CRM person card looked
 * like a no-op. The GET listing is the queryable surface for that state — it must
 * stay tenant/organization scoped, expose only pending invitations, and never
 * leak the one-time token.
 */

const mockUserHasAllFeatures = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockFindAndCountWithDecryption = jest.fn()

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const personEntityId = '77777777-7777-4777-8777-777777777777'
const staffUserId = '44444444-4444-4444-8444-444444444444'

const mockEm = { id: 'em' }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'em') return mockEm
    return null
  }),
}

// The invite route pulls the rate limiter (and through it the app bootstrap) at
// import time; the sibling POST suite isolates it the same way (#4899).
jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: jest.fn(async () => ({ error: null, compoundKey: null })),
  customerInviteIpRateLimitConfig: { points: 20, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite-ip' },
  customerInviteRateLimitConfig: { points: 5, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite' },
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimitIdentifier', () => ({
  readNormalizedEmailFromJsonRequest: jest.fn(async () => null),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/invitationEmail', () => ({
  sendCustomerInvitationEmail: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
}))

function makeListRequest(query = `personEntityId=${personEntityId}&pageSize=1`): Request {
  return new Request(`http://localhost/api/customer_accounts/admin/users-invite?${query}`)
}

function makeInvitation() {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    email: 'buyer@example.com',
    displayName: 'Buyer User',
    token: 'hashed-invite-token',
    emailHash: 'email-hash',
    customerEntityId: null,
    personEntityId,
    roleIdsJson: ['11111111-1111-4111-8111-111111111111'],
    invitedByUserId: staffUserId,
    expiresAt: new Date('2026-06-18T12:00:00.000Z'),
    createdAt: new Date('2026-06-15T12:00:00.000Z'),
  }
}

describe('admin customer invitations listing route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockGetAuthFromRequest.mockResolvedValue({
      sub: staffUserId,
      tenantId,
      orgId: organizationId,
    })
    mockFindAndCountWithDecryption.mockResolvedValue([[makeInvitation()], 1])
  })

  it('returns the person\'s pending invitation so the account-status widget can show it', async () => {
    const { GET } = await import('../users-invite')

    const response = await GET(makeListRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.total).toBe(1)
    expect(json.items).toEqual([
      expect.objectContaining({
        id: '66666666-6666-4666-8666-666666666666',
        email: 'buyer@example.com',
        personEntityId,
        roleIds: ['11111111-1111-4111-8111-111111111111'],
      }),
    ])
  })

  it('never exposes the invitation token', async () => {
    const { GET } = await import('../users-invite')

    const response = await GET(makeListRequest())
    const json = await response.json()

    expect(JSON.stringify(json)).not.toContain('hashed-invite-token')
    expect(json.items[0].token).toBeUndefined()
  })

  it('scopes the query to the caller tenant/organization and to pending invitations only', async () => {
    const { GET } = await import('../users-invite')

    await GET(makeListRequest())

    const [, , where, options, scope] = mockFindAndCountWithDecryption.mock.calls[0]
    expect(where).toEqual(expect.objectContaining({
      tenantId,
      organizationId,
      personEntityId,
      acceptedAt: null,
      cancelledAt: null,
      expiresAt: { $gt: expect.any(Date) },
    }))
    expect(options).toEqual(expect.objectContaining({ limit: 1, offset: 0 }))
    expect(scope).toEqual({ tenantId, organizationId })
  })

  // #5499: person_entity_id is optional on an invitation, so the account-status
  // widget falls back to the recipient address. That filter must match the stored
  // deterministic hash — including the legacy digest — and never the raw email.
  it('matches by recipient email on the deterministic lookup hash', async () => {
    const { lookupHashCandidates } = await import('@open-mercato/shared/lib/encryption/aes')
    const { GET } = await import('../users-invite')

    const response = await GET(makeListRequest('email=Buyer%40Example.com&pageSize=1'))

    expect(response.status).toBe(200)
    const [, , where] = mockFindAndCountWithDecryption.mock.calls[0]
    expect(where).toEqual(expect.objectContaining({
      tenantId,
      organizationId,
      emailHash: { $in: lookupHashCandidates('Buyer@Example.com') },
      acceptedAt: null,
      cancelledAt: null,
    }))
    expect(where.personEntityId).toBeUndefined()
    expect(JSON.stringify(where)).not.toContain('Buyer@Example.com')
  })

  it('falls back to the default paging window when page/pageSize are not numbers', async () => {
    const { GET } = await import('../users-invite')

    const response = await GET(makeListRequest('page=abc&pageSize=none'))
    const json = await response.json()

    const [, , , options] = mockFindAndCountWithDecryption.mock.calls[0]
    expect(options).toEqual(expect.objectContaining({ limit: 25, offset: 0 }))
    expect(json.page).toBe(1)
    expect(json.totalPages).toBe(1)
  })

  it('rejects a non-uuid entity filter before it reaches the database', async () => {
    const { GET } = await import('../users-invite')

    const response = await GET(makeListRequest('personEntityId=not-a-uuid'))

    expect(response.status).toBe(400)
    expect(mockFindAndCountWithDecryption).not.toHaveBeenCalled()
  })

  it('requires authentication', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce(null)
    const { GET } = await import('../users-invite')

    const response = await GET(makeListRequest())

    expect(response.status).toBe(401)
    expect(mockFindAndCountWithDecryption).not.toHaveBeenCalled()
  })

  it('requires the customer_accounts.view feature', async () => {
    mockUserHasAllFeatures.mockResolvedValueOnce(false)
    const { GET } = await import('../users-invite')

    const response = await GET(makeListRequest())

    expect(response.status).toBe(403)
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      staffUserId,
      ['customer_accounts.view'],
      { tenantId, organizationId },
    )
    expect(mockFindAndCountWithDecryption).not.toHaveBeenCalled()
  })
})
