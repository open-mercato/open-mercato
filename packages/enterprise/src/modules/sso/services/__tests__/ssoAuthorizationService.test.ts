import type { EntityManager } from '@mikro-orm/postgresql'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { lockAuthorizationState } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { SsoConfig, SsoRoleGrant } from '../../data/entities'
import { SsoAuthorizationService } from '../ssoAuthorizationService'
import { isSsoUserDeactivated } from '../../lib/deactivation'

const mockFindOne = jest.fn()
const mockFind = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args),
  findWithDecryption: (...args: unknown[]) => mockFind(...args),
}))

jest.mock('@open-mercato/core/modules/auth/lib/authorizationStateLocks', () => ({
  lockAuthorizationState: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../lib/deactivation', () => ({ isSsoUserDeactivated: jest.fn().mockResolvedValue(false) }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

type Row = Record<string, unknown>
type ActorAcl = { isSuperAdmin: boolean; features: string[]; organizations: string[] | null }

function refId(value: unknown): unknown {
  return value && typeof value === 'object' && 'id' in value ? value.id : value
}

function matches(row: Row, where: Row, tables: Map<unknown, Row[]>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected === null) return actual == null
    if (expected && typeof expected === 'object') {
      const condition = expected as Row
      const actualId = refId(actual)
      if (Array.isArray(condition.$in)) return condition.$in.includes(actualId)
      const relation = key === 'role' ? Role : key === 'user' ? User : null
      const related = relation ? tables.get(relation)?.find((candidate) => candidate.id === actualId) : undefined
      return related ? matches(related, condition, tables) : actualId === refId(expected)
    }
    return refId(actual) === expected
  })
}

function fixture() {
  const actor = { id: 'editor', tenantId: 'tenant', organizationId: 'org', kind: 'human', isConfirmed: true, deletedAt: null as Date | null }
  const scimActor = { ...actor, id: 'scim-editor' }
  const target = { ...actor, id: 'target' }
  const role = { id: 'staff-role', name: 'Staff', tenantId: 'tenant', deletedAt: null }
  const roleAcl = {
    id: 'staff-acl', role, tenantId: 'tenant', isSuperAdmin: false,
    featuresJson: ['customers.people.view'], organizationsJson: ['org'], deletedAt: null,
  }
  const config = {
    id: 'config', tenantId: 'tenant', organizationId: 'org',
    authorizationUserId: actor.id, appRoleMappings: { staff: 'Staff' },
  } as SsoConfig
  const tables = new Map<unknown, Row[]>([
    [Organization, [{ id: 'org', tenant: { id: 'tenant' }, deletedAt: null }]],
    [User, [actor, scimActor, target]],
    [Role, [role]],
    [RoleAcl, [roleAcl]],
    [UserRole, [{ id: 'target-role', user: target, role, deletedAt: null }]],
    [UserAcl, []],
    [SsoRoleGrant, []],
  ])
  const actorAcl: ActorAcl = {
    isSuperAdmin: false,
    features: ['sso.config.manage', 'sso.scim.manage', 'customers.people.view'],
    organizations: ['org'],
  }
  const scimActorAcl: ActorAcl = { ...actorAcl, features: [...actorAcl.features] }
  const acls = new Map([[actor.id, actorAcl], [scimActor.id, scimActorAcl]])
  mockFind.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    (tables.get(entity) ?? []).filter((row) => matches(row, where, tables)))
  mockFindOne.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    (tables.get(entity) ?? []).find((row) => matches(row, where, tables)) ?? null)
  const em = {
    isInTransaction: jest.fn().mockReturnValue(true),
    findOne: jest.fn(async (entity: unknown, where: Row): Promise<Row | null> => mockFindOne(em, entity, where)),
    find: jest.fn(async (entity: unknown, where: Row): Promise<Row[]> => mockFind(em, entity, where)),
  }
  const rbacService = {
    loadAclWithEntityManager: jest.fn(async (_em: unknown, userId: string) =>
      acls.get(userId) ?? { isSuperAdmin: false, features: [], organizations: [] }),
    userHasAllFeaturesWithEntityManager: jest.fn(async (
      _em: unknown,
      userId: string,
      required: string[],
      scope: { organizationId: string },
    ) => {
      const acl = acls.get(userId)
      return !!acl && authorizeFeatures(required, {
        grantedFeatures: acl.features,
        unrestricted: acl.isSuperAdmin,
        scopeAllowed: acl.isSuperAdmin || acl.organizations === null || acl.organizations.includes(scope.organizationId),
      })
    }),
  }
  const transactionalEm = em as unknown as EntityManager
  const service = new SsoAuthorizationService(transactionalEm, rbacService as unknown as RbacService)
  return { service, em: transactionalEm, emDouble: em, config, actor, target, role, roleAcl, actorAcl, scimActorAcl, tables, rbacService }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(lockAuthorizationState).mockResolvedValue(undefined)
  jest.mocked(isSsoUserDeactivated).mockResolvedValue(false)
})

