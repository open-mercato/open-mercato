/** @jest-environment node */

const mockGetAuth = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockFindById = jest.fn()
const mockCreatePasswordReset = jest.fn()
const mockEmFindOne = jest.fn()
const mockEmNativeUpdate = jest.fn()
const mockEmit = jest.fn(async () => undefined)

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'customerUserService') return { findById: mockFindById }
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

describe('admin customer-user actions — target organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockCreatePasswordReset.mockResolvedValue('raw-reset-token')
    mockFindById.mockImplementation(async (
      _id: string,
      _tenantId: string,
      organizationId?: string,
    ) => organizationId === orgId ? null : foreignUser)
    mockEmFindOne.mockImplementation(async (
      _entity: unknown,
      where: Record<string, unknown>,
    ) => where.organizationId === orgId ? null : foreignUser)
  })

  it('returns 404 before creating a reset token for a same-tenant foreign-org user', async () => {
    const req = new Request(
      `http://localhost/api/customer_accounts/admin/users/${userId}/send-reset-link`,
      { method: 'POST' },
    )

    const res = await sendResetLink(req, { params: { id: userId } })

    expect(res.status).toBe(404)
    expect(mockCreatePasswordReset).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('returns 404 before verifying a same-tenant foreign-org user email', async () => {
    const req = new Request(
      `http://localhost/api/customer_accounts/admin/users/${userId}/verify-email`,
      { method: 'POST' },
    )

    const res = await verifyEmail(req, { params: { id: userId } })

    expect(res.status).toBe(404)
    expect(mockEmNativeUpdate).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
