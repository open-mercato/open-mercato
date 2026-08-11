jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    auth: { user: 'auth:user', role: 'auth:role' },
    directory: { organization: 'directory:organization' },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/auth/emails/InviteUserEmail', () => ({
  __esModule: true,
  default: jest.fn(() => '<email />'),
}))

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

const tenantA = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0'
const tenantB = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1'
const allowedOrgId = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2'
const forbiddenOrgId = 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3'
const foreignTenantOrgId = 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4'
const targetUserId = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5'
const actorUserId = '06060606-0606-4606-8606-060606060606'
const foreignTenantRoleId = '17171717-1717-4717-8717-171717171717'

// #5176 — `PUT /api/auth/users` and the `auth.users.update` command wrote the destination
// organization (and its tenant) without ever authorizing it. Because the role-grant check
// returns early when `roles` is omitted, an organization-limited administrator could move an
// editable user into a forbidden organization, keep its role links and set a chosen password.
// These tests pin the command-layer half of the guard so an internal command-bus caller
// cannot bypass the route.

type ActorOptions = {
  isSuperAdmin?: boolean
  organizations?: string[] | null
  systemActor?: boolean
  withActor?: boolean
}

function buildContext(options: ActorOptions = {}) {
  const updatedUser = {
    id: targetUserId,
    email: 'target@example.com',
    organizationId: allowedOrgId,
    tenantId: tenantA,
    name: null,
    passwordHash: null,
  } as unknown as User

  const em: any = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    flush: jest.fn(async () => undefined),
    remove: jest.fn(function remove(this: any) { return this }),
    persist: jest.fn(function persist(this: any) { return this }),
    nativeDelete: jest.fn(async () => 0),
    fork: jest.fn(() => em),
  }

  const updateOrmEntity = jest.fn(async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
    const entity = { ...updatedUser } as unknown as User
    opts.apply?.(entity)
    return entity
  }) as unknown as DataEngine['updateOrmEntity']

  const dataEngine = {
    updateOrmEntity,
    createOrmEntity: jest.fn(async () => updatedUser) as any,
    setCustomFields: jest.fn(async () => undefined) as DataEngine['setCustomFields'],
    emitOrmEntityEvent: (async () => undefined) as DataEngine['emitOrmEntityEvent'],
    markOrmEntityChange: jest.fn() as any,
    flushOrmEntityChanges: (async () => undefined) as DataEngine['flushOrmEntityChanges'],
  }

  const loadAcl = jest.fn(async () => ({
    isSuperAdmin: options.isSuperAdmin ?? false,
    features: options.isSuperAdmin ? ['*'] : ['auth.users.edit'],
    organizations: options.organizations === undefined ? null : options.organizations,
  }))

  const container = {
    resolve: (token: string) => {
      switch (token) {
        case 'dataEngine': return dataEngine
        case 'em': return em
        case 'rbacService': return { loadAcl, invalidateUserCache: jest.fn(async () => {}) }
        case 'cache': return { deleteByTags: jest.fn(async () => {}) }
        case 'notificationService': return { create: jest.fn(async () => ({})) }
        default: throw new Error(`Unexpected dependency: ${token}`)
      }
    },
  }

  const ctx: CommandRuntimeContext = {
    container: container as any,
    auth: options.withActor === false
      ? null
      : ({ sub: actorUserId, tenantId: tenantA, orgId: allowedOrgId, isSuperAdmin: options.isSuperAdmin ?? false } as any),
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined as any,
    ...(options.systemActor ? { systemActor: true } : {}),
  }

  return { em, dataEngine, loadAcl, ctx }
}

function mockRepository(options: { roleLinks?: unknown[] } = {}) {
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: { id?: string }) => {
    if (entity === Organization) {
      if (where?.id === allowedOrgId) return { id: allowedOrgId, tenant: { id: tenantA } }
      if (where?.id === forbiddenOrgId) return { id: forbiddenOrgId, tenant: { id: tenantA } }
      if (where?.id === foreignTenantOrgId) return { id: foreignTenantOrgId, tenant: { id: tenantB } }
      return null
    }
    if (entity === User) {
      if (where?.id === targetUserId) return { id: targetUserId, tenantId: tenantA, organizationId: allowedOrgId, deletedAt: null }
      return null
    }
    return null
  })
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === UserRole) return options.roleLinks ?? []
    return []
  })
}

