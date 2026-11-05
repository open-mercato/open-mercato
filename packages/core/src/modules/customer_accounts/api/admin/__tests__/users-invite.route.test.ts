/** @jest-environment node */

import { NextResponse } from 'next/server'
import { CustomerRole } from '@open-mercato/core/modules/customer_accounts/data/entities'

const mockCheckAuthRateLimit = jest.fn()
const mockCreateInvitation = jest.fn()
const mockRollbackInvitation = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockSendCustomerInvitationEmail = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockIsOwnedCompanyEntity = jest.fn()
const mockEmit = jest.fn()
const mockEm = {}

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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerEntityOwnership', () => ({
  isOwnedCompanyEntity: (...args: unknown[]) => mockIsOwnedCompanyEntity(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string) => key })),
}))

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

function makeInviteRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/customer_accounts/admin/users-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'buyer@example.com',
      roleIds: [roleId],
      displayName: 'Buyer User',
      ...overrides,
    }),
  })
}

describe('admin customer account user invite route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindWithDecryption.mockReset()
    mockFindWithDecryption.mockResolvedValue([{ id: roleId, customerAssignable: true }])
    mockIsOwnedCompanyEntity.mockResolvedValue(true)
    mockEmit.mockResolvedValue(undefined)
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

  it('looks up invitation roles within the caller tenant and organization', async () => {
    const { POST } = await import('../users-invite')

    expect((await POST(makeInviteRequest())).status).toBe(201)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      mockEm,
      CustomerRole,
      { id: { $in: [roleId] }, tenantId, organizationId, deletedAt: null, customerAssignable: true },
      undefined,
      { tenantId, organizationId },
    )
  })

  it.each([
    { reason: 'nonassignable', changes: { customerAssignable: false } },
    { reason: 'other organization', changes: { organizationId: apiKeyId } },
    { reason: 'other tenant', changes: { tenantId: apiKeyId } },
    { reason: 'deleted', changes: { deletedAt: new Date() } },
    { reason: 'missing', changes: { id: apiKeyId } },
  ])('rejects a $reason role before creating, sending, or broadcasting an invitation', async ({ changes }) => {
    const role = { id: roleId, tenantId, organizationId, deletedAt: null, customerAssignable: true, ...changes }
    mockFindWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
      const filter = where as { id: { $in: string[] } }
      const matches = filter.id.$in.includes(role.id) && Object.entries(where).every(([key, value]) => (
        key === 'id' || value === role[key as keyof typeof role]
      ))
      return matches ? [role] : []
    })
    const { POST } = await import('../users-invite')

    expect((await POST(makeInviteRequest())).status).toBe(400)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(mockSendCustomerInvitationEmail).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('rejects the whole invitation when one of the requested roles is unavailable', async () => {
    const { POST } = await import('../users-invite')

    const response = await POST(makeInviteRequest({ roleIds: [roleId, apiKeyId] }))

    expect(response.status).toBe(400)
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(mockSendCustomerInvitationEmail).not.toHaveBeenCalled()
  })

  it('accepts repeated IDs of an assignable role', async () => {
    const { POST } = await import('../users-invite')

    expect((await POST(makeInviteRequest({ roleIds: [roleId, roleId] }))).status).toBe(201)
  })

  it('rejects invitations without requested roles', async () => {
    const { POST } = await import('../users-invite')

    expect((await POST(makeInviteRequest({ roleIds: [] }))).status).toBe(400)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('keeps company validation scoped to the caller before any invitation side effects', async () => {
    mockIsOwnedCompanyEntity.mockResolvedValue(false)
    const { POST } = await import('../users-invite')

    expect((await POST(makeInviteRequest({ customerEntityId: apiKeyId }))).status).toBe(400)
    expect(mockIsOwnedCompanyEntity).toHaveBeenCalledWith(mockEm, apiKeyId, { tenantId, organizationId })
    expect(mockCreateInvitation).not.toHaveBeenCalled()
    expect(mockSendCustomerInvitationEmail).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
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
