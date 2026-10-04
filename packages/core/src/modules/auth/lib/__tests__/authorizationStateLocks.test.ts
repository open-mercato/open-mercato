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
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
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
      { id: 'role-a', deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    )
  })

  it('locks an API-key actor before every role referenced by rolesJson', async () => {
    const lockOrder: string[] = []
    const em = {
      find: jest.fn(async () => []),
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
    ])
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
})
