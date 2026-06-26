/** @jest-environment node */

import { NextResponse } from 'next/server'

const mockCheckAuthRateLimit = jest.fn()
const mockCreateInvitation = jest.fn()
const mockRemoveInvitation = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockSendCustomerInvitationEmail = jest.fn()

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const roleId = '11111111-1111-4111-8111-111111111111'
const staffUserId = '44444444-4444-4444-8444-444444444444'
const apiKeyId = '55555555-5555-4555-8555-555555555555'

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'customerInvitationService') return { createInvitation: mockCreateInvitation, removeInvitation: mockRemoveInvitation }
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

jest.mock('@open-mercato/core/modules/customer_accounts/lib/invitationEmail', () => ({
  sendCustomerInvitationEmail: (...args: unknown[]) => mockSendCustomerInvitationEmail(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

function makeInviteRequest(): Request {
  return new Request('http://localhost/api/customer_accounts/admin/users-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'buyer@example.com',
      roleIds: [roleId],
      displayName: 'Buyer User',
    }),
  })
}

describe('admin customer account user invite route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null, compoundKey: null })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockGetAuthFromRequest.mockResolvedValue({
      sub: `api_key:${apiKeyId}`,
      userId: staffUserId,
      isApiKey: true,
      tenantId,
      orgId: organizationId,
    })
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

  it('keeps API-key RBAC subject and stores the backing user id as invitedByUserId', async () => {
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())

    expect(response.status).toBe(201)
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      `api_key:${apiKeyId}`,
      ['customer_accounts.invite'],
      { tenantId, organizationId },
    )
    expect(mockCreateInvitation).toHaveBeenCalledWith(
      'buyer@example.com',
      { tenantId, organizationId },
      expect.objectContaining({
        roleIds: [roleId],
        displayName: 'Buyer User',
        invitedByUserId: staffUserId,
      }),
    )
  })

  it('stores null invitedByUserId for machine-only API keys', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: `api_key:${apiKeyId}`,
      isApiKey: true,
      tenantId,
      orgId: organizationId,
    })
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())

    expect(response.status).toBe(201)
    expect(mockCreateInvitation).toHaveBeenCalledWith(
      'buyer@example.com',
      { tenantId, organizationId },
      expect.objectContaining({ invitedByUserId: null }),
    )
  })

  it('sends the invitation email with the raw one-time token and does not expose it in the response', async () => {
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())
    const json = await response.json()

    expect(mockSendCustomerInvitationEmail).toHaveBeenCalledWith({
      container: mockContainer,
      organizationId,
      email: 'buyer@example.com',
      rawToken: 'raw-invite-token',
    })
    expect(JSON.stringify(json)).not.toContain('raw-invite-token')
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

  it('returns 429 without creating an invitation when rate limited', async () => {
    mockCheckAuthRateLimit.mockResolvedValueOnce({
      error: NextResponse.json({ error: 'Too many requests' }, { status: 429 }),
      compoundKey: null,
    })
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())

    expect(response.status).toBe(429)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(mockSendCustomerInvitationEmail).not.toHaveBeenCalled()
  })
})
