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
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn(async () => []),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { User } from '@open-mercato/core/modules/auth/data/entities'

const orgId = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0'
const tenantId = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0'
const targetUserId = 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0'

function buildContext() {
  const createdUser = {
    id: 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0',
    email: 'new-user@example.com',
    emailHash: 'hash',
    passwordHash: 'pw',
    isConfirmed: true,
    organizationId: orgId,
    tenantId,
    name: null,
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

  const dataEngine = {
    createOrmEntity: jest.fn(async () => createdUser) as any,
    setCustomFields: jest.fn(async () => undefined) as DataEngine['setCustomFields'],
    emitOrmEntityEvent: (async () => undefined) as DataEngine['emitOrmEntityEvent'],
    markOrmEntityChange: jest.fn() as any,
    flushOrmEntityChanges: (async () => undefined) as DataEngine['flushOrmEntityChanges'],
  }

  const container = {
    resolve: (token: string) => {
      switch (token) {
        case 'dataEngine': return dataEngine
        case 'em': return em
        case 'rbacService': return { invalidateUserCache: jest.fn(async () => {}) }
        case 'cache': return { deleteByTags: jest.fn(async () => {}) }
        case 'notificationService': return { create: jest.fn(async () => ({})) }
        default: throw new Error(`Unexpected dependency: ${token}`)
      }
    },
  }

  const ctx: CommandRuntimeContext = {
    container: container as any,
    auth: { sub: 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', tenantId, orgId } as any,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined as any,
  }

  return { em, dataEngine, ctx }
}

// Returns the where clause of the User duplicate-email lookup (the call carrying `$or`),
// distinguishing it from the plain existing-user lookup the update path also performs.
function findDuplicateCheckWhere(): Record<string, unknown> | undefined {
  const call = mockFindOneWithDecryption.mock.calls.find(
    (args) => args[1] === User && (args[2] as { $or?: unknown })?.$or !== undefined,
  )
  return call?.[2] as Record<string, unknown> | undefined
}

describe('auth.users.create — email uniqueness is scoped to the org tenant (#2934)', () => {
  const handler = commandRegistry.get<Record<string, unknown>, { user: User }>('auth.users.create') as CommandHandler<Record<string, unknown>, { user: User }>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('scopes the duplicate-email check to the target tenant and allows the create when no same-tenant match exists', async () => {
    const { dataEngine, ctx } = buildContext()
    mockFindOneWithDecryption
      .mockResolvedValueOnce({ id: orgId, tenant: { id: tenantId } }) // organization lookup
      .mockResolvedValueOnce(null) // duplicate check: no live user with this email in this tenant

    await handler.execute({
      email: 'new-user@example.com',
      password: 'StrongSecret123!',
      organizationId: orgId,
    }, ctx)

    const where = findDuplicateCheckWhere()
    expect(where).toBeDefined()
    // The defect: the check used to run globally ({ tenantId: null }). It must now be scoped
    // to the org's tenant so an identical email in another tenant is invisible to it.
    expect(where).toMatchObject({ tenantId, deletedAt: null })
    expect(where!.$or).toBeDefined()
    expect(dataEngine.createOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('still rejects a duplicate email that already exists within the same tenant', async () => {
    const { ctx } = buildContext()
    mockFindOneWithDecryption
      .mockResolvedValueOnce({ id: orgId, tenant: { id: tenantId } }) // organization lookup
      .mockResolvedValueOnce({ id: 'existing-same-tenant', tenantId, email: 'dup@example.com' }) // same-tenant duplicate

    await expect(handler.execute({
      email: 'dup@example.com',
      password: 'StrongSecret123!',
      organizationId: orgId,
    }, ctx)).rejects.toMatchObject({ status: 400 })

    expect(findDuplicateCheckWhere()).toMatchObject({ tenantId })
  })
})

describe('auth.users.update — email uniqueness is scoped to the user tenant (#2934)', () => {
  const handler = commandRegistry.get<Record<string, unknown>, User>('auth.users.update') as CommandHandler<Record<string, unknown>, User>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('scopes the duplicate-email check to the user existing tenant when the organization is unchanged', async () => {
    const { ctx } = buildContext()
    mockFindOneWithDecryption
      .mockResolvedValueOnce({ id: targetUserId, tenantId, organizationId: orgId, deletedAt: null }) // resolveUserTenantId
      .mockResolvedValueOnce({ id: 'someone-else', tenantId }) // same-tenant duplicate → throws

    await expect(handler.execute({
      id: targetUserId,
      email: 'dup@example.com',
    }, ctx)).rejects.toMatchObject({ status: 400 })

    const where = findDuplicateCheckWhere()
    expect(where).toBeDefined()
    expect(where).toMatchObject({ tenantId, id: { $ne: targetUserId } })
  })
})
