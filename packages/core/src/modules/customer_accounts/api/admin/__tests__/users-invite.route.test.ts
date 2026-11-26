/** @jest-environment node */

import { NextResponse } from 'next/server'
import { conflict } from '@open-mercato/shared/lib/crud/errors'
import { hashToken } from '../../../lib/tokenGenerator'

const mockCheckAuthRateLimit = jest.fn()
const mockCreateInvitation = jest.fn()
const mockRollbackInvitation = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockSendCustomerInvitationEmail = jest.fn()
const mockEm = {
  getMetadata: () => ({ find: () => undefined }),
  findOne: jest.fn(),
}

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const roleId = '11111111-1111-4111-8111-111111111111'
const staffUserId = '44444444-4444-4444-8444-444444444444'
const apiKeyId = '55555555-5555-4555-8555-555555555555'

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'customerInvitationService') return { createInvitation: mockCreateInvitation, rollbackInvitation: mockRollbackInvitation }
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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: () => 'A pending invitation for this email belongs to another person.' }),
}))

function makeInviteRequest(links: { customerEntityId?: string; personEntityId?: string } = {}): Request {
  return new Request('http://localhost/api/customer_accounts/admin/users-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'buyer@example.com',
      roleIds: [roleId],
      displayName: 'Buyer User',
      ...links,
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
      rollbackState: null,
    })
    mockRollbackInvitation.mockResolvedValue(undefined)
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

  it('returns a translated invitation conflict without sending email or rolling back', async () => {
    mockCreateInvitation.mockRejectedValueOnce(conflict('customer_accounts.errors.invitationLinkedToAnotherPerson'))
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'A pending invitation for this email belongs to another person.',
    })
    expect(mockSendCustomerInvitationEmail).not.toHaveBeenCalled()
    expect(mockRollbackInvitation).not.toHaveBeenCalled()
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
      tenantId,
      email: 'buyer@example.com',
      rawToken: 'raw-invite-token',
    })
    expect(JSON.stringify(json)).not.toContain('raw-invite-token')
  })

  it.each([
    ['customerEntityId', 'Company not found'],
    ['personEntityId', 'Person not found'],
  ] as const)('rejects an invite with %s when customers is disabled', async (field, error) => {
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest({ [field]: '77777777-7777-4777-8777-777777777777' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error })
    expect(mockEm.findOne).not.toHaveBeenCalled()
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
    expect(mockRollbackInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ id: '66666666-6666-4666-8666-666666666666' }),
      null,
      hashToken('raw-invite-token'),
    )
    consoleErrorSpy.mockRestore()
  })

  it('restores a reused invitation when the replacement email cannot be sent', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const rollbackState = { token: 'prior-hashed-token' }
    mockCreateInvitation.mockResolvedValueOnce({
      invitation: {
        id: '66666666-6666-4666-8666-666666666666',
        email: 'buyer@example.com',
        expiresAt: new Date('2026-06-18T12:00:00.000Z').toISOString(),
      },
      rawToken: 'raw-invite-token',
      reused: true,
      rollbackState,
    })
    mockSendCustomerInvitationEmail.mockRejectedValueOnce(new Error('smtp unavailable'))
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest())

    expect(response.status).toBe(502)
    expect(mockRollbackInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ id: '66666666-6666-4666-8666-666666666666' }),
      rollbackState,
      hashToken('raw-invite-token'),
    )
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
