jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    auth: {
      user: 'auth:user',
      role: 'auth:role',
    },
    directory: {
      organization: 'directory:organization',
    },
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

jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: jest.fn(async () => undefined) }))

const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn(async () => []),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { emitCrudSideEffects, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const orgInTenantB = '55555555-5555-4555-8555-555555555555'
const orgInTenantA = '66666666-6666-4666-8666-666666666666'
const newUserId = '77777777-7777-4777-8777-777777777777'

type CreateOrmEntity = jest.Mock<Promise<Record<string, unknown>>, [{ entity: unknown; data: Record<string, unknown> }]>

function makeCtx(opts: { isSuperAdmin?: boolean; tenantId?: string | null; systemActor?: boolean } = {}): {
  ctx: CommandRuntimeContext
  createOrmEntity: CreateOrmEntity
  begin: jest.Mock
  commit: jest.Mock
  rollback: jest.Mock
} {
  const begin = jest.fn(async () => undefined)
  const commit = jest.fn(async () => undefined)
  const rollback = jest.fn(async () => undefined)
  const em: Record<string, unknown> = {
    fork: () => em,
    findOne: async () => null,
    find: async () => [],
    count: async () => 0,
    nativeDelete: async () => 0,
    flush: async () => {},
    begin,
    commit,
    rollback,
  }
  const createOrmEntity: CreateOrmEntity = jest.fn(async ({ data }) => ({ id: newUserId, ...data }))
  const dataEngine = {
    createOrmEntity,
    markOrmEntityChange: jest.fn(),
  }
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return dataEngine
      if (token === 'rbacService') {
        return {
          invalidateUserCache: async () => {},
          loadAcl: async () => ({ isSuperAdmin: false, features: [], organizations: null }),
        }
      }
      if (token === 'cache') return null
      throw new Error(`Unexpected dependency: ${token}`)
    },
  }
  const ctx = {
    container: container as never,
    auth: { sub: 'actor-1', tenantId: opts.tenantId === undefined ? tenantA : opts.tenantId, orgId: null, isSuperAdmin: opts.isSuperAdmin ?? false } as never,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined as never,
    systemActor: opts.systemActor,
  }
  return { ctx, createOrmEntity, begin, commit, rollback }
}

function getHandler<T = unknown>(id: string): CommandHandler<Record<string, unknown>, T> {
  const handler = commandRegistry.get<Record<string, unknown>, unknown>(id) as CommandHandler<Record<string, unknown>, T>
  expect(handler).toBeDefined()
  return handler
}

function mockOrganizationInTenant(tenantId: string): void {
  // 1st decryption read = Organization lookup; 2nd = duplicate-email check.
  mockFindOneWithDecryption
    .mockResolvedValueOnce({ id: tenantId === tenantB ? orgInTenantB : orgInTenantA, tenant: { id: tenantId } })
    .mockResolvedValueOnce(null)
}

const createInput = (organizationId: string) => ({
  email: 'x@evil.com',
  password: 'P@ssw0rd!23',
  organizationId,
})

beforeEach(() => {
  mockFindOneWithDecryption.mockReset()
  jest.mocked(sendEmail).mockClear()
  jest.mocked(emitCrudSideEffects).mockClear()
  jest.mocked(setCustomFieldsIfAny).mockClear()
})

describe('auth.users.create tenant scope', () => {
  test('rejects a non-superadmin creating a user in an organization that belongs to another tenant', async () => {
    mockOrganizationInTenant(tenantB)
    const { ctx, createOrmEntity } = makeCtx({ tenantId: tenantA })
    const handler = getHandler('auth.users.create')

    await expect(handler.execute(createInput(orgInTenantB), ctx)).rejects.toMatchObject({ status: 404 })
    expect(createOrmEntity).not.toHaveBeenCalled()
  })

  test('allows a non-superadmin creating a user in an organization within their own tenant', async () => {
    mockOrganizationInTenant(tenantA)
    const { ctx, createOrmEntity } = makeCtx({ tenantId: tenantA })
    const handler = getHandler('auth.users.create')

    await expect(handler.execute(createInput(orgInTenantA), ctx)).resolves.toBeTruthy()
    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('allows a superadmin creating a user cross-tenant', async () => {
    mockOrganizationInTenant(tenantB)
    const { ctx, createOrmEntity } = makeCtx({ isSuperAdmin: true, tenantId: tenantA })
    const handler = getHandler('auth.users.create')

    await expect(handler.execute(createInput(orgInTenantB), ctx)).resolves.toBeTruthy()
    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })

  test('does not tenant-scope a system actor', async () => {
    mockOrganizationInTenant(tenantB)
    const { ctx, createOrmEntity } = makeCtx({ systemActor: true, tenantId: tenantA })
    const handler = getHandler('auth.users.create')

    await expect(handler.execute(createInput(orgInTenantB), ctx)).resolves.toBeTruthy()
    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })
})


describe('auth.users.create transaction boundary', () => {
  test('rolls back creation and suppresses side effects when the validated role disappears', async () => {
    const roleId = '88888888-8888-4888-8888-888888888888'
    mockFindOneWithDecryption
      .mockResolvedValueOnce({ id: orgInTenantA, tenant: { id: tenantA } })
      .mockResolvedValueOnce({ id: roleId, name: 'temporary-role', tenantId: tenantA })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const { ctx, createOrmEntity, begin, commit, rollback } = makeCtx({ systemActor: true })

    await expect(getHandler('auth.users.create').execute({
      email: 'rollback@example.com',
      organizationId: orgInTenantA,
      roles: [roleId],
      sendInviteEmail: true,
    }, ctx)).rejects.toMatchObject({ status: 400 })

    expect(createOrmEntity).toHaveBeenCalledTimes(1)
    expect(begin).toHaveBeenCalledTimes(1)
    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(createOrmEntity.mock.invocationCallOrder[0])
    expect(commit).not.toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  test('commits creation without roles before publishing creation side effects', async () => {
    mockOrganizationInTenant(tenantA)
    const { ctx, createOrmEntity, begin, commit, rollback } = makeCtx({ systemActor: true })

    await getHandler('auth.users.create').execute(createInput(orgInTenantA), ctx)

    expect(begin).toHaveBeenCalledTimes(1)
    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(createOrmEntity.mock.invocationCallOrder[0])
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(emitCrudSideEffects).mock.invocationCallOrder[0])
    expect(rollback).not.toHaveBeenCalled()
  })
})
