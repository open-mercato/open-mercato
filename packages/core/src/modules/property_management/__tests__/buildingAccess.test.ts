import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildingIdFilter, canManageAllBuildings, isBuildingPermitted, NO_MATCH_ID, permittedBuildingIds } from '../lib/buildingAccess'
import { resolvePermitted } from '../commands/shared'
import { crudPermitted } from '../api/crudShared'
import { buildTrustedSalesContext } from '../lib/salesCommandContext'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => [{ buildingId: 'b-1' }, { buildingId: 'b-2' }, { buildingId: 'b-1' }]),
}))

function container(manageAll: boolean) {
  const rbac = { userHasAllFeatures: jest.fn(async () => manageAll) }
  const em = { fork: () => ({}) }
  return {
    rbac,
    container: {
      resolve: (name: string) => {
        if (name === 'rbacService') return rbac
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
  }
}

const auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }

describe('permittedBuildingIds', () => {
  it('returns null (every building) for holders of manage_all', async () => {
    const { container: c, rbac } = container(true)
    await expect(permittedBuildingIds({ container: c, auth, tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toBeNull()
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['property_management.buildings.manage_all'], {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('returns the distinct assigned buildings for a manager', async () => {
    const { container: c } = container(false)
    await expect(permittedBuildingIds({ container: c, auth, tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toEqual(['b-1', 'b-2'])
  })

  it('returns nothing for an API key without a user', async () => {
    const { container: c } = container(false)
    await expect(
      permittedBuildingIds({ container: c, auth: { sub: 'api_key:1', tenantId: 'tenant-1', orgId: 'org-1' }, tenantId: 'tenant-1', organizationId: 'org-1' }),
    ).resolves.toEqual([])
  })

  it('returns nothing without auth unless the caller is an explicit system context', async () => {
    const { container: c, rbac } = container(true)
    await expect(permittedBuildingIds({ container: c, auth: null, tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toEqual([])
    await expect(permittedBuildingIds({ container: c, auth: null, tenantId: 'tenant-1', organizationId: 'org-1', system: false })).resolves.toEqual([])
    await expect(permittedBuildingIds({ container: c, auth: null, tenantId: 'tenant-1', organizationId: 'org-1', system: true })).resolves.toBeNull()
    expect(rbac.userHasAllFeatures).not.toHaveBeenCalled()
  })
})

describe('resolvePermitted', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

  it('keeps worker and sweep contexts unrestricted through the trusted system context', async () => {
    const { container: c } = container(false)
    await expect(resolvePermitted(buildTrustedSalesContext(c, scope), scope)).resolves.toBeNull()
  })

  it('denies a context that carries neither auth nor the system flag', async () => {
    const { container: c } = container(true)
    const ctx = { container: c, auth: null, organizationScope: null, selectedOrganizationId: 'org-1', organizationIds: ['org-1'] }
    await expect(resolvePermitted(ctx, scope)).resolves.toEqual([])
  })
})

describe('per-request memo', () => {
  const findMock = findWithDecryption as jest.Mock
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

  beforeEach(() => findMock.mockClear())

  it('resolves the permitted set once for the CRUD route and the command of the same request', async () => {
    const { container: c, rbac } = container(false)
    const request = new Request('http://localhost/api/property_management/buildings')
    const crudCtx = { container: c, auth, organizationScope: null, selectedOrganizationId: 'org-1', organizationIds: ['org-1'], request }
    await expect(crudPermitted(crudCtx)).resolves.toEqual(['b-1', 'b-2'])
    const commandCtx = { ...crudCtx, transactionalEm: undefined }
    await expect(resolvePermitted(commandCtx, scope)).resolves.toEqual(['b-1', 'b-2'])
    await expect(canManageAllBuildings({ container: c, auth, ...scope, request })).resolves.toBe(false)
    expect(rbac.userHasAllFeatures).toHaveBeenCalledTimes(1)
    expect(findMock).toHaveBeenCalledTimes(1)
  })

  it('resolves again for another request, another actor or another organization', async () => {
    const { container: c, rbac } = container(false)
    const first = new Request('http://localhost/a')
    const second = new Request('http://localhost/b')
    await permittedBuildingIds({ container: c, auth, ...scope, request: first })
    await permittedBuildingIds({ container: c, auth, ...scope, request: second })
    await permittedBuildingIds({ container: c, auth: { ...auth, sub: 'user-2' }, ...scope, request: first })
    await permittedBuildingIds({ container: c, auth, tenantId: 'tenant-1', organizationId: 'org-2', request: first })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledTimes(4)
    expect(findMock).toHaveBeenCalledTimes(4)
  })

  it('does not memoize without a request (workers, sweeps)', async () => {
    const { container: c, rbac } = container(false)
    await permittedBuildingIds({ container: c, auth, ...scope })
    await permittedBuildingIds({ container: c, auth, ...scope })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledTimes(2)
  })

  it('forgets a failed resolution so the request can retry it', async () => {
    const rbac = { userHasAllFeatures: jest.fn().mockRejectedValueOnce(new Error('[internal] rbac down')).mockResolvedValue(true) }
    const c = { resolve: (name: string) => (name === 'rbacService' ? rbac : { fork: () => ({}) }) } as never
    const request = new Request('http://localhost/retry')
    await expect(permittedBuildingIds({ container: c, auth, ...scope, request })).rejects.toThrow('rbac down')
    await expect(permittedBuildingIds({ container: c, auth, ...scope, request })).resolves.toBeNull()
    expect(rbac.userHasAllFeatures).toHaveBeenCalledTimes(2)
  })
})

describe('filters', () => {
  it('builds list filters that never match when nothing is assigned', () => {
    expect(buildingIdFilter(null)).toBeNull()
    expect(buildingIdFilter([])).toEqual({ $in: [NO_MATCH_ID] })
    expect(buildingIdFilter(['b-1'])).toEqual({ $in: ['b-1'] })
    expect(isBuildingPermitted(['b-1'], 'b-2')).toBe(false)
    expect(isBuildingPermitted(null, 'b-2')).toBe(true)
  })
})
