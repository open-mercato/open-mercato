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

jest.mock('@open-mercato/core/modules/auth/lib/authorizationStateLocks', () => ({
  lockUserRoleWriterAuthorizationState: jest.fn(async () => undefined),
}))

const mockCreateNotification = jest.fn(async () => ({}))
jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ create: mockCreateNotification }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (
    em: { findOne: (...args: unknown[]) => unknown },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.findOne(entity, where, options),
  findWithDecryption: async (
    em: { find: (...args: unknown[]) => unknown },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.find(entity, where, options),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { getTransactionLifetime } from '@open-mercato/shared/lib/commands/transaction-lifetime'
import { Role, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const oldRoleId = '44444444-4444-4444-8444-444444444444'
const newRoleId = '55555555-5555-4555-8555-555555555555'

function buildHarness() {
  const user = {
    id: userId,
    email: 'role-notifications@example.com',
    name: 'Role Notifications',
    isConfirmed: true,
    organizationId,
    tenantId,
  } as User
  const oldRole = { id: oldRoleId, name: 'old-role', tenantId, deletedAt: null } as Role
  const newRole = { id: newRoleId, name: 'new-role', tenantId, deletedAt: null } as Role
  const state = {
    userRoles: [{ id: 'old-link', user, role: oldRole, deletedAt: null }] as UserRole[],
  }
  let inTransaction = false
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === User) return user
      if (entity === Role) {
        return [oldRole, newRole].find((role) => (
          (typeof where.id !== 'string' || role.id === where.id)
          && (typeof where.name !== 'string' || role.name === where.name)
        )) ?? null
      }
      return null
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === UserRole) return [...state.userRoles]
      if (entity === Role || entity === UserAcl) return []
      return []
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({ entity, ...data })),
    persist: jest.fn((entity: Record<string, unknown>) => {
      if (entity.entity === UserRole) state.userRoles.push(entity as unknown as UserRole)
      return em
    }),
    remove: jest.fn((entity: UserRole) => {
      state.userRoles = state.userRoles.filter((link) => link !== entity)
      return em
    }),
    flush: jest.fn(async () => undefined),
    nativeDelete: jest.fn(async () => 0),
    isInTransaction: jest.fn(() => inTransaction),
    begin: jest.fn(async () => { inTransaction = true }),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
  }
  const dataEngine = {
    updateOrmEntity: jest.fn(async ({ apply }: { apply: (entity: User) => void }) => {
      apply(user)
      return user
    }),
    setCustomFields: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return dataEngine
      if (name === 'rbacService') return { invalidateUserCache: jest.fn(async () => undefined) }
      if (name === 'cache') return { deleteByTags: jest.fn(async () => undefined) }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
  const ctx: CommandRuntimeContext = {
    container: container as CommandRuntimeContext['container'],
    auth: null,
    systemActor: true,
  }

  return { ctx, em }
}

describe('auth.users.update role notifications', () => {
  const handler = commandRegistry.get<Record<string, unknown>, User>('auth.users.update') as CommandHandler<Record<string, unknown>, User>

  beforeEach(() => {
    mockCreateNotification.mockClear()
  })

  it('preserves immediate notification delivery for ordinary committed updates', async () => {
    const { ctx } = buildHarness()

    await handler.execute({ id: userId, roles: [newRoleId] }, ctx)

    expect(mockCreateNotification).toHaveBeenCalledTimes(2)
  })

  it('defers role notifications to the owning transaction commit', async () => {
    const { ctx, em } = buildHarness()

    await withAtomicFlush(em as never, [async () => {
      const transactionLifetime = getTransactionLifetime(em as never)
      await handler.execute({ id: userId, roles: [newRoleId] }, {
        ...ctx,
        transactionalEm: em as never,
        transactionLifetime: transactionLifetime!,
      })
      expect(mockCreateNotification).not.toHaveBeenCalled()
    }], { transaction: true })

    expect(mockCreateNotification).toHaveBeenCalledTimes(2)
  })

  it('suppresses role notifications when the owning transaction rolls back', async () => {
    const { ctx, em } = buildHarness()
    const rollbackError = new Error('deliberate rollback')

    await expect(withAtomicFlush(em as never, [async () => {
      const transactionLifetime = getTransactionLifetime(em as never)
      await handler.execute({ id: userId, roles: [newRoleId] }, {
        ...ctx,
        transactionalEm: em as never,
        transactionLifetime: transactionLifetime!,
      })
      expect(mockCreateNotification).not.toHaveBeenCalled()
      throw rollbackError
    }], { transaction: true })).rejects.toBe(rollbackError)

    expect(mockCreateNotification).not.toHaveBeenCalled()
  })
})
