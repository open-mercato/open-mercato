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
import '@open-mercato/core/modules/auth/commands/roles'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const roleId = '44444444-4444-4444-8444-444444444444'

function makeCtx(opts: { isSuperAdmin?: boolean; tenantId?: string | null; systemActor?: boolean } = {}): CommandRuntimeContext {
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
  const dataEngine = {
    updateOrmEntity: jest.fn(async () => ({ id: userId, tenantId: tenantA, organizationId: null })),
    deleteOrmEntity: jest.fn(async () => ({ id: userId, tenantId: tenantA, organizationId: null })),
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
  return {
    container: container as never,
    auth: { sub: 'actor-1', tenantId: opts.tenantId === undefined ? tenantA : opts.tenantId, orgId: null, isSuperAdmin: opts.isSuperAdmin ?? false } as never,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined as never,
    systemActor: opts.systemActor,
  }
}

function getHandler<T = unknown>(id: string): CommandHandler<Record<string, unknown>, T> {
  const handler = commandRegistry.get<Record<string, unknown>, unknown>(id) as CommandHandler<Record<string, unknown>, T>
  expect(handler).toBeDefined()
  return handler
}

beforeEach(() => {
  mockFindOneWithDecryption.mockReset()
})

describe('auth.users command tenant defense-in-depth', () => {
  test('update prepare 404s for a non-superadmin acting on a foreign-tenant user', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: userId, tenantId: tenantB, organizationId: null })
    const handler = getHandler('auth.users.update')
    await expect(handler.prepare!({ id: userId, name: 'X' }, makeCtx())).rejects.toMatchObject({ status: 404 })
  })

  test('update prepare succeeds for a same-tenant user', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: userId, tenantId: tenantA, organizationId: null })
    const handler = getHandler('auth.users.update')
    await expect(handler.prepare!({ id: userId, name: 'X' }, makeCtx())).resolves.toBeTruthy()
  })

  test('update prepare allows a superadmin acting cross-tenant', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: userId, tenantId: tenantB, organizationId: null })
    const handler = getHandler('auth.users.update')
    await expect(handler.prepare!({ id: userId, name: 'X' }, makeCtx({ isSuperAdmin: true, tenantId: tenantB }))).resolves.toBeTruthy()
  })
})

describe('auth.roles command tenant defense-in-depth', () => {
  test('update prepare 404s for a non-superadmin acting on a foreign-tenant role', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: roleId, tenantId: tenantB })
    const handler = getHandler('auth.roles.update')
    await expect(handler.prepare!({ id: roleId, name: 'Updated Role' }, makeCtx())).rejects.toMatchObject({ status: 404 })
  })

  test('update prepare 404s for a non-superadmin acting on a null-tenant role', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: roleId, tenantId: null })
    const handler = getHandler('auth.roles.update')
    await expect(handler.prepare!({ id: roleId, name: 'Updated Role' }, makeCtx())).rejects.toMatchObject({ status: 404 })
  })

  test('update prepare succeeds for a same-tenant role', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: roleId, tenantId: tenantA })
    const handler = getHandler('auth.roles.update')
    await expect(handler.prepare!({ id: roleId, name: 'Updated Role' }, makeCtx())).resolves.toBeTruthy()
  })

  test('systemActor invocation is not tenant-scoped', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: roleId, tenantId: tenantB })
    const handler = getHandler('auth.roles.update')
    await expect(handler.prepare!({ id: roleId, name: 'Updated Role' }, makeCtx({ systemActor: true, tenantId: tenantA }))).resolves.toBeTruthy()
  })
})
