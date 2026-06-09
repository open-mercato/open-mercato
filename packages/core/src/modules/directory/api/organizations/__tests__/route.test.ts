/** @jest-environment node */

const foreignTenantId = '11111111-1111-4111-8111-111111111111'
const foreignOrgId = '22222222-2222-4222-8222-222222222222'
const tenantlessUserId = '33333333-3333-4333-8333-333333333333'
const superAdminUserId = '44444444-4444-4444-8444-444444444444'
const allowedOrgId = '55555555-5555-4555-8555-555555555555'

const authMock = jest.fn()
const resolveIsSuperAdminMock = jest.fn()
const enforceTenantSelectionMock = jest.fn()
const resolveOrganizationScopeMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const emFind = jest.fn()
const emFindOne = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return { find: emFind, findOne: emFindOne }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/auth/lib/tenantAccess')
  return {
    ...actual,
    resolveIsSuperAdmin: (...args: unknown[]) => resolveIsSuperAdminMock(...args),
    enforceTenantSelection: (...args: unknown[]) => enforceTenantSelectionMock(...args),
  }
})

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeMock(...args),
  getSelectedOrganizationFromRequest: () => null,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

import { GET } from '../route'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'

describe('directory organizations GET — cross-tenant ?ids= guard (#2696)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    emFind.mockResolvedValue([])
    emFindOne.mockResolvedValue(null)
    findOneWithDecryptionMock.mockResolvedValue(null)
  })

  it('refuses a tenantless non-super-admin pivoting into another tenant via ?ids=', async () => {
    authMock.mockResolvedValue({ sub: tenantlessUserId, tenantId: null, orgId: null })
    resolveIsSuperAdminMock.mockResolvedValue(false)
    // tenantless caller has no permitted organization scope
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: null,
    })

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&ids=${foreignOrgId}`),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Tenant scope required')
    // The unscoped foreign-tenant discovery query must never run for this caller
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    // No foreign-tenant org rows leaked
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items).toHaveLength(0)
  })

  it('re-runs enforceTenantSelection on the derived tenant and refuses on a 403', async () => {
    authMock.mockResolvedValue({ sub: tenantlessUserId, tenantId: null, orgId: null })
    resolveIsSuperAdminMock.mockResolvedValue(false)
    // Caller is allowed to see allowedOrgId, but passes a foreign org id too.
    resolveOrganizationScopeMock.mockResolvedValue({
      selectedId: allowedOrgId,
      filterIds: [allowedOrgId],
      allowedIds: [allowedOrgId],
      tenantId: null,
    })
    findWithDecryptionMock.mockResolvedValue([
      { id: allowedOrgId, tenant: { id: foreignTenantId } },
    ])
    enforceTenantSelectionMock.mockImplementation(async () => {
      throw forbidden('Not authorized to target this tenant.')
    })

    const response = await GET(
      new Request(
        `http://localhost/api/directory/organizations?view=options&ids=${allowedOrgId},${foreignOrgId}`,
      ),
    )

    // Only the in-scope id is used for discovery; the foreign id is filtered out.
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    const filter = findWithDecryptionMock.mock.calls[0][2] as { id: { $in: string[] } }
    expect(filter.id.$in).toEqual([allowedOrgId])
    // enforceTenantSelection rejects the pivot → clean 403, no org graph returned.
    expect(response.status).toBe(403)
  })

  it('still allows a super-admin to derive the tenant from ?ids=', async () => {
    authMock.mockResolvedValue({ sub: superAdminUserId, tenantId: null, orgId: null })
    resolveIsSuperAdminMock.mockResolvedValue(true)
    findWithDecryptionMock.mockResolvedValue([
      { id: foreignOrgId, tenant: { id: foreignTenantId } },
    ])
    enforceTenantSelectionMock.mockResolvedValue(foreignTenantId)
    emFind.mockResolvedValue([
      { id: foreignOrgId, name: 'Foreign Org', parentId: null, isActive: true, depth: 0, treePath: foreignOrgId },
    ])

    const response = await GET(
      new Request(`http://localhost/api/directory/organizations?view=options&ids=${foreignOrgId}`),
    )

    // Super-admins bypass the scope intersection — discovery runs on the raw ids.
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    const filter = findWithDecryptionMock.mock.calls[0][2] as { id: { $in: string[] } }
    expect(filter.id.$in).toEqual([foreignOrgId])
    expect(resolveOrganizationScopeMock).not.toHaveBeenCalled()
    expect(enforceTenantSelectionMock).toHaveBeenCalledWith(expect.anything(), foreignTenantId)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toHaveLength(1)
  })
})
