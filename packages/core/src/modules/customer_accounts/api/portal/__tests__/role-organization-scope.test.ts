/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const foreignOrganizationId = '22222222-2222-4222-8222-222222222223'
const customerEntityId = '33333333-3333-4333-8333-333333333333'
const actorId = '44444444-4444-4444-8444-444444444444'
const targetUserId = '55555555-5555-4555-8555-555555555555'
const roleId = '66666666-6666-4666-8666-666666666666'

const mockGetCustomerAuthFromRequest = jest.fn()
const mockRequireCustomerFeature = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockInvalidateUserCache = jest.fn(async () => undefined)

const tx = {
  nativeDelete: jest.fn(async () => 1),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
  persist: jest.fn(),
}
const em = {
  transactional: jest.fn(async (work: (manager: typeof tx) => Promise<void>) => work(tx)),
}
const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return em
    if (token === 'customerRbacService') return { invalidateUserCache: mockInvalidateUserCache }
    return null
  }),
}

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
  requireCustomerFeature: (...args: unknown[]) => mockRequireCustomerFeature(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { PUT } from '../users/[id]/roles'

describe('portal role assignment organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCustomerAuthFromRequest.mockResolvedValue({
      sub: actorId,
      tenantId,
      orgId: organizationId,
      customerEntityId,
    })
    mockRequireCustomerFeature.mockResolvedValue(undefined)
    mockFindOneWithDecryption.mockResolvedValue({
      id: targetUserId,
      tenantId,
      organizationId,
      customerEntityId,
    })
  })

  it('rejects an assignable role owned by another organization in the same tenant', async () => {
    mockFindWithDecryption.mockImplementation(async (_em, _entity, where: Record<string, unknown>) => (
      where.organizationId === organizationId
        ? []
        : [{ id: roleId, tenantId, organizationId: foreignOrganizationId, customerAssignable: true }]
    ))

    const res = await PUT(new Request(
      `http://localhost/api/customer_accounts/portal/users/${targetUserId}/roles`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleIds: [roleId] }),
      },
    ), { params: { id: targetUserId } })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'Role not found or not assignable' })
    expect(mockFindWithDecryption.mock.calls[0][2]).toEqual(expect.objectContaining({
      id: { $in: [roleId] },
      tenantId,
      organizationId,
      deletedAt: null,
    }))
    expect(em.transactional).not.toHaveBeenCalled()
    expect(mockInvalidateUserCache).not.toHaveBeenCalled()
  })
})
