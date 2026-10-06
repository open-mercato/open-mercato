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

import { LockMode } from '@mikro-orm/core'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { lockRoleWriterAuthorizationState } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { lockReplayAuthorizationState } from '@open-mercato/core/modules/auth/lib/commandReplay'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'

function withTransactionMethods<T extends object>(em: T): T & {
  begin: jest.Mock
  commit: jest.Mock
  rollback: jest.Mock
  flush: jest.Mock
  isInTransaction: () => boolean
} {
  let inTransaction = false
  return Object.assign(em, {
    begin: jest.fn(async () => { inTransaction = true }),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
    flush: jest.fn(async () => undefined),
    isInTransaction: () => inTransaction,
  })
}

async function inTransaction(em: object, phase: () => Promise<void>): Promise<void> {
  await withAtomicFlush(em as never, [phase], { transaction: true })
}

type LockQueryOptions = { lockMode?: LockMode }
type LockWhere = { id?: string | { $in?: string[] }; $and?: unknown; $or?: unknown }

function lockedIds(where: LockWhere): string {
  if (typeof where?.id === 'string') return where.id
  return (where?.id?.$in ?? []).join(',')
}

function entityLabel(entity: unknown): string {
  if (entity === ApiKey) return 'key'
  if (entity === Role) return 'role'
  if (entity === User) return 'user'
  if (entity === Tenant) return 'tenant'
  if (entity === Organization) return 'organization'
  if (entity === UserRole) return 'user-role'
  if (entity === UserAcl) return 'user-acl'
  if (entity === RoleAcl) return 'role-acl'
  return 'unknown'
}

function isReferenceScan(entity: unknown, where: LockWhere, options?: LockQueryOptions): boolean {
  return entity === ApiKey && Array.isArray(where?.$and) && !options?.lockMode
}

