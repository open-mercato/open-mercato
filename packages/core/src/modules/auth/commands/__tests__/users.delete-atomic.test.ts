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
import {
  User,
  UserAcl,
  UserRole,
  Session,
  PasswordReset,
  UserSidebarPreference,
  SidebarVariant,
  UserConsent,
} from '../../data/entities'

/**
 * Regression coverage for issue #2339 — the auth.users.delete cascade deleted
 * UserAcl/UserRole/Session/PasswordReset rows and then the user across five
 * sequential statements with no enclosing transaction. The cascade later grew
 * UserSidebarPreference/SidebarVariant/UserConsent so a customised sidebar no
 * longer trips the `users` FK and turns the delete into a 500. A failure mid-cascade
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
    nativeDeleteArgs: Array<[unknown, Record<string, unknown>]>
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
      nativeDelete: async (entity: unknown, where: Record<string, unknown>) => {
        calls.nativeDelete += 1
        calls.nativeDeleteArgs.push([entity, where])
        return 0
      },
      find: async () => [],
      findOne: async (entity: unknown) => (entity === User
        ? { id: userId, organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null }
        : null),
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

  // Every table with a foreign key to `users` must be cleared before the user row
  // goes, in this order. `user_consents` is deliberately NOT here: it has no FK, so
  // it never blocks the delete, and it is compliance evidence that the command's
  // undo cannot restore. Consent erasure belongs to a dedicated GDPR path.
  function expectedCascade(id: string): Array<[unknown, Record<string, unknown>]> {
    return [
      [UserAcl, { user: id }],
      [UserRole, { user: id }],
      [Session, { user: id }],
      [PasswordReset, { user: id }],
      [UserSidebarPreference, { user: id }],
      [SidebarVariant, { user: id }],
    ]
  }

  it('commits after every cascade delete succeeds', async () => {
    const handler = commandRegistry.get('auth.users.delete') as CommandHandler<{ query?: Record<string, unknown> }, unknown>
    const calls: TxnCalls = { begin: 0, commit: 0, rollback: 0, flush: 0, nativeDelete: 0, nativeDeleteArgs: [] }
    const em = makeEm(calls)
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => ({ id: userId, organizationId: 'org-1', tenantId: 'tenant-1' })),
    }

    await handler.execute({ query: { id: userId } }, makeCtx(em, dataEngine))

    expect(calls.begin).toBe(1)
    expect(calls.commit).toBe(1)
    expect(calls.rollback).toBe(0)
    expect(calls.nativeDelete).toBe(6)
    expect(calls.nativeDeleteArgs).toEqual(expectedCascade(userId))
    expect(calls.nativeDeleteArgs.map(([entity]) => entity)).not.toContain(UserConsent)
    expect(dataEngine.deleteOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('undoing a create clears the same dependent rows before hard-deleting the user', async () => {
    const handler = commandRegistry.get('auth.users.create') as CommandHandler<unknown, unknown>
    const calls: TxnCalls = { begin: 0, commit: 0, rollback: 0, flush: 0, nativeDelete: 0, nativeDeleteArgs: [] }
    const em = makeEm(calls)
    const dataEngine = {
      deleteOrmEntity: jest.fn(async () => ({ id: userId, organizationId: 'org-1', tenantId: 'tenant-1' })),
    }

    await handler.undo!({
      logEntry: {
        resourceId: userId,
        snapshotAfter: { id: userId, tenantId: 'tenant-1', organizationId: 'org-1', custom: {} },
      } as any,
      ctx: makeCtx(em, dataEngine),
    })

    expect(calls.begin).toBe(1)
    expect(calls.commit).toBe(1)
    expect(calls.rollback).toBe(0)
    expect(calls.nativeDeleteArgs).toEqual(expectedCascade(userId))
    expect(calls.nativeDeleteArgs.map(([entity]) => entity)).not.toContain(UserConsent)
    expect(dataEngine.deleteOrmEntity).toHaveBeenCalledTimes(1)
    expect(dataEngine.deleteOrmEntity).toHaveBeenCalledWith(expect.objectContaining({ entity: User, soft: false }))
  })

  it('rolls back the whole cascade when the user delete fails', async () => {
    const handler = commandRegistry.get('auth.users.delete') as CommandHandler<{ query?: Record<string, unknown> }, unknown>
    const calls: TxnCalls = { begin: 0, commit: 0, rollback: 0, flush: 0, nativeDelete: 0, nativeDeleteArgs: [] }
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
    // All six dependent-row deletes were attempted inside the transaction
    // before the failing user delete, and are rolled back together.
    expect(calls.nativeDelete).toBe(6)
  })
})
