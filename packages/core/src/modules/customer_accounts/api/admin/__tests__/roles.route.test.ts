/** @jest-environment node */
import { CustomerRole } from '@open-mercato/core/modules/customer_accounts/data/entities'

const mockGetAuth = jest.fn()
const mockRbac = { userHasAllFeatures: jest.fn() }
const mockEmFindAndCount = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

const mockEm = { findAndCount: mockEmFindAndCount }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return mockRbac
    if (token === 'em') return mockEm
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
  emitCustomerAccountsEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (args: unknown) => mockResolveOrganizationScopeForRequest(args),
}))

import { GET } from '@open-mercato/core/modules/customer_accounts/api/admin/roles'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const targetOrgId = '66666666-6666-4666-8666-666666666666'
const adminId = '33333333-3333-4333-8333-333333333333'

function rolesRequest(query = '') {
  return new Request(`http://localhost/api/customer_accounts/admin/roles${query}`)
}

describe('admin /api/customer_accounts/admin/roles — GET organization filter (#5576)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockEmFindAndCount.mockResolvedValue([[], 0])
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: targetOrgId,
      filterIds: [targetOrgId],
      allowedIds: null,
      tenantId,
    })
  })

  it('lists roles of the caller organization when no organizationId is passed', async () => {
    const res = await GET(rolesRequest('?pageSize=100'))

    expect(res.status).toBe(200)
    expect(mockResolveOrganizationScopeForRequest).not.toHaveBeenCalled()
    expect(mockEmFindAndCount.mock.calls[0][0]).toBe(CustomerRole)
    expect(mockEmFindAndCount.mock.calls[0][1]).toMatchObject({ tenantId, organizationId: orgId, deletedAt: null })
  })

  it('lists roles of a requested organization within the caller scope', async () => {
    const res = await GET(rolesRequest(`?pageSize=100&organizationId=${targetOrgId}`))

    expect(res.status).toBe(200)
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ selectedId: targetOrgId, tenantId }),
    )
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith(
      adminId,
      ['customer_accounts.view'],
      { tenantId, organizationId: targetOrgId },
    )
    expect(mockEmFindAndCount.mock.calls[0][1]).toMatchObject({ tenantId, organizationId: targetOrgId })
  })

  it('rejects an organization outside the caller scope without listing roles', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: orgId,
      filterIds: [orgId],
      allowedIds: [orgId],
      tenantId,
      selectionRejected: true,
    })

    const res = await GET(rolesRequest(`?organizationId=${targetOrgId}`))

    expect(res.status).toBe(400)
    expect(mockEmFindAndCount).not.toHaveBeenCalled()
  })

  it('answers 400 instead of a database error for a malformed organizationId', async () => {
    const res = await GET(rolesRequest('?organizationId=not-a-uuid'))

    expect(res.status).toBe(400)
    expect(mockResolveOrganizationScopeForRequest).not.toHaveBeenCalled()
    expect(mockEmFindAndCount).not.toHaveBeenCalled()
  })

  it('checks the caller permission before resolving a requested organization', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    const res = await GET(rolesRequest(`?organizationId=${targetOrgId}`))

    expect(res.status).toBe(403)
    expect(mockResolveOrganizationScopeForRequest).not.toHaveBeenCalled()
    expect(mockEmFindAndCount).not.toHaveBeenCalled()
  })
})
