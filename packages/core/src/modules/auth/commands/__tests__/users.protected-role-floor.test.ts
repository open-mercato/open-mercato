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
    translate: (_key: string, fallback?: string, params?: Record<string, unknown>) => {
      let msg = fallback ?? _key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          msg = msg.replace(`{${k}}`, String(v))
        }
      }
      return msg
    }
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => {}),
    emitCrudUndoSideEffects: jest.fn(async () => {}),
  }
})

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User, Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { LockMode } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

describe('auth.users.update/delete protected role floor floor checks', () => {
  let findMock: jest.Mock
  let findOneMock: jest.Mock

  beforeEach(() => {
    findMock = jest.fn()
    findOneMock = jest.fn()
  })

  function makeEm(): EntityManager {
    const em = {
      fork: () => em,
      begin: async () => {},
      commit: async () => {},
      rollback: async () => {},
      flush: async () => {},
      nativeDelete: async () => 0,
      find: findMock,
      findOne: findOneMock,
      remove: () => undefined,
      persist: () => ({ flush: async () => undefined }),
      create: (_entity: unknown, data: unknown) => data,
    } as unknown as EntityManager
    return em
  }

  function makeCtx(em: EntityManager, dataEngine: unknown, tenantScope: string | null = '33333333-3333-3333-3333-333333333333'): CommandRuntimeContext {
    const container = {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as unknown as AwilixContainer

    const auth: AuthContext = {
      sub: 'a7b05934-d021-4f11-9a74-b97c2718ef55',
      tenantId: tenantScope,
      orgId: 'e7b05934-d021-4f11-9a74-b97c2718ef55',
      isApiKey: false,
      sid: 'session-id',
      email: 'admin1@test.com',
      roles: ['admin']
    }

    return {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
  }

  const userId = 'a7b05934-d021-4f11-9a74-b97c2718ef55'
  const tenantId = '33333333-3333-3333-3333-333333333333'
  const foreignTenantId = 'f7b05934-d021-4f11-9a74-b97c2718ef55'

  const mockAdminRole = {
    id: 'd7b05934-d021-4f11-9a74-b97c2718ef55',
    name: 'admin',
    tenantId,
    minActiveHolders: 1,
  } as Role

  const mockUser1 = {
    id: 'a7b05934-d021-4f11-9a74-b97c2718ef55',
    email: 'admin1@test.com',
    tenantId,
    isConfirmed: true,
  } as User

  const mockUser2 = {
    id: 'b7b05934-d021-4f11-9a74-b97c2718ef55',
    email: 'admin2@test.com',
    tenantId,
    isConfirmed: true,
  } as User

  it('fails to delete the last active admin', async () => {
    const em = makeEm()
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    // findOne user
    findOneMock.mockImplementation((entity, where) => {
      if (entity === User) {
        return mockUser1
      }
      return null
    })

    // find protected roles and find active holders
    findMock.mockImplementation((entity, where) => {
      if (entity === Role) {
        return [mockAdminRole]
      }
      if (entity === UserRole) {
        // Only user-1 is active holder
        return [
          {
            user: mockUser1,
            role: mockAdminRole,
          },
        ]
      }
      return []
    })

    const handler = commandRegistry.get('auth.users.delete') as CommandHandler

    await expect(handler.execute({ id: userId }, ctx)).rejects.toThrow(
      new CrudHttpError(400, { error: 'Cannot remove the last active holder of role "admin"' })
    )
  })

  it('allows delete if there is another active admin', async () => {
    const em = makeEm()
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity, where) => {
      if (entity === User) {
        return mockUser1
      }
      return null
    })

    findMock.mockImplementation((entity, where) => {
      if (entity === Role) {
        return [mockAdminRole]
      }
      if (entity === UserRole) {
        // Both user-1 and user-2 are active holders
        return [
          { user: mockUser1, role: mockAdminRole },
          { user: mockUser2, role: mockAdminRole },
        ]
      }
      return []
    })

    const handler = commandRegistry.get('auth.users.delete') as CommandHandler
    const result = await handler.execute({ id: userId }, ctx)
    expect(result).toBe(mockUser1)
  })

  it('fails to deactivate the last active admin', async () => {
    const em = makeEm()
    const dataEngine = {
      updateOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity, where) => {
      if (entity === User) {
        return mockUser1
      }
      return null
    })

    findMock.mockImplementation((entity, where) => {
      if (entity === Role) {
        return [mockAdminRole]
      }
      if (entity === UserRole) {
        return [{ user: mockUser1, role: mockAdminRole }]
      }
      return []
    })

    const handler = commandRegistry.get('auth.users.update') as CommandHandler

    // Try to update isConfirmed to false
    await expect(
      handler.execute({ id: userId, isConfirmed: false }, ctx)
    ).rejects.toThrow(
      new CrudHttpError(400, { error: 'Cannot remove the last active holder of role "admin"' })
    )
  })

  it('fails to remove admin role from the last active admin', async () => {
    const em = makeEm()
    const dataEngine = {
      updateOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity, where) => {
      if (entity === User) {
        return mockUser1
      }
      if (entity === Role) {
        return mockAdminRole
      }
      return null
    })

    findMock.mockImplementation((entity, where) => {
      if (entity === Role) {
        return [mockAdminRole]
      }
      if (entity === UserRole) {
        return [{ user: mockUser1, role: mockAdminRole }]
      }
      return []
    })

    const handler = commandRegistry.get('auth.users.update') as CommandHandler

    // Try to update roles to empty list
    await expect(
      handler.execute({ id: userId, roles: [] }, ctx)
    ).rejects.toThrow(
      new CrudHttpError(400, { error: 'Cannot remove the last active holder of role "admin"' })
    )
  })

  it('fails with 404 when target user is in a different tenant (Oracle Defense)', async () => {
    const em = makeEm()
    const dataEngine = {}
    const ctx = makeCtx(em, dataEngine, foreignTenantId)

    findOneMock.mockImplementation((entity, where) => {
      if (entity === User) {
        return mockUser1
      }
      return null
    })

    const handler = commandRegistry.get('auth.users.delete') as CommandHandler

    await expect(handler.execute({ id: userId }, ctx)).rejects.toThrow(
      new CrudHttpError(404, { error: 'User not found' })
    )
  })

  it('acquires pessimistic write lock on Roles in deterministic ASC order to prevent concurrent races', async () => {
    const em = makeEm()
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity, where) => {
      if (entity === User) return mockUser1
      return null
    })

    findMock.mockImplementation((entity, where) => {
      if (entity === Role) return [mockAdminRole]
      if (entity === UserRole) return [{ user: mockUser1, role: mockAdminRole }]
      return []
    })

    const handler = commandRegistry.get('auth.users.delete') as CommandHandler

    try {
      await handler.execute({ id: userId }, ctx)
    } catch {}

    const roleCall = findMock.mock.calls.find(call => call[0] === Role)
    expect(roleCall[2]).toEqual(
      expect.objectContaining({ 
        lockMode: LockMode.PESSIMISTIC_WRITE,
        orderBy: { id: 'ASC' }
      })
    )
  })

  it('defaults minActiveHolders to 0 on new role entities', () => {
    const role = new Role()
    expect(role.minActiveHolders).toBe(0)
  })
})