const handler = commandRegistry.get<Record<string, unknown>, User>('auth.users.update') as CommandHandler<Record<string, unknown>, User>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('auth.users.update — destination organization authorization (#5176)', () => {
  it('rejects an organization-limited actor moving a user into a forbidden same-tenant organization', async () => {
    const { dataEngine, ctx } = buildContext({ organizations: [allowedOrgId] })
    mockRepository()

    await expect(handler.execute({
      id: targetUserId,
      organizationId: forbiddenOrgId,
      password: 'AttackerChosen123!',
    }, ctx)).rejects.toMatchObject({ status: 403 })

    expect(dataEngine.updateOrmEntity).not.toHaveBeenCalled()
  })

  it('rejects a foreign-tenant destination organization with a not-found response', async () => {
    const { dataEngine, ctx } = buildContext({ organizations: [allowedOrgId] })
    mockRepository()

    await expect(handler.execute({
      id: targetUserId,
      organizationId: foreignTenantOrgId,
    }, ctx)).rejects.toMatchObject({ status: 404 })

    expect(dataEngine.updateOrmEntity).not.toHaveBeenCalled()
  })

  it('rejects a tenant-wide actor moving a user into a foreign tenant', async () => {
    const { dataEngine, ctx } = buildContext({ organizations: null })
    mockRepository()

    await expect(handler.execute({
      id: targetUserId,
      organizationId: foreignTenantOrgId,
    }, ctx)).rejects.toMatchObject({ status: 404 })

    expect(dataEngine.updateOrmEntity).not.toHaveBeenCalled()
  })

  it('allows an organization-limited actor to move a user into an allowed organization', async () => {
    const { dataEngine, ctx } = buildContext({ organizations: [allowedOrgId] })
    mockRepository()

    const result = await handler.execute({
      id: targetUserId,
      organizationId: allowedOrgId,
    }, ctx)

    expect(result.organizationId).toBe(allowedOrgId)
    expect(dataEngine.updateOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('leaves updates that do not touch the organization unaffected', async () => {
    const { dataEngine, loadAcl, ctx } = buildContext({ organizations: [allowedOrgId] })
    mockRepository()

    await handler.execute({ id: targetUserId, name: 'Renamed' }, ctx)

    expect(dataEngine.updateOrmEntity).toHaveBeenCalledTimes(1)
    expect(loadAcl).not.toHaveBeenCalled()
  })

  it('allows a super administrator to relocate a user across tenants', async () => {
    const { dataEngine, ctx } = buildContext({ isSuperAdmin: true })
    mockRepository()

    await handler.execute({
      id: targetUserId,
      organizationId: foreignTenantOrgId,
    }, ctx)

    expect(dataEngine.updateOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('allows a system actor to relocate a user across tenants', async () => {
    const { dataEngine, ctx } = buildContext({ systemActor: true, withActor: false })
    mockRepository()

    await handler.execute({
      id: targetUserId,
      organizationId: foreignTenantOrgId,
    }, ctx)

    expect(dataEngine.updateOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('drops role links left behind in the previous tenant when a move changes the tenant', async () => {
    const { em, ctx } = buildContext({ isSuperAdmin: true })
    const staleLink = { id: 'link-1', role: { id: foreignTenantRoleId, tenantId: tenantA } }
    mockRepository({ roleLinks: [staleLink] })

    await handler.execute({
      id: targetUserId,
      organizationId: foreignTenantOrgId,
    }, ctx)

    expect(em.remove).toHaveBeenCalledWith(staleLink)
  })

  it('keeps role links when the move stays inside the same tenant', async () => {
    const { em, ctx } = buildContext({ organizations: [allowedOrgId] })
    const link = { id: 'link-1', role: { id: foreignTenantRoleId, tenantId: tenantA } }
    mockRepository({ roleLinks: [link] })

    await handler.execute({
      id: targetUserId,
      organizationId: allowedOrgId,
    }, ctx)

    expect(em.remove).not.toHaveBeenCalled()
  })
})