describe('SSO delegation authorization', () => {
  it('accepts a tenant-scoped mapping using the same normalized role name as login', async () => {
    const { service, em, config, actor, role, rbacService } = fixture()
    config.appRoleMappings = { staff: '  STAFF  ' }

    await expect(service.assertConfiguration(em, config)).resolves.toBe('tenant')
    expect(lockAuthorizationState).toHaveBeenCalledTimes(1)
    expect(lockAuthorizationState).toHaveBeenCalledWith(em, {
      userIds: [actor.id], roleIds: [role.id], tenantIds: ['tenant'],
    })
    expect(rbacService.loadAclWithEntityManager.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(lockAuthorizationState).mock.invocationCallOrder[0],
    )
  })

  it('rejects a custom mapped role whose live ACL grants superadmin', async () => {
    const { service, em, config, roleAcl } = fixture()
    roleAcl.isSuperAdmin = true
    await expect(service.assertConfiguration(em, config)).rejects.toMatchObject({ status: 403 })
  })

  it('does not classify an ordinary role by its superadmin name', async () => {
    const { service, em, config, role } = fixture()
    role.name = 'superadmin'
    config.appRoleMappings = { staff: 'superadmin' }
    await expect(service.assertConfiguration(em, config)).resolves.toBe('tenant')
  })

  it('rejects ordinary mapped features above the author ceiling', async () => {
    const { service, em, config, roleAcl } = fixture()
    roleAcl.featuresJson = ['auth.users.manage']
    await expect(service.assertConfiguration(em, config)).rejects.toMatchObject({ status: 403 })
  })

  it('rejects unknown mapping targets instead of permitting a future privileged role', async () => {
    const { service, em, config } = fixture()
    config.appRoleMappings = { staff: 'missing' }
    await expect(service.assertConfiguration(em, config)).rejects.toMatchObject({ status: 403 })
  })

  it.each(['STAFF', ' Staff '])('rejects ambiguous normalized mapping roles named %s', async (name) => {
    const { service, em, config, role, tables } = fixture()
    tables.set(Role, [role, { ...role, id: 'ambiguous-role', name }])

    await expect(service.assertConfiguration(em, config)).rejects.toMatchObject({ status: 403 })

    expect(lockAuthorizationState).not.toHaveBeenCalled()
  })

  it('returns the exact immutable mapping footprint authorized for the account', async () => {
    const { service, em, config, target, role } = fixture()

    const authorization = await service.authorizeAccount(em, config, target as User)

    expect(authorization).toEqual({ tenantId: 'tenant', mappedRoleIds: [role.id] })
    expect(Object.isFrozen(authorization.mappedRoleIds)).toBe(true)
  })

  it('requires persisted authority while allowing an explicit author to reauthorize legacy config', async () => {
    const { service, em, config, actor } = fixture()
    config.authorizationUserId = null
    await expect(service.assertConfiguration(em, config)).rejects.toMatchObject({ status: 403 })
    await expect(service.assertConfiguration(em, config, actor.id)).resolves.toBe('tenant')
    await expect(service.assertConfiguration(em, config, null)).rejects.toMatchObject({ status: 403 })
  })

  it.each(['configuration', 'scim'])('rejects an API-key %s author before acquiring UUID user locks', async (authority) => {
    const { service, em, config } = fixture()
    const apiKeyPrincipal = 'api_key:00000000-0000-4000-8000-000000000001'
    if (authority === 'configuration') config.authorizationUserId = apiKeyPrincipal

    await expect(service.assertConfiguration(em, config, undefined,
      authority === 'scim' ? apiKeyPrincipal : undefined)).rejects.toMatchObject({ status: 403 })

    expect(lockAuthorizationState).not.toHaveBeenCalled()
  })

  it.each(['deleted', 'nonhuman', 'cross-tenant', 'unconfirmed'])('rejects an author that is %s', async (state) => {
    const { service, em, config, actor } = fixture()
    if (state === 'deleted') actor.deletedAt = new Date()
    if (state === 'nonhuman') actor.kind = 'agent'
    if (state === 'cross-tenant') actor.tenantId = 'other-tenant'
    if (state === 'unconfirmed') actor.isConfirmed = false
    await expect(service.assertConfiguration(em, config)).rejects.toMatchObject({ status: 403 })
  })

  it.each(['editor', 'scim-editor'])('rejects deprovisioned delegation author %s under the existing locks', async (actorId) => {
    const { service, em, config } = fixture()
    jest.mocked(isSsoUserDeactivated).mockImplementation(async (_em, scope) => scope.userId === actorId)

    await expect(service.assertConfiguration(em, config, undefined, 'scim-editor')).rejects.toMatchObject({ status: 403 })

    expect(isSsoUserDeactivated).toHaveBeenCalledWith(em, {
      userId: actorId, tenantId: 'tenant', organizationId: 'org',
    })
    expect(jest.mocked(isSsoUserDeactivated).mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(lockAuthorizationState).mock.invocationCallOrder[0],
    )
  })

  it('checks lost author permission after acquiring authorization locks', async () => {
    const { service, em, config, actorAcl } = fixture()
    jest.mocked(lockAuthorizationState).mockImplementation(async () => {
      actorAcl.features = ['customers.people.view']
    })
    await expect(service.assertConfiguration(em, config)).rejects.toMatchObject({ status: 403 })
  })

  it('rejects a mapping whose resolved role changes while acquiring the footprint', async () => {
    const { service, em, config, tables, role } = fixture()
    jest.mocked(lockAuthorizationState).mockImplementation(async () => {
      tables.set(Role, [{ ...role, id: 'replacement-role' }])
    })
    await expect(service.assertConfiguration(em, config)).rejects.toMatchObject({ status: 403 })
  })

  it('resolves omitted config tenant through its organization and rejects inconsistent tenants', async () => {
    const { service, em, config } = fixture()
    config.tenantId = null
    await expect(service.assertConfiguration(em, config)).resolves.toBe('tenant')
    config.tenantId = 'other-tenant'
    await expect(service.resolveTenant(em, config)).rejects.toMatchObject({ status: 403 })
  })

  it('accepts an ordinary existing account with one combined actor and target footprint', async () => {
    const { service, em, config, target, actor, role, tables } = fixture()
    tables.set(SsoRoleGrant, [{
      userId: target.id, ssoConfigId: config.id, tenantId: 'tenant', organizationId: 'org', roleId: 'orphan-role',
    }])
    await expect(service.assertAccount(em, config, target as User)).resolves.toBe('tenant')
    expect(lockAuthorizationState).toHaveBeenCalledTimes(1)
    expect(lockAuthorizationState).toHaveBeenCalledWith(em, {
      userIds: [actor.id, target.id], roleIds: [role.id, 'orphan-role'], tenantIds: ['tenant'],
    })
  })

  it('rejects an existing target with direct superadmin privileges', async () => {
    const { service, em, config, target, tables } = fixture()
    tables.set(UserAcl, [{ user: target, tenantId: 'tenant', isSuperAdmin: true, deletedAt: null }])
    await expect(service.assertAccount(em, config, target as User)).rejects.toMatchObject({ status: 403 })
  })

  it('rejects an existing target whose role became superadmin after it was linked', async () => {
    const { service, em, config, target, roleAcl } = fixture()
    config.appRoleMappings = {}
    roleAcl.isSuperAdmin = true
    await expect(service.assertAccount(em, config, target as User)).rejects.toMatchObject({ status: 403 })
  })

  it.each(['features', 'organizations', 'implicit-organizations'])('rejects elevated direct target ACL %s', async (privilege) => {
    const { service, em, config, target, tables } = fixture()
    tables.set(UserAcl, [{
      user: target, tenantId: 'tenant', isSuperAdmin: false, deletedAt: null,
      featuresJson: privilege === 'features' ? ['auth.users.manage'] : [],
      organizationsJson: privilege === 'implicit-organizations' ? undefined : privilege === 'organizations' ? null : ['org'],
    }])
    await expect(service.assertAccount(em, config, target as User)).rejects.toMatchObject({ status: 403 })
  })

  it('rejects a target outside the configuration organization', async () => {
    const { service, em, config, target } = fixture()
    target.organizationId = 'other-org'
    await expect(service.assertAccount(em, config, target as User)).rejects.toMatchObject({ status: 403 })
  })

  it('allows a global superadmin author from another tenant', async () => {
    const { service, em, config, target, actor, actorAcl, roleAcl } = fixture()
    actor.tenantId = 'global-tenant'
    actor.organizationId = 'global-org'
    actorAcl.isSuperAdmin = true
    roleAcl.isSuperAdmin = true
    await expect(service.assertAccount(em, config, target as User)).resolves.toBe('tenant')
    expect(isSsoUserDeactivated).toHaveBeenCalledWith(em, {
      userId: actor.id, tenantId: 'global-tenant', organizationId: 'global-org',
    })
  })

  it('requires a current SCIM token author even for new-account provisioning', async () => {
    const { service, em, config, scimActorAcl } = fixture()
    await expect(service.assertConfiguration(em, config, undefined, null)).rejects.toMatchObject({ status: 403 })
    scimActorAcl.features = ['customers.people.view']
    await expect(service.assertConfiguration(em, config, undefined, 'scim-editor')).rejects.toMatchObject({ status: 403 })
  })

  it('applies the SCIM author ceiling even when config author is a superadmin', async () => {
    const { service, em, config, target, actorAcl, tables } = fixture()
    actorAcl.isSuperAdmin = true
    tables.set(UserAcl, [{ user: target, tenantId: 'tenant', isSuperAdmin: true, deletedAt: null }])
    await expect(service.assertAccount(em, config, target as User, 'scim-editor')).rejects.toMatchObject({ status: 403 })
    expect(lockAuthorizationState).toHaveBeenCalledWith(em, expect.objectContaining({
      userIds: ['editor', 'scim-editor', 'target'],
    }))
  })

  it('fails closed outside the caller transaction', async () => {
    const { service, em, emDouble, config } = fixture()
    emDouble.isInTransaction.mockReturnValue(false)
    await expect(service.assertConfiguration(em, config)).rejects.toMatchObject({
      status: 403, body: { error: 'sso.errors.authorizationDenied' },
    })
    expect(lockAuthorizationState).not.toHaveBeenCalled()
  })
})