describe('authorization state lock ordering', () => {
  it('locks referencing API-key parents before role parents with one ordered query per kind', async () => {
    const lockOrder: string[] = []
    const em = withTransactionMethods({
      find: jest.fn(async (entity: unknown, where: LockWhere, options?: LockQueryOptions) => {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          lockOrder.push(`${entityLabel(entity)}:${lockedIds(where)}`)
          const ids = typeof where.id === 'object' ? where.id.$in ?? [] : []
          return ids.map((id) => ({ id }))
        }
        if (isReferenceScan(entity, where, options)) return [{ id: 'key-b' }, { id: 'key-a' }]
        return []
      }),
      findOne: jest.fn(async () => null),
    })

    await lockRoleWriterAuthorizationState(em as never, ['role-b', 'role-a', 'role-b'])

    expect(lockOrder).toEqual([
      'key:key-a,key-b',
      'role:role-a,role-b',
      'role-acl:',
    ])
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.find).toHaveBeenCalledWith(
      ApiKey,
      {
        deletedAt: null,
        $and: [
          {
            $or: [
              { rolesJson: { $contains: ['role-a'] } },
              { rolesJson: { $contains: ['role-b'] } },
            ],
          },
          { $or: [{ expiresAt: null }, { expiresAt: { $gt: expect.any(Date) } }] },
        ],
      },
      { orderBy: { id: 'ASC' } },
    )
    expect(em.find).toHaveBeenCalledWith(
      Role,
      { id: { $in: ['role-a', 'role-b'] } },
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
    )
  })

  it('locks an API-key actor before every role referenced by rolesJson', async () => {
    const lockOrder: string[] = []
    const em = withTransactionMethods({
      find: jest.fn(async (entity: unknown, where: LockWhere, options?: LockQueryOptions) => {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          lockOrder.push(`${entityLabel(entity)}:${lockedIds(where)}`)
        }
        if (entity === ApiKey && typeof where?.id === 'object') {
          return [{ id: 'key-actor', rolesJson: ['role-b', 'role-a'] }]
        }
        return []
      }),
      findOne: jest.fn(async (entity: unknown, where: LockWhere, options?: LockQueryOptions) => {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          lockOrder.push(`${entityLabel(entity)}:${lockedIds(where)}`)
        }
        return { id: where.id }
      }),
    })

    await inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'api_key:key-actor', tenantId: 'tenant-1', orgId: null } },
      {},
    ))

    expect(lockOrder).toEqual([
      'key:key-actor',
      'role:role-a,role-b',
      'tenant:tenant-1',
      'organization:',
      'role-acl:',
    ])
    expect(em.findOne).toHaveBeenCalledWith(
      Tenant,
      { id: 'tenant-1' },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    )
    expect(em.find).toHaveBeenCalledWith(
      Organization,
      { tenant: 'tenant-1', deletedAt: null },
      {
        lockMode: LockMode.PESSIMISTIC_WRITE,
        orderBy: { id: 'ASC' },
        refresh: true,
      },
    )
  })

  it('rejects a membership phantom instead of appending earlier-rank locks', async () => {
    let userRoleRead = 0
    const em = withTransactionMethods({
      find: jest.fn(async (entity: unknown) => {
        if (entity === UserRole) {
          userRoleRead += 1
          return userRoleRead === 1
            ? []
            : [{ id: 'link-1', user: { id: 'user-a' }, role: { id: 'role-a' } }]
        }
        return []
      }),
      findOne: jest.fn(async (_entity: unknown, where: { id?: string }) => ({ id: where.id })),
    })

    await expect(inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'user-a', tenantId: null, orgId: null } },
      {},
    ))).rejects.toMatchObject({ status: 409 })
  })

  it('adds an API key referencing a locked role that committed during lock acquisition to the lock set', async () => {
    let referenceRead = 0
    const lockCalls: Array<{ label: string; lockMode?: LockMode }> = []
    const em = withTransactionMethods({
      find: jest.fn(async (entity: unknown, where: LockWhere, options?: LockQueryOptions) => {
        if (options?.lockMode) {
          lockCalls.push({ label: `${entityLabel(entity)}:${lockedIds(where)}`, lockMode: options.lockMode })
          const ids = typeof where.id === 'object' ? where.id.$in ?? [] : []
          return ids.map((id) => ({ id, rolesJson: ['role-a'] }))
        }
        if (isReferenceScan(entity, where, options)) {
          referenceRead += 1
          return referenceRead === 1 ? [] : [{ id: 'inserted-key', rolesJson: ['role-a'] }]
        }
        return []
      }),
      findOne: jest.fn(async (_entity: unknown, where: { id?: string }) => ({ id: where.id })),
    })

    await expect(inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: null },
      { targetRoleId: 'role-a' },
    ))).resolves.toBeUndefined()

    expect(lockCalls.filter((call) => call.label !== 'role-acl:')).toEqual([
      { label: 'role:role-a', lockMode: LockMode.PESSIMISTIC_WRITE },
      { label: 'key:inserted-key', lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE },
    ])
  })

  it('rejects a late referencing API key that another transaction already holds instead of waiting out of order', async () => {
    let referenceRead = 0
    const em = withTransactionMethods({
      find: jest.fn(async (entity: unknown, where: LockWhere, options?: LockQueryOptions) => {
        if (entity === ApiKey && options?.lockMode === LockMode.PESSIMISTIC_PARTIAL_WRITE) return []
        if (options?.lockMode) {
          const ids = typeof where.id === 'object' ? where.id.$in ?? [] : []
          return ids.map((id) => ({ id }))
        }
        if (isReferenceScan(entity, where, options)) {
          referenceRead += 1
          return referenceRead === 1 ? [] : [{ id: 'contended-key', rolesJson: ['role-a'] }]
        }
        return []
      }),
      findOne: jest.fn(async (_entity: unknown, where: { id?: string }) => ({ id: where.id })),
    })

    await expect(inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: null },
      { targetRoleId: 'role-a' },
    ))).rejects.toMatchObject({ status: 409 })
  })

  it('allows a removed API-key role reference to reach the post-lock authorization check', async () => {
    let referenceRead = 0
    const em = withTransactionMethods({
      find: jest.fn(async (entity: unknown, where: LockWhere, options?: LockQueryOptions) => {
        if (isReferenceScan(entity, where, options)) {
          referenceRead += 1
          return referenceRead === 1 ? [{ id: 'removed-key', rolesJson: ['role-a'] }] : []
        }
        return []
      }),
      findOne: jest.fn(async (_entity: unknown, where: { id?: string }) => ({ id: where.id })),
    })

    await expect(inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: null },
      { targetRoleId: 'role-a' },
    ))).resolves.toBeUndefined()
  })

  it('rejects any late target outside a sealed replay footprint', async () => {
    const em = withTransactionMethods({
      find: jest.fn(async () => []),
      findOne: jest.fn(async (_entity: unknown, where: { id?: string }) => ({ id: where.id })),
    })
    await expect(inTransaction(em, async () => {
      await lockReplayAuthorizationState(
        em as never,
        { auth: { sub: 'user-a', tenantId: null, orgId: null } },
        { targetUserId: 'user-b' },
      )
      await lockRoleWriterAuthorizationState(em as never, ['role-late'])
    })).rejects.toThrow('lock footprint was extended after it was sealed')
  })

  it('releases a replay lease after commit when reusing the same EntityManager', async () => {
    const lockedUsers: string[] = []
    const em = withTransactionMethods({
      find: jest.fn(async (entity: unknown, where: LockWhere, options?: LockQueryOptions) => {
        if (entity === User && options?.lockMode === LockMode.PESSIMISTIC_WRITE) lockedUsers.push(lockedIds(where))
        return []
      }),
      findOne: jest.fn(async (_entity: unknown, where: { id?: string }) => ({ id: where.id })),
    })

    await inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'user-a', tenantId: null, orgId: null } },
      { targetUserId: 'user-b' },
    ))
    await inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'user-a', tenantId: null, orgId: null } },
      { targetUserId: 'user-b' },
    ))
    await inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'user-a', tenantId: null, orgId: null } },
      { targetUserId: 'user-c' },
    ))

    expect(lockedUsers).toEqual(['user-a,user-b', 'user-a,user-b', 'user-a,user-c'])
    expect(em.commit).toHaveBeenCalledTimes(3)
  })

  it('releases a replay lease after rollback when reusing the same EntityManager', async () => {
    const lockedUsers: string[] = []
    const em = withTransactionMethods({
      find: jest.fn(async (entity: unknown, where: LockWhere, options?: LockQueryOptions) => {
        if (entity === User && options?.lockMode === LockMode.PESSIMISTIC_WRITE) lockedUsers.push(lockedIds(where))
        return []
      }),
      findOne: jest.fn(async (_entity: unknown, where: { id?: string }) => ({ id: where.id })),
    })

    await expect(inTransaction(em, async () => {
      await lockReplayAuthorizationState(
        em as never,
        { auth: { sub: 'user-a', tenantId: null, orgId: null } },
        { targetUserId: 'user-b' },
      )
      throw new Error('force rollback')
    })).rejects.toThrow('force rollback')
    await inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'user-a', tenantId: null, orgId: null } },
      { targetUserId: 'user-b' },
    ))
    await inTransaction(em, () => lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'user-a', tenantId: null, orgId: null } },
      { targetUserId: 'user-c' },
    ))

    expect(lockedUsers).toEqual(['user-a,user-b', 'user-a,user-b', 'user-a,user-c'])
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(2)
  })
})
