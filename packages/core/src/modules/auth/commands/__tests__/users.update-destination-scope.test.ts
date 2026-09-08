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

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => {}),
    emitCrudUndoSideEffects: jest.fn(async () => {}),
    setCustomFieldsIfAny: jest.fn(async () => {}),
  }
})

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { Role, RoleAcl, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const organizationA = '33333333-3333-4333-8333-333333333333'
const organizationB = '44444444-4444-4444-8444-444444444444'
const foreignOrganization = '55555555-5555-4555-8555-555555555555'
const actorUserId = '66666666-6666-4666-8666-666666666666'
const targetUserId = '77777777-7777-4777-8777-777777777777'
const retainedRoleId = '88888888-8888-4888-8888-888888888888'

type ContextOptions = {
  isSuperAdmin?: boolean
  organizationIds?: string[] | null
  allowedOrganizationIds?: string[] | null
  systemActor?: boolean
}

function buildContext(options: ContextOptions = {}) {
  const em = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    flush: jest.fn(async () => undefined),
    remove: jest.fn(),
    persist: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }
  const sourceUser = {
    id: targetUserId,
    email: 'target@example.com',
    emailHash: 'hash',
    passwordHash: null,
    name: 'Target User',
    isConfirmed: true,
    tenantId: tenantA,
    organizationId: organizationA,
    deletedAt: null,
  } as unknown as User
  const updateOrmEntity = jest.fn(async (input: { apply: (entity: User) => void }) => {
    input.apply(sourceUser)
    return sourceUser
  })
  const dataEngine = {
    updateOrmEntity,
    markOrmEntityChange: jest.fn(),
  }
  const loadAcl = jest.fn(async () => ({
    isSuperAdmin: options.isSuperAdmin ?? false,
    features: ['auth.users.edit'],
    organizations: options.organizationIds ?? null,
  }))
  const rbacService = {
    loadAcl,
    invalidateUserCache: jest.fn(async () => undefined),
  }
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return dataEngine
      if (token === 'rbacService') return rbacService
      if (token === 'cache') return null
      throw new Error(`Unexpected dependency: ${token}`)
    },
  }
  const ctx: CommandRuntimeContext = {
    container: container as never,
    auth: {
      sub: actorUserId,
      tenantId: tenantA,
      orgId: organizationA,
      isSuperAdmin: options.isSuperAdmin ?? false,
    },
    organizationScope: {
      selectedId: organizationA,
      filterIds: [organizationA],
      allowedIds: options.allowedOrganizationIds === undefined
        ? options.organizationIds ?? null
        : options.allowedOrganizationIds,
      tenantId: tenantA,
    },
    selectedOrganizationId: organizationA,
    organizationIds: options.organizationIds ?? null,
    request: undefined as never,
    systemActor: options.systemActor,
  }
  return { ctx, em, updateOrmEntity }
}

function destinationOrganizationLookup(entity: unknown, where: unknown) {
  if (entity === User) {
    return { id: targetUserId, tenantId: tenantA, organizationId: organizationA, deletedAt: null }
  }
  if (entity !== Organization) return null
  const id = (where as { id?: unknown }).id
  if (id === foreignOrganization) return { id, tenant: { id: tenantB } }
  if (id === organizationA || id === organizationB) return { id, tenant: { id: tenantA } }
  return null
}

function getHandler(): CommandHandler<Record<string, unknown>, User> {
  const handler = commandRegistry.get<Record<string, unknown>, User>('auth.users.update')
  expect(handler).toBeDefined()
  return handler as CommandHandler<Record<string, unknown>, User>
}

