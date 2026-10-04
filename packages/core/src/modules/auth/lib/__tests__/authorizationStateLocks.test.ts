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
import { Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { lockRoleWriterAuthorizationState } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { lockReplayAuthorizationState } from '@open-mercato/core/modules/auth/lib/commandReplay'

describe('authorization state lock ordering', () => {
  it('locks referencing API-key parents before role parents in canonical id order', async () => {
    const lockOrder: string[] = []
    const em = {
      find: jest.fn(async (entity: unknown) => entity === ApiKey
        ? [{ id: 'key-b' }, { id: 'key-a' }]
        : []),
      findOne: jest.fn(async (entity: unknown, where: { id?: string }, options?: { lockMode?: LockMode }) => {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          lockOrder.push(`${entity === ApiKey ? 'key' : 'role'}:${where.id}`)
        }
        return entity === ApiKey ? { id: where.id } : { id: where.id }
      }),
    }

    await lockRoleWriterAuthorizationState(em as never, ['role-b', 'role-a', 'role-b'])

    expect(lockOrder).toEqual([
      'key:key-a',
      'key:key-b',
      'role:role-a',
      'role:role-b',
    ])
    expect(em.find).toHaveBeenCalledWith(
      ApiKey,
      {
        deletedAt: null,
        $or: [
          { rolesJson: { $contains: ['role-a'] } },
          { rolesJson: { $contains: ['role-b'] } },
        ],
      },
      { orderBy: { id: 'ASC' } },
    )
    expect(em.findOne).toHaveBeenCalledWith(
      Role,
      { id: 'role-a' },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    )
  })

  it('locks an API-key actor before every role referenced by rolesJson', async () => {
    const lockOrder: string[] = []
    const em = {
      find: jest.fn(async (entity: unknown, where: { id?: { $in?: string[] } }) => {
        if (entity === ApiKey && where?.id?.$in) {
          return [{ id: 'key-actor', rolesJson: ['role-b', 'role-a'] }]
        }
        return []
      }),
      findOne: jest.fn(async (entity: unknown, where: { id?: string }, options?: { lockMode?: LockMode }) => {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          lockOrder.push(`${entity === ApiKey ? 'key' : 'role'}:${where.id}`)
        }
        if (entity === ApiKey) {
          return { id: where.id, rolesJson: ['role-b', 'role-a'] }
        }
        if (entity === Role) return { id: where.id }
        return null
      }),
    }

    await lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'api_key:key-actor', tenantId: 'tenant-1', orgId: null } },
      {},
    )

    expect(lockOrder).toEqual([
      'key:key-actor',
      'role:role-a',
      'role:role-b',
      'role:tenant-1',
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
    const em = {
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
    }

    await expect(lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'user-a', tenantId: null, orgId: null } },
      {},
    )).rejects.toMatchObject({ status: 409 })
  })

  it('rejects any late target outside a sealed replay footprint', async () => {
    const em = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async (_entity: unknown, where: { id?: string }) => ({ id: where.id })),
    }
    await lockReplayAuthorizationState(
      em as never,
      { auth: { sub: 'user-a', tenantId: null, orgId: null } },
      { targetUserId: 'user-b' },
    )

    await expect(lockRoleWriterAuthorizationState(em as never, ['role-late']))
      .rejects.toThrow('lock footprint was extended after it was sealed')
  })
})
