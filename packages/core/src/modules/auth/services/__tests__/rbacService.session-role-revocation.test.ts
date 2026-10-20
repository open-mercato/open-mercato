import type { EntityManager } from '@mikro-orm/postgresql'
import { createMemoryStrategy } from '@open-mercato/cache'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Role, RoleAcl, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type Query = Record<string, unknown>
type MockEntityManager = {
  findOne: jest.Mock<Promise<unknown>, [unknown, Query, unknown?]>
  find: jest.Mock<Promise<unknown[]>, [unknown, Query, unknown?]>
  fork: jest.Mock<MockEntityManager, []>
}

type FixtureState = {
  key: ApiKey
  memberships: UserRole[]
  roleAcls: RoleAcl[]
}

const tenantId = 'tenant-1'
const ownerId = 'user-1'
const principalId = 'api_key:key-1'
const scope = { tenantId, organizationId: null }
const organizations = [{ id: 'org-1' }, { id: 'org-2' }]
const readFeature = 'auth.users.view'
const privilegedFeature = 'auth.users.edit'

function matchesQuery(record: unknown, query: unknown): boolean {
  if (query === null) return record === null || record === undefined
  if (typeof query !== 'object') {
    if (typeof record === 'object' && record !== null && 'id' in record) return record.id === query
    return record === query
  }
  if (record === null || record === undefined) return false
  const queryRecord = query as Query
  if (Array.isArray(queryRecord.$in)) {
    return queryRecord.$in.some((candidate) => matchesQuery(record, candidate))
  }
  if (typeof record !== 'object') return false
  return Object.entries(queryRecord).every(([property, value]) => (
    matchesQuery((record as Query)[property], value)
  ))
}

function createFixture(): FixtureState {
  const owner = Object.assign(new User(), { id: ownerId, tenantId })
  const readRole = Object.assign(new Role(), { id: 'role-read', tenantId, deletedAt: null })
  const privilegedRole = Object.assign(new Role(), { id: 'role-privileged', tenantId, deletedAt: null })
  return {
    key: Object.assign(new ApiKey(), {
      id: 'key-1',
      tenantId,
      organizationId: null,
      rolesJson: [readRole.id, privilegedRole.id],
      sessionToken: 'session-1',
      sessionUserId: ownerId,
      expiresAt: null,
      deletedAt: null,
    }),
    memberships: [readRole, privilegedRole].map((role) => Object.assign(new UserRole(), {
      user: owner,
      role,
      deletedAt: null,
    })),
    roleAcls: [
      Object.assign(new RoleAcl(), {
        role: readRole,
        tenantId,
        isSuperAdmin: false,
        featuresJson: [readFeature],
        organizationsJson: null,
      }),
      Object.assign(new RoleAcl(), {
        role: privilegedRole,
        tenantId,
        isSuperAdmin: false,
        featuresJson: [privilegedFeature],
        organizationsJson: null,
      }),
    ],
  }
}

function createMockEntityManager(state: FixtureState): MockEntityManager {
  const manager: MockEntityManager = {
    findOne: jest.fn(async (entity: unknown, query: Query) => {
      if (entity === ApiKey && matchesQuery(state.key, query)) return state.key
      return null
    }),
    find: jest.fn(async (entity: unknown, query: Query) => {
      if (entity === UserRole) return state.memberships.filter((membership) => matchesQuery(membership, query))
      if (entity === RoleAcl) return state.roleAcls.filter((roleAcl) => matchesQuery(roleAcl, query))
      return []
    }),
    fork: jest.fn(),
  }
  manager.fork.mockReturnValue(manager)
  return manager
}

function asEntityManager(manager: MockEntityManager): EntityManager {
  return manager as unknown as EntityManager
}

