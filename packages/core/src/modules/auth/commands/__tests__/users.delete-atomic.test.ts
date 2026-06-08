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
  }
})

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Regression coverage for issue #2339 — the auth.users.delete cascade deleted
 * UserAcl/UserRole/Session/PasswordReset rows and then the user across five
 * sequential statements with no enclosing transaction. A failure mid-cascade
 * left orphaned ACL/role rows committed. The cascade now runs inside a single
 * `withAtomicFlush(..., { transaction: true })`, so a later failure rolls the
 * whole thing back.
 */
describe('auth.users.delete atomic cascade (issue #2339)', () => {
  type TxnCalls = {
    begin: number
    commit: number
    rollback: number
    flush: number
    nativeDelete: number
  }

  function makeEm(calls: TxnCalls): EntityManager {
    const em = {
      fork: () => em,
      begin: async () => {
        calls.begin += 1
      },
      commit: async () => {
        calls.commit += 1
      },
      rollback: async () => {
        calls.rollback += 1
      },
      flush: async () => {
        calls.flush += 1
      },
      nativeDelete: async () => {
        calls.nativeDelete += 1
        return 0
      },
      find: async () => [],
      findOne: async () => null,
      remove: () => undefined,
      persist: () => ({ flush: async () => undefined }),
      create: (_entity: unknown, data: unknown) => data,
    } as unknown as EntityManager
    return em
  }

  function makeCtx(em: EntityManager, dataEngine: unknown): CommandRuntimeContext {
    const container = {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        // rbacService / cache are resolved by invalidateUserCache inside a try/catch
        throw new Error(`Unexpected dependency: ${token}`)
      },
    }
    return {
      container: container as unknown as CommandRuntimeContext['container'],
      auth: { sub: 'admin-1', tenantId: 'tenant-1', orgId: 'org-1' } as any,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
      request: undefined as any,
    }
  }

  const userId = '44444444-4444-4444-4444-444444444444'

  it('commits after every cascade delete succeeds', async () => {
    const handler = commandRegistry.get('auth.users.delete') as CommandHandler<{ query?: Record<string, unknown> }, unknown>
    const calls: TxnCalls = { begin: 0, commit: 0, rollback: 0, flush: 0, nativeDelete: 0 }
    const em = makeEm(calls)
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => ({ id: userId, organizationId: 'org-1', tenantId: 'tenant-1' })),
    }

    await handler.execute({ query: { id: userId } }, makeCtx(em, dataEngine))

    expect(calls.begin).toBe(1)
    expect(calls.commit).toBe(1)
    expect(calls.rollback).toBe(0)
    expect(calls.nativeDelete).toBe(4)
    expect(dataEngine.deleteOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('rolls back the whole cascade when the user delete fails', async () => {
    const handler = commandRegistry.get('auth.users.delete') as CommandHandler<{ query?: Record<string, unknown> }, unknown>
    const calls: TxnCalls = { begin: 0, commit: 0, rollback: 0, flush: 0, nativeDelete: 0 }
    const em = makeEm(calls)
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => {
        throw new Error('db failure during user delete')
      }),
    }

    await expect(handler.execute({ query: { id: userId } }, makeCtx(em, dataEngine))).rejects.toThrow(
      'db failure during user delete',
    )

    expect(calls.begin).toBe(1)
    expect(calls.commit).toBe(0)
    expect(calls.rollback).toBe(1)
    // All four dependent-row deletes were attempted inside the transaction
    // before the failing user delete, and are rolled back together.
    expect(calls.nativeDelete).toBe(4)
  })
})
