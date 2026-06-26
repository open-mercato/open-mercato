/** @jest-environment node */

const mockCheckAuthRateLimit = jest.fn()
const mockCreateInvitation = jest.fn()
const mockRemoveInvitation = jest.fn()
const mockGetCustomerAuthFromRequest = jest.fn()
const mockRequireCustomerFeature = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockSendCustomerInvitationEmail = jest.fn()

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const customerEntityId = '44444444-4444-4444-8444-444444444444'
const portalUserId = '55555555-5555-4555-8555-555555555555'
const roleId = '11111111-1111-4111-8111-111111111111'

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerRbacService') return {}
    if (token === 'customerInvitationService') return { createInvitation: mockCreateInvitation, removeInvitation: mockRemoveInvitation }
    if (token === 'em') return {}
    return null
  }),
}

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
  customerInviteIpRateLimitConfig: { points: 20, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite-ip' },
  customerInviteRateLimitConfig: { points: 5, duration: 60, blockDuration: 120, keyPrefix: 'customer-invite' },
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimitIdentifier', () => ({
  readNormalizedEmailFromJsonRequest: jest.fn(async () => 'buyer@example.com'),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
  requireCustomerFeature: (...args: unknown[]) => mockRequireCustomerFeature(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/invitationEmail', () => ({
  sendCustomerInvitationEmail: (...args: unknown[]) => mockSendCustomerInvitationEmail(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

function makeInviteRequest(roles = [roleId]): Request {
  return new Request('http://localhost/api/customer_accounts/portal/users-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'buyer@example.com',
      roleIds: roles,
      displayName: 'Buyer User',
    }),
  })
}

describe('portal customer account user invite route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null, compoundKey: null })
    mockRequireCustomerFeature.mockResolvedValue(undefined)
    mockGetCustomerAuthFromRequest.mockResolvedValue({
      sub: portalUserId,
      tenantId,
      orgId: organizationId,
      customerEntityId,
    })
    mockFindWithDecryption.mockResolvedValue([
      { id: roleId, name: 'Portal buyer', customerAssignable: true },
    ])
    mockCreateInvitation.mockResolvedValue({
      invitation: {
        id: '66666666-6666-4666-8666-666666666666',
        email: 'buyer@example.com',
        expiresAt: new Date('2026-06-18T12:00:00.000Z').toISOString(),
      },
      rawToken: 'raw-invite-token',
      reused: false,
    })
    mockRemoveInvitation.mockResolvedValue(undefined)
    mockSendCustomerInvitationEmail.mockResolvedValue(undefined)
  })

  it('creates a portal-admin invitation and sends the invitation email', async () => {
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())

    expect(response.status).toBe(201)
    expect(mockRequireCustomerFeature).toHaveBeenCalledWith(
      expect.objectContaining({ sub: portalUserId }),
      ['portal.users.manage'],
      {},
    )
    expect(mockCreateInvitation).toHaveBeenCalledWith(
      'buyer@example.com',
      { tenantId, organizationId },
      expect.objectContaining({
        customerEntityId,
        roleIds: [roleId],
        invitedByCustomerUserId: portalUserId,
        displayName: 'Buyer User',
      }),
    )
    expect(mockSendCustomerInvitationEmail).toHaveBeenCalledWith({
      container: mockContainer,
      organizationId,
      email: 'buyer@example.com',
      rawToken: 'raw-invite-token',
    })
  })

  it('keeps customerAssignable validation for portal-selected roles', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { id: roleId, name: 'Internal role', customerAssignable: false },
    ])
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error).toContain('cannot be assigned by portal users')
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(mockSendCustomerInvitationEmail).not.toHaveBeenCalled()
  })

  it('returns 502 and rolls back the freshly-created invitation when the email cannot be sent', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSendCustomerInvitationEmail.mockRejectedValueOnce(new Error('smtp unavailable'))
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())
    const json = await response.json()

    expect(response.status).toBe(502)
    expect(json).toEqual({ ok: false, error: 'Invitation email could not be sent' })
    expect(mockRemoveInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ id: '66666666-6666-4666-8666-666666666666' }),
    )
    consoleErrorSpy.mockRestore()
  })

  it('does NOT roll back a reused (already-pending) invitation when the email cannot be sent', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCreateInvitation.mockResolvedValueOnce({
      invitation: {
        id: '66666666-6666-4666-8666-666666666666',
        email: 'buyer@example.com',
        expiresAt: new Date('2026-06-18T12:00:00.000Z').toISOString(),
      },
      rawToken: 'raw-invite-token',
      reused: true,
    })
    mockSendCustomerInvitationEmail.mockRejectedValueOnce(new Error('smtp unavailable'))
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())

    expect(response.status).toBe(502)
    expect(mockRemoveInvitation).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
