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

describe('auth.users protected role floor checks', () => {
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
    findOneMock.mockImplementation((entity) => {
      if (entity === User) {
        return mockUser1
      }
      return null
    })

    // find protected roles and find active holders
    findMock.mockImplementation((entity) => {
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

    findOneMock.mockImplementation((entity) => {
      if (entity === User) {
        return mockUser1
      }
      return null
    })

    findMock.mockImplementation((entity) => {
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

  it('does not count duplicate role links as distinct active holders', async () => {
    const em = makeEm()
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity) => {
      if (entity === User) return mockUser1
      return null
    })

    findMock.mockImplementation((entity) => {
      if (entity === Role) return [mockAdminRole]
      if (entity === UserRole) {
        return [
          { user: mockUser1, role: mockAdminRole },
          { user: mockUser1, role: mockAdminRole },
        ]
      }
      return []
    })

    const handler = commandRegistry.get('auth.users.delete') as CommandHandler

    await expect(handler.execute({ id: userId }, ctx)).rejects.toThrow(
      new CrudHttpError(400, { error: 'Cannot remove the last active holder of role "admin"' })
    )
  })

  it('fails to deactivate the last active admin', async () => {
    const em = makeEm()
    const dataEngine = {
      updateOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity) => {
      if (entity === User) {
        return mockUser1
      }
      return null
    })

    findMock.mockImplementation((entity) => {
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

    findOneMock.mockImplementation((entity) => {
      if (entity === User) {
        return mockUser1
      }
      if (entity === Role) {
        return mockAdminRole
      }
      return null
    })

    findMock.mockImplementation((entity) => {
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

    findOneMock.mockImplementation((entity) => {
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

    findOneMock.mockImplementation((entity) => {
      if (entity === User) return mockUser1
      return null
    })

    findMock.mockImplementation((entity) => {
      if (entity === Role) return [mockAdminRole]
      if (entity === UserRole) return [{ user: mockUser1, role: mockAdminRole }]
      return []
    })

    const handler = commandRegistry.get('auth.users.delete') as CommandHandler

    await expect(handler.execute({ id: userId }, ctx)).rejects.toThrow(CrudHttpError)

    const roleCall = findMock.mock.calls.find(call => call[0] === Role)
    expect(roleCall[2]).toEqual(
      expect.objectContaining({
        lockMode: LockMode.PESSIMISTIC_WRITE,
        orderBy: { id: 'ASC' }
      })
    )
    const userRoleCall = findMock.mock.calls.find(call => call[0] === UserRole)
    expect(userRoleCall[1]).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ tenantId }),
      })
    )
  })

  it('does not populate the user relation when counting holders', async () => {
    const em = makeEm()
    const ctx = makeCtx(em, { deleteOrmEntity: jest.fn(async () => mockUser1) })

    findOneMock.mockImplementation((entity) => (entity === User ? mockUser1 : null))
    findMock.mockImplementation((entity) => {
      if (entity === Role) return [mockAdminRole]
      if (entity === UserRole) return [{ user: mockUser1, role: mockAdminRole }]
      return []
    })

    const handler = commandRegistry.get('auth.users.delete') as CommandHandler
    await expect(handler.execute({ id: userId }, ctx)).rejects.toThrow(CrudHttpError)

    // Populating `user` would make findWithDecryption walk decryptEntityGraph over every
    // admin's encrypted email/name on each floor check — the ids alone are enough.
    const userRoleCall = findMock.mock.calls.find(call => call[0] === UserRole)
    expect(userRoleCall[2]?.populate).toBeUndefined()
  })

  it('skips the role lock entirely for an update that cannot reduce holder count', async () => {
    const em = makeEm()
    const dataEngine = {
      updateOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity) => (entity === User ? mockUser1 : null))
    findMock.mockImplementation(() => [])

    const handler = commandRegistry.get('auth.users.update') as CommandHandler
    await handler.execute({ id: userId, name: 'Renamed Admin' }, ctx)

    // A display-name edit shares this command with PUT /api/auth/profile; taking the
    // tenant-wide FOR UPDATE lock here would serialize every user edit in the tenant.
    expect(findMock.mock.calls.find(call => call[0] === Role)).toBeUndefined()
  })

  it('still locks when the update supplies a role list', async () => {
    const em = makeEm()
    const dataEngine = {
      updateOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity) => {
      if (entity === User) return mockUser1
      if (entity === Role) return mockAdminRole
      return null
    })
    findMock.mockImplementation((entity) => {
      if (entity === Role) return [mockAdminRole]
      if (entity === UserRole) return [{ user: mockUser1, role: mockAdminRole }, { user: mockUser2, role: mockAdminRole }]
      return []
    })

    const handler = commandRegistry.get('auth.users.update') as CommandHandler
    await handler.execute({ id: userId, roles: ['admin'] }, ctx)

    expect(findMock.mock.calls.find(call => call[0] === Role)).toBeDefined()
  })

  it('skips the floor entirely for a system actor', async () => {
    const em = makeEm()
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = { ...makeCtx(em, dataEngine), systemActor: true } as CommandRuntimeContext

    findOneMock.mockImplementation((entity) => (entity === User ? mockUser1 : null))
    findMock.mockImplementation((entity) => {
      if (entity === Role) return [mockAdminRole]
      if (entity === UserRole) return [{ user: mockUser1, role: mockAdminRole }]
      return []
    })

    const handler = commandRegistry.get('auth.users.delete') as CommandHandler
    await expect(handler.execute({ id: userId }, ctx)).resolves.toBe(mockUser1)
    expect(findMock.mock.calls.find(call => call[0] === Role)).toBeUndefined()
  })

  it('evaluates every protected role, not just the first', async () => {
    const secondProtectedRole = {
      id: 'e1b05934-d021-4f11-9a74-b97c2718ef55',
      name: 'billing-owner',
      tenantId,
      minActiveHolders: 1,
    } as Role
    const unprotectedRole = {
      id: 'c1b05934-d021-4f11-9a74-b97c2718ef55',
      name: 'viewer',
      tenantId,
      minActiveHolders: 0,
    } as Role

    const em = makeEm()
    const ctx = makeCtx(em, { deleteOrmEntity: jest.fn(async () => mockUser1) })

    findOneMock.mockImplementation((entity) => (entity === User ? mockUser1 : null))
    findMock.mockImplementation((entity, where) => {
      if (entity === Role) return [unprotectedRole, mockAdminRole, secondProtectedRole]
      if (entity === UserRole) {
        // admin has a spare holder; billing-owner does not — the second protected role
        // is the one that must reject.
        if ((where as { role?: string }).role === mockAdminRole.id) {
          return [{ user: mockUser1, role: mockAdminRole }, { user: mockUser2, role: mockAdminRole }]
        }
        if ((where as { role?: string }).role === secondProtectedRole.id) {
          return [{ user: mockUser1, role: secondProtectedRole }]
        }
      }
      return []
    })

    const handler = commandRegistry.get('auth.users.delete') as CommandHandler
    await expect(handler.execute({ id: userId }, ctx)).rejects.toThrow(
      new CrudHttpError(400, { error: 'Cannot remove the last active holder of role "billing-owner"' })
    )
  })

  it('rejects undoing an update that would strip the last active admin', async () => {
    const em = makeEm()
    const beginTransaction = jest.spyOn(em, 'begin')
    const dataEngine = {
      updateOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity) => {
      if (entity !== User) return null
      expect(beginTransaction).toHaveBeenCalledTimes(1)
      return mockUser1
    })
    findMock.mockImplementation((entity) => {
      if (entity === Role) return [mockAdminRole]
      if (entity === UserRole) return [{ user: mockUser1, role: mockAdminRole }]
      return []
    })

    const handler = commandRegistry.get('auth.users.update') as CommandHandler

    // Reverting to a snapshot where the user held no roles would drop the tenant to zero
    // active admins — the exact lockout the forward path already refuses.
    await expect(
      handler.undo!({
        logEntry: {
          resourceId: userId,
          commandPayload: { undo: { before: { id: userId, email: 'admin1@test.com', tenantId, organizationId: null, roles: [], isConfirmed: true, acls: [] } } },
        },
        ctx,
        undoToken: 'token',
      } as never)
    ).rejects.toThrow(
      new CrudHttpError(400, { error: 'Cannot remove the last active holder of role "admin"' })
    )
    expect(dataEngine.updateOrmEntity).not.toHaveBeenCalled()
  })

  it('rejects undoing the create of the last active admin', async () => {
    const em = makeEm()
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => mockUser1),
    }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity) => (entity === User ? mockUser1 : null))
    findMock.mockImplementation((entity) => {
      if (entity === Role) return [mockAdminRole]
      if (entity === UserRole) return [{ user: mockUser1, role: mockAdminRole }]
      return []
    })

    const handler = commandRegistry.get('auth.users.create') as CommandHandler

    await expect(
      handler.undo!({
        logEntry: {
          resourceId: userId,
          snapshotAfter: { email: 'admin1@test.com', tenantId, organizationId: null, roles: ['admin'] },
        },
        ctx,
        undoToken: 'token',
      } as never)
    ).rejects.toThrow(
      new CrudHttpError(400, { error: 'Cannot remove the last active holder of role "admin"' })
    )
    expect(dataEngine.deleteOrmEntity).not.toHaveBeenCalled()
  })

  // The create snapshot records the tenant the user was created in. If they were moved
  // afterwards, that tenant is the wrong one to evaluate: it no longer counts the user,
  // so the floor would pass and the undo would hard-delete the DESTINATION tenant's last
  // administrator. The guard must read the user's current tenant instead.
  it('evaluates create-undo against the users current tenant, not the creation snapshot', async () => {
    const movedUser = { ...mockUser1, tenantId } as User
    const originTenantId = 'a1111111-1111-1111-1111-111111111111'

    const em = makeEm()
    const beginTransaction = jest.spyOn(em, 'begin')
    const dataEngine = { deleteOrmEntity: jest.fn(async () => movedUser) }
    const ctx = makeCtx(em, dataEngine)

    findOneMock.mockImplementation((entity) => {
      if (entity !== User) return null
      expect(beginTransaction).toHaveBeenCalledTimes(1)
      return movedUser
    })
    findMock.mockImplementation((entity, where) => {
      // Only the CURRENT tenant has a protected role with the user as its last holder.
      if (entity === Role) {
        return (where as { tenantId?: string }).tenantId === tenantId ? [mockAdminRole] : []
      }
      if (entity === UserRole) return [{ user: movedUser, role: mockAdminRole }]
      return []
    })

    const handler = commandRegistry.get('auth.users.create') as CommandHandler

    await expect(
      handler.undo!({
        logEntry: {
          resourceId: userId,
          // Snapshot still points at the tenant the user was created in.
          snapshotAfter: { email: 'admin1@test.com', tenantId: originTenantId, organizationId: null, roles: ['admin'] },
        },
        ctx,
        undoToken: 'token',
      } as never)
    ).rejects.toThrow(
      new CrudHttpError(400, { error: 'Cannot remove the last active holder of role "admin"' })
    )

    const roleCall = findMock.mock.calls.find((call) => call[0] === Role)
    expect((roleCall?.[1] as { tenantId?: string })?.tenantId).toBe(tenantId)
    expect(dataEngine.deleteOrmEntity).not.toHaveBeenCalled()
  })

  it('defaults minActiveHolders to 0 on new role entities', () => {
    const role = new Role()
    expect(role.minActiveHolders).toBe(0)
  })
})
