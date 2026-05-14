import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '../../data/entities'

describe('auth.users.update display name clearing', () => {
  it('clears the display name when the submitted value is blank', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.update') as CommandHandler
    expect(handler).toBeDefined()

    const updateOrmEntity = jest.fn(async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
      const entity = {
        id: '523e4567-e89b-12d3-a456-426614174901',
        email: 'before@example.com',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        passwordHash: null,
        name: 'Before',
        isConfirmed: true,
        roles: [],
        acls: [],
      } as unknown as User

      await (opts.apply as (current: User) => Promise<void> | void)(entity)

      expect(entity.name).toBeNull()
      return entity
    }) as DataEngine['updateOrmEntity']

    const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'setCustomFields' | 'emitOrmEntityEvent' | 'markOrmEntityChange' | 'flushOrmEntityChanges'> = {
      updateOrmEntity,
      setCustomFields: jest.fn(async () => undefined) as DataEngine['setCustomFields'],
      emitOrmEntityEvent: (async () => undefined) as DataEngine['emitOrmEntityEvent'],
      markOrmEntityChange: jest.fn() as any,
      flushOrmEntityChanges: (async () => undefined) as DataEngine['flushOrmEntityChanges'],
    }

    const em = {
      find: async () => [],
      remove: () => undefined,
      persist: () => undefined,
      flush: async () => undefined,
      nativeDelete: async () => 0,
      create: (_entity: unknown, data: unknown) => data,
      findOne: async () => null,
    } as unknown as EntityManager

    const container = {
      resolve: (token: string) => {
        switch (token) {
          case 'dataEngine':
            return dataEngine
          case 'em':
            return em
          case 'rbacService':
            return { invalidateUserCache: jest.fn(async () => {}) }
          case 'cache':
            return { deleteByTags: jest.fn(async () => {}) }
          default:
            throw new Error(`Unexpected dependency: ${token}`)
        }
      },
    }

    const ctx: CommandRuntimeContext = {
      container: container as any,
      auth: { sub: 'actor-1', tenantId: 'tenant-1', orgId: null } as any,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
      request: undefined as any,
    }

    await handler.execute({
      id: '523e4567-e89b-12d3-a456-426614174901',
      name: '',
    }, ctx)

    expect(updateOrmEntity).toHaveBeenCalled()
  })

  it('rejects non-string display names instead of treating them as omitted', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.update') as CommandHandler
    expect(handler).toBeDefined()

    const updateOrmEntity = jest.fn()
    const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'setCustomFields' | 'emitOrmEntityEvent' | 'markOrmEntityChange' | 'flushOrmEntityChanges'> = {
      updateOrmEntity,
      setCustomFields: jest.fn(async () => undefined) as DataEngine['setCustomFields'],
      emitOrmEntityEvent: (async () => undefined) as DataEngine['emitOrmEntityEvent'],
      markOrmEntityChange: jest.fn() as any,
      flushOrmEntityChanges: (async () => undefined) as DataEngine['flushOrmEntityChanges'],
    }

    const em = {
      find: async () => [],
      remove: () => undefined,
      persist: () => undefined,
      flush: async () => undefined,
      nativeDelete: async () => 0,
      create: (_entity: unknown, data: unknown) => data,
      findOne: async () => null,
    } as unknown as EntityManager

    const container = {
      resolve: (token: string) => {
        switch (token) {
          case 'dataEngine':
            return dataEngine
          case 'em':
            return em
          case 'rbacService':
            return { invalidateUserCache: jest.fn(async () => {}) }
          case 'cache':
            return { deleteByTags: jest.fn(async () => {}) }
          default:
            throw new Error(`Unexpected dependency: ${token}`)
        }
      },
    }

    const ctx: CommandRuntimeContext = {
      container: container as any,
      auth: { sub: 'actor-1', tenantId: 'tenant-1', orgId: null } as any,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
      request: undefined as any,
    }

    await expect(handler.execute({
      id: '523e4567-e89b-12d3-a456-426614174901',
      name: 123,
    }, ctx)).rejects.toThrow()

    expect(updateOrmEntity).not.toHaveBeenCalled()
  })
})
