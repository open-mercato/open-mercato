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

const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn(async () => []),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
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
} {
  const em: Record<string, unknown> = {
    fork: () => em,
    findOne: async () => null,
    find: async () => [],
    count: async () => 0,
    nativeDelete: async () => 0,
    flush: async () => {},
    begin: async () => {},
    commit: async () => {},
    rollback: async () => {},
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
      if (token === 'rbacService') return { invalidateUserCache: async () => {} }
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
  return { ctx, createOrmEntity }
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