describe('RbacService session API-key role revocation', () => {
  it.each(['cold', 'warm'])('immediately removes revoked grants with a %s ACL cache', async (cacheState) => {
    const state = createFixture()
    const service = new RbacService(asEntityManager(createMockEntityManager(state)), createMemoryStrategy())
    if (cacheState === 'warm') {
      await expect(service.userHasAllFeatures(principalId, [privilegedFeature], scope)).resolves.toBe(true)
      await expect(service.getGrantedFeatures(principalId, scope)).resolves.toContain(privilegedFeature)
    }
    state.memberships = state.memberships.filter((membership) => membership.role.id === 'role-read')

    await expect(service.userHasAllFeatures(principalId, [privilegedFeature], scope)).resolves.toBe(false)
    await expect(service.userHasAllFeatures(principalId, [readFeature], scope)).resolves.toBe(true)
    await expect(service.getGrantedFeatures(principalId, scope)).resolves.toEqual([readFeature])
    expect(state.key.rolesJson).toEqual(['role-read', 'role-privileged'])
  })

  it.each(['cold', 'warm'])('immediately removes revoked organization access with a %s cache', async (cacheState) => {
    const state = createFixture()
    const service = new RbacService(asEntityManager(createMockEntityManager(state)), createMemoryStrategy())
    if (cacheState === 'warm') {
      const access = await service.resolveFeatureOrganizationAccess(principalId, [privilegedFeature], { tenantId })
      expect(access.filterOrganizationIds(organizations)).toEqual(['org-1', 'org-2'])
    }
    state.memberships = state.memberships.filter((membership) => membership.role.id === 'role-read')

    const revokedAccess = await service.resolveFeatureOrganizationAccess(principalId, [privilegedFeature], { tenantId })
    expect(revokedAccess.unrestricted).toBe(false)
    expect(revokedAccess.filterOrganizationIds(organizations)).toEqual([])
    const retainedAccess = await service.resolveFeatureOrganizationAccess(principalId, [readFeature], { tenantId })
    expect(retainedAccess.filterOrganizationIds(organizations)).toEqual(['org-1', 'org-2'])
  })

  it('uses only the supplied EntityManager to revalidate session roles', async () => {
    const serviceState = createFixture()
    const transactionState = createFixture()
    transactionState.memberships = transactionState.memberships.filter((membership) => membership.role.id === 'role-read')
    const serviceManager = createMockEntityManager(serviceState)
    const transactionManager = createMockEntityManager(transactionState)
    const service = new RbacService(asEntityManager(serviceManager), createMemoryStrategy())

    await expect(service.getGrantedFeaturesWithEntityManager(
      asEntityManager(transactionManager),
      principalId,
      scope,
    )).resolves.toEqual([readFeature])
    await expect(service.userHasAllFeaturesWithEntityManager(
      asEntityManager(transactionManager),
      principalId,
      [privilegedFeature],
      scope,
    )).resolves.toBe(false)
    expect(serviceManager.findOne).not.toHaveBeenCalled()
    expect(serviceManager.find).not.toHaveBeenCalled()
    expect(serviceManager.fork).not.toHaveBeenCalled()
    expect(transactionManager.fork).not.toHaveBeenCalled()
  })

  it('does not grant a role assigned after the session key was issued', async () => {
    const state = createFixture()
    state.key.rolesJson = ['role-read']
    const privilegedMembership = state.memberships.find((membership) => membership.role.id === 'role-privileged')!
    state.memberships = state.memberships.filter((membership) => membership.role.id === 'role-read')
    const service = new RbacService(asEntityManager(createMockEntityManager(state)), createMemoryStrategy())

    await expect(service.getGrantedFeatures(principalId, scope)).resolves.toEqual([readFeature])
    state.memberships.push(privilegedMembership)
    await expect(service.userHasAllFeatures(principalId, [privilegedFeature], scope)).resolves.toBe(false)
    const access = await service.resolveFeatureOrganizationAccess(principalId, [privilegedFeature], { tenantId })
    expect(access.filterOrganizationIds(organizations)).toEqual([])
    await expect(service.getGrantedFeaturesWithEntityManager(
      asEntityManager(createMockEntityManager(state)),
      principalId,
      scope,
    )).resolves.toEqual([readFeature])
  })

  it('preserves independent API-key grants without reading user memberships', async () => {
    const state = createFixture()
    state.key.sessionToken = null
    state.key.sessionUserId = null
    state.key.createdBy = ownerId
    state.memberships = []
    const manager = createMockEntityManager(state)
    const service = new RbacService(asEntityManager(manager), createMemoryStrategy())

    await expect(service.userHasAllFeatures(principalId, [privilegedFeature], scope)).resolves.toBe(true)
    await expect(service.getGrantedFeatures(principalId, scope)).resolves.toEqual([readFeature, privilegedFeature])
    const access = await service.resolveFeatureOrganizationAccess(principalId, [privilegedFeature], { tenantId })
    expect(access.filterOrganizationIds(organizations)).toEqual(['org-1', 'org-2'])
    await expect(service.getGrantedFeaturesWithEntityManager(
      asEntityManager(manager),
      principalId,
      scope,
    )).resolves.toEqual([readFeature, privilegedFeature])
    expect(manager.find.mock.calls.filter(([entity]) => entity === UserRole)).toEqual([])
  })

  it('ignores pre-existing cached projections containing revoked session roles', async () => {
    const state = createFixture()
    state.memberships = state.memberships.filter((membership) => membership.role.id === 'role-read')
    const cache = createMemoryStrategy()
    await cache.set(`rbac:${principalId}:${tenantId}:null`, {
      isSuperAdmin: true,
      features: ['*'],
      organizations: null,
    })
    await cache.set(`rbac:feature-organizations:${principalId}:${tenantId}`, {
      kind: 'api_key',
      organizationId: null,
      roleGrants: [{ isSuperAdmin: true, featuresJson: ['*'], organizationsJson: null }],
    })
    const service = new RbacService(asEntityManager(createMockEntityManager(state)), cache)

    await expect(service.userHasAllFeatures(principalId, [privilegedFeature], scope)).resolves.toBe(false)
    await expect(service.getGrantedFeatures(principalId, scope)).resolves.toEqual([readFeature])
    const access = await service.resolveFeatureOrganizationAccess(principalId, [privilegedFeature], { tenantId })
    expect(access.unrestricted).toBe(false)
    expect(access.filterOrganizationIds(organizations)).toEqual([])
  })

  it('excludes memberships outside the session key tenant', async () => {
    const state = createFixture()
    const privilegedMembership = state.memberships.find((membership) => membership.role.id === 'role-privileged')!
    privilegedMembership.role.tenantId = 'tenant-other'
    const manager = createMockEntityManager(state)
    const service = new RbacService(asEntityManager(manager), createMemoryStrategy())

    await expect(service.getGrantedFeatures(principalId, scope)).resolves.toEqual([readFeature])
    const access = await service.resolveFeatureOrganizationAccess(principalId, [privilegedFeature], { tenantId })
    expect(access.filterOrganizationIds(organizations)).toEqual([])
    const membershipQueries = manager.find.mock.calls.filter(([entity]) => entity === UserRole)
    expect(membershipQueries.length).toBeGreaterThan(0)
    for (const [, query] of membershipQueries) {
      expect(query.role).toEqual(expect.objectContaining({ tenantId }))
      expect(matchesQuery(privilegedMembership, query)).toBe(false)
    }
  })

  it('excludes soft-deleted memberships and roles', async () => {
    const state = createFixture()
    const privilegedMembership = state.memberships.find((membership) => membership.role.id === 'role-privileged')!
    privilegedMembership.deletedAt = new Date()
    const service = new RbacService(asEntityManager(createMockEntityManager(state)), createMemoryStrategy())

    await expect(service.getGrantedFeatures(principalId, scope)).resolves.toEqual([readFeature])
    privilegedMembership.deletedAt = null
    privilegedMembership.role.deletedAt = new Date()
    await expect(service.getGrantedFeatures(principalId, scope)).resolves.toEqual([readFeature])
    const access = await service.resolveFeatureOrganizationAccess(principalId, [privilegedFeature], { tenantId })
    expect(access.filterOrganizationIds(organizations)).toEqual([])
  })

  it('does not borrow matching role memberships from another owner', async () => {
    const state = createFixture()
    for (const membership of state.memberships) membership.user.id = 'user-other'
    const manager = createMockEntityManager(state)
    const service = new RbacService(asEntityManager(manager), createMemoryStrategy())

    await expect(service.getGrantedFeatures(principalId, scope)).resolves.toEqual([])
    const access = await service.resolveFeatureOrganizationAccess(principalId, [readFeature], { tenantId })
    expect(access.filterOrganizationIds(organizations)).toEqual([])
    await expect(service.getGrantedFeaturesWithEntityManager(
      asEntityManager(manager),
      principalId,
      scope,
    )).resolves.toEqual([])
  })

  it.each([
    { marker: 'session token', binding: { sessionToken: 'session-1', sessionUserId: null } },
    { marker: 'session owner', binding: { sessionToken: null, sessionUserId: '   ' } },
    { marker: 'encrypted session secret', binding: { sessionToken: null, sessionUserId: null, sessionSecretEncrypted: 'encrypted' } },
    { marker: 'OpenCode session', binding: { sessionToken: null, sessionUserId: null, opencodeSessionId: 'opencode-1' } },
  ])('fails closed for a $marker binding with no valid session owner', async ({ binding }) => {
    const state = createFixture()
    Object.assign(state.key, binding)
    const manager = createMockEntityManager(state)
    const service = new RbacService(asEntityManager(manager), createMemoryStrategy())

    await expect(service.userHasAllFeatures(principalId, [readFeature], scope)).resolves.toBe(false)
    await expect(service.getGrantedFeatures(principalId, scope)).resolves.toEqual([])
    const access = await service.resolveFeatureOrganizationAccess(principalId, [readFeature], { tenantId })
    expect(access.filterOrganizationIds(organizations)).toEqual([])
    await expect(service.getGrantedFeaturesWithEntityManager(
      asEntityManager(manager),
      principalId,
      scope,
    )).resolves.toEqual([])
  })
})
