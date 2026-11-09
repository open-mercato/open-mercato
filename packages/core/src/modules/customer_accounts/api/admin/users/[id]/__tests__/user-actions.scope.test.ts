/** @jest-environment node */

const mockGetAuth = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockCreatePasswordReset = jest.fn()
const mockEmFindOne = jest.fn()
const mockEmNativeUpdate = jest.fn()
const mockEmit = jest.fn(async () => undefined)
const mockResolveOrganizationScope = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'customerTokenService') return { createPasswordReset: mockCreatePasswordReset }
    if (token === 'em') return { findOne: mockEmFindOne, nativeUpdate: mockEmNativeUpdate }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuth(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScope(args)),
}))

import { POST as sendResetLink } from '@open-mercato/core/modules/customer_accounts/api/admin/users/[id]/send-reset-link'
import { POST as verifyEmail } from '@open-mercato/core/modules/customer_accounts/api/admin/users/[id]/verify-email'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const foreignOrgId = '33333333-3333-4333-8333-333333333333'
const adminId = '44444444-4444-4444-8444-444444444444'
const userId = '55555555-5555-4555-8555-555555555555'

const foreignUser = {
  id: userId,
  tenantId,
  organizationId: foreignOrgId,
  email: 'foreign@example.com',
  emailVerifiedAt: null,
}

function organizationScope(filterIds: string[] | null) {
  return { selectedId: filterIds?.[0] ?? null, filterIds, allowedIds: filterIds, tenantId }
}

function matchesOrganizationFilter(filter: unknown, organizationId: string): boolean {
  if (filter === undefined) return true
  if (typeof filter === 'string') return filter === organizationId
  const candidates = (filter as { $in?: unknown })?.$in
  return Array.isArray(candidates) && candidates.includes(organizationId)
}

function buildRequest(action: 'send-reset-link' | 'verify-email') {
  return new Request(
    `http://localhost/api/customer_accounts/admin/users/${userId}/${action}`,
    { method: 'POST' },
  )
}

describe('admin customer-user actions — target organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockCreatePasswordReset.mockResolvedValue('raw-reset-token')
    mockResolveOrganizationScope.mockResolvedValue(organizationScope([orgId]))
    mockEmFindOne.mockImplementation(async (
      _entity: unknown,
      where: Record<string, unknown>,
    ) => where.id === userId && where.tenantId === tenantId && matchesOrganizationFilter(where.organizationId, foreignOrgId)
      ? foreignUser
      : null)
  })

  it('returns 404 before creating a reset token for a same-tenant user outside the caller organization scope', async () => {
    const res = await sendResetLink(buildRequest('send-reset-link'), { params: { id: userId } })

    expect(res.status).toBe(404)
    expect(mockCreatePasswordReset).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('returns 404 before verifying the email of a same-tenant user outside the caller organization scope', async () => {
    const res = await verifyEmail(buildRequest('verify-email'), { params: { id: userId } })

    expect(res.status).toBe(404)
    expect(mockEmNativeUpdate).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('creates a reset link for a user of another organization selected in the switcher (#5577)', async () => {
    mockResolveOrganizationScope.mockResolvedValue(organizationScope([foreignOrgId]))

    const res = await sendResetLink(buildRequest('send-reset-link'), { params: { id: userId } })

    expect(res.status).toBe(200)
    expect(mockCreatePasswordReset).toHaveBeenCalledWith(userId, tenantId)
  })

  it('verifies the email of a user from any tenant organization under "All organizations" (#5577)', async () => {
    mockResolveOrganizationScope.mockResolvedValue(organizationScope(null))

    const res = await verifyEmail(buildRequest('verify-email'), { params: { id: userId } })

    expect(res.status).toBe(200)
    expect(mockEmNativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { id: userId, tenantId, organizationId: foreignOrgId },
      expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
    )
  })
})
