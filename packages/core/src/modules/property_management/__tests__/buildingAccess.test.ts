import { buildingIdFilter, isBuildingPermitted, NO_MATCH_ID, permittedBuildingIds } from '../lib/buildingAccess'

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
