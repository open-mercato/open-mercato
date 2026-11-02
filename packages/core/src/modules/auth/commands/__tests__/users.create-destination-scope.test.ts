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
import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const organizationA = '33333333-3333-4333-8333-333333333333'
const organizationB = '44444444-4444-4444-8444-444444444444'
const foreignOrganization = '55555555-5555-4555-8555-555555555555'
const actorUserId = '66666666-6666-4666-8666-666666666666'
const newUserId = '77777777-7777-4777-8777-777777777777'
const grantableRoleId = '88888888-8888-4888-8888-888888888888'

type ContextOptions = {
  isSuperAdmin?: boolean
  organizationIds?: string[] | null
  allowedOrganizationIds?: string[] | null
  systemActor?: boolean
}

function buildContext(options: ContextOptions = {}) {
  const em: Record<string, unknown> = {
    fork: () => em,
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }
  const createOrmEntity = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: newUserId, ...data }))
  const dataEngine = { createOrmEntity, markOrmEntityChange: jest.fn() }
  const loadAcl = jest.fn(async () => ({
    isSuperAdmin: options.isSuperAdmin ?? false,
    features: ['auth.users.create', 'auth.users.list'],
    organizations: options.organizationIds ?? null,
  }))
  const rbacService = { loadAcl, invalidateUserCache: jest.fn(async () => undefined) }
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
  return { ctx, createOrmEntity, loadAcl }
}

function lookup(entity: unknown, where: unknown) {
  const id = (where as { id?: unknown }).id
  if (entity === Organization) {
    if (id === foreignOrganization) return { id, tenant: { id: tenantB } }
    if (id === organizationA || id === organizationB) return { id, tenant: { id: tenantA } }
    return null
  }
  if (entity === Role && id === grantableRoleId) return { id: grantableRoleId, tenantId: tenantA }
  if (entity === RoleAcl) return { isSuperAdmin: false, featuresJson: ['auth.users.list'], organizationsJson: [organizationA] }
  return null
}

function getHandler(): CommandHandler<Record<string, unknown>, unknown> {
  const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.create')
  expect(handler).toBeDefined()
  return handler as CommandHandler<Record<string, unknown>, unknown>
}

const createInput = (organizationId: string, roles?: string[]) => ({
  email: 'new.user@example.com',
  password: 'P@ssw0rd!23',
  organizationId,
  ...(roles ? { roles } : {}),
})

describe('auth.users.create destination organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockImplementation(
      async (_em: unknown, entity: unknown, where: unknown) => lookup(entity, where),
    )
    mockFindWithDecryption.mockResolvedValue([])
  })

  test('allows an organization-scoped actor to create a user in its own organization', async () => {
    const { ctx, createOrmEntity } = buildContext({ organizationIds: [organizationA] })

    await expect(getHandler().execute(createInput(organizationA), ctx)).resolves.toBeTruthy()

    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('allows a parent-scoped actor to create a user in a descendant organization', async () => {
    const { ctx, createOrmEntity } = buildContext({
      organizationIds: [organizationA],
      allowedOrganizationIds: [organizationA, organizationB],
    })

    await expect(getHandler().execute(createInput(organizationB), ctx)).resolves.toBeTruthy()

    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('rejects a same-tenant organization outside the actor scope when roles are omitted', async () => {
    const { ctx, createOrmEntity } = buildContext({ organizationIds: [organizationA] })

    await expect(getHandler().execute(createInput(organizationB), ctx)).rejects.toMatchObject({
      status: 403,
      body: { error: 'Cannot assign user to a destination organization outside actor scope.' },
    })

    expect(createOrmEntity).not.toHaveBeenCalled()
  })

  test('rejects a same-tenant organization outside the actor scope when grantable roles are sent', async () => {
    const { ctx, createOrmEntity } = buildContext({ organizationIds: [organizationA] })

    await expect(getHandler().execute(createInput(organizationB, [grantableRoleId]), ctx)).rejects.toMatchObject({
      status: 403,
      body: { error: 'Cannot assign user to a destination organization outside actor scope.' },
    })

    expect(createOrmEntity).not.toHaveBeenCalled()
  })

  test('allows an actor without an organization restriction to create a user in any organization of its tenant', async () => {
    const { ctx, createOrmEntity } = buildContext({ organizationIds: null })

    await expect(getHandler().execute(createInput(organizationB), ctx)).resolves.toBeTruthy()

    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('resolves the actor scope itself when the request scope belongs to another tenant', async () => {
    const { ctx, createOrmEntity, loadAcl } = buildContext({ organizationIds: [organizationA] })
    ctx.organizationScope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: tenantB }

    await expect(getHandler().execute(createInput(organizationB), ctx)).rejects.toMatchObject({ status: 403 })

    expect(loadAcl).toHaveBeenCalledWith(actorUserId, expect.objectContaining({ tenantId: tenantA }))
    expect(createOrmEntity).not.toHaveBeenCalled()
  })

  test('keeps answering 404 for a foreign-tenant organization', async () => {
    const { ctx, createOrmEntity } = buildContext({ organizationIds: null })

    await expect(getHandler().execute(createInput(foreignOrganization), ctx)).rejects.toMatchObject({
      status: 404,
      body: { error: 'Organization not found' },
    })

    expect(createOrmEntity).not.toHaveBeenCalled()
  })

  test('lets a superadmin create a user in any organization', async () => {
    const { ctx, createOrmEntity } = buildContext({ isSuperAdmin: true, organizationIds: [organizationA] })

    await expect(getHandler().execute(createInput(foreignOrganization), ctx)).resolves.toBeTruthy()

    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('does not organization-scope a system actor', async () => {
    const { ctx, createOrmEntity } = buildContext({ systemActor: true, organizationIds: [organizationA] })

    await expect(getHandler().execute(createInput(organizationB), ctx)).resolves.toBeTruthy()

    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })
})