describe('auth.users.update destination scope defense', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockImplementation(
      async (_em: unknown, entity: unknown, where: unknown) => destinationOrganizationLookup(entity, where),
    )
    mockFindWithDecryption.mockResolvedValue([])
  })

  test('allows a same-organization update when roles are omitted', async () => {
    const retainedRole = { id: retainedRoleId, tenantId: tenantA } as Role
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === UserRole) return [{ role: retainedRole }]
      return []
    })
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: unknown) => {
      if (entity === RoleAcl) {
        return { isSuperAdmin: false, featuresJson: ['api_keys.create'], organizationsJson: null }
      }
      return destinationOrganizationLookup(entity, where)
    })
    const { ctx, updateOrmEntity } = buildContext({ organizationIds: [organizationA] })

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: organizationA,
    }, ctx)).resolves.toMatchObject({ organizationId: organizationA, tenantId: tenantA })

    expect(updateOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('allows an organization-scoped actor to move a user to an allowed destination', async () => {
    const { ctx, updateOrmEntity } = buildContext({ organizationIds: [organizationA, organizationB] })

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: organizationB,
    }, ctx)).resolves.toMatchObject({ organizationId: organizationB, tenantId: tenantA })

    expect(updateOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('allows a parent-scoped actor to move a user to an allowed descendant destination', async () => {
    const { ctx, updateOrmEntity } = buildContext({
      organizationIds: [organizationA],
      allowedOrganizationIds: [organizationA, organizationB],
    })

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: organizationB,
    }, ctx)).resolves.toMatchObject({ organizationId: organizationB, tenantId: tenantA })

    expect(updateOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('rejects an omitted retained role that the actor cannot grant in the destination', async () => {
    const retainedRole = { id: retainedRoleId, tenantId: tenantA } as Role
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === UserRole) return [{ role: retainedRole }]
      return []
    })
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: unknown) => {
      if (entity === RoleAcl) {
        return { isSuperAdmin: false, featuresJson: ['api_keys.create'], organizationsJson: null }
      }
      return destinationOrganizationLookup(entity, where)
    })
    const { ctx, updateOrmEntity } = buildContext({ organizationIds: [organizationA, organizationB] })

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: organizationB,
    }, ctx)).rejects.toMatchObject({ status: 403 })

    expect(updateOrmEntity).not.toHaveBeenCalled()
  })

  test('rejects a forbidden same-tenant destination when roles are omitted', async () => {
    const { ctx, updateOrmEntity } = buildContext({ organizationIds: [organizationA] })

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: organizationB,
    }, ctx)).rejects.toMatchObject({ status: 403 })

    expect(updateOrmEntity).not.toHaveBeenCalled()
  })

  test('rejects a foreign-tenant destination when roles are omitted', async () => {
    const { ctx, updateOrmEntity } = buildContext({ organizationIds: null })

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: foreignOrganization,
    }, ctx)).rejects.toMatchObject({ status: 404 })

    expect(updateOrmEntity).not.toHaveBeenCalled()
  })

  test('rejects retaining a role from the source tenant during a superadmin cross-tenant move', async () => {
    const retainedRole = { id: retainedRoleId, tenantId: tenantA } as Role
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === UserRole) return [{ role: retainedRole }]
      return []
    })
    const { ctx, updateOrmEntity } = buildContext({ isSuperAdmin: true, organizationIds: null })

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: foreignOrganization,
    }, ctx)).rejects.toMatchObject({ status: 403 })

    expect(updateOrmEntity).not.toHaveBeenCalled()
  })

  test('allows an explicit superadmin cross-tenant move when destination roles are cleared', async () => {
    const { ctx, updateOrmEntity } = buildContext({ isSuperAdmin: true, organizationIds: null })

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: foreignOrganization,
      roles: [],
    }, ctx)).resolves.toMatchObject({ organizationId: foreignOrganization, tenantId: tenantB })

    expect(updateOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('allows an explicit system actor cross-tenant move when destination roles are cleared', async () => {
    const { ctx, updateOrmEntity } = buildContext({ systemActor: true, organizationIds: null })

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: foreignOrganization,
      roles: [],
    }, ctx)).resolves.toMatchObject({ organizationId: foreignOrganization, tenantId: tenantB })

    expect(updateOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('rolls back a destination move when role synchronization fails', async () => {
    const destinationRole = { id: retainedRoleId, name: 'Destination role', tenantId: tenantB } as Role
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: unknown) => {
      if (entity === Role) return destinationRole
      return destinationOrganizationLookup(entity, where)
    })
    const { ctx, em, updateOrmEntity } = buildContext({ isSuperAdmin: true, organizationIds: null })
    em.flush
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('role synchronization failed'))

    await expect(getHandler().execute({
      id: targetUserId,
      organizationId: foreignOrganization,
      roles: [retainedRoleId],
    }, ctx)).rejects.toThrow('role synchronization failed')

    expect(updateOrmEntity).toHaveBeenCalledTimes(1)
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })
})
