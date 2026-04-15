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

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '../../data/entities'

describe('auth.users.update accessibility preferences', () => {
  it('merges accessibility preferences during execute', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, User>('auth.users.update') as CommandHandler
    const entity = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      email: 'user@example.com',
      organizationId: '223e4567-e89b-12d3-a456-426614174001',
      tenantId: '323e4567-e89b-12d3-a456-426614174001',
      passwordHash: null,
      name: 'User',
      isConfirmed: true,
      accessibilityPreferences: {
        fontSize: 'md',
        reducedMotion: false,
      },
    } as unknown as User

    const updateOrmEntity = jest.fn(async (options: Parameters<DataEngine['updateOrmEntity']>[0]) => {
      await options.apply(entity)
      return entity
    }) as DataEngine['updateOrmEntity']

    const pending: Parameters<DataEngine['emitOrmEntityEvent']>[0][] = []
    const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'setCustomFields' | 'emitOrmEntityEvent' | 'markOrmEntityChange' | 'flushOrmEntityChanges'> = {
      updateOrmEntity,
      setCustomFields: jest.fn(async () => undefined) as DataEngine['setCustomFields'],
      emitOrmEntityEvent: (async () => undefined) as DataEngine['emitOrmEntityEvent'],
      markOrmEntityChange: ((entry) => {
        if (!entry?.entity) return
        pending.push(entry as Parameters<DataEngine['emitOrmEntityEvent']>[0])
      }) as DataEngine['markOrmEntityChange'],
      flushOrmEntityChanges: (async () => {
        pending.length = 0
      }) as DataEngine['flushOrmEntityChanges'],
    }

    const em = {
      nativeDelete: jest.fn(async () => 0),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager

    const ctx: CommandRuntimeContext = {
      container: {
        resolve: (token: string) => {
          switch (token) {
            case 'dataEngine':
              return dataEngine
            case 'em':
              return em
            case 'rbacService':
              return { invalidateUserCache: jest.fn(async () => undefined) }
            case 'cache':
              return { deleteByTags: jest.fn(async () => undefined) }
            default:
              throw new Error(`Unexpected dependency: ${token}`)
          }
        },
      } as any,
      auth: {
        sub: '423e4567-e89b-12d3-a456-426614174001',
        tenantId: '323e4567-e89b-12d3-a456-426614174001',
        orgId: '223e4567-e89b-12d3-a456-426614174001',
      } as any,
      organizationScope: null,
      selectedOrganizationId: '223e4567-e89b-12d3-a456-426614174001',
      organizationIds: ['223e4567-e89b-12d3-a456-426614174001'],
      request: undefined as any,
    }

    const result = await handler.execute({
      id: '123e4567-e89b-12d3-a456-426614174001',
      accessibilityPreferences: {
        highContrast: true,
      },
    }, ctx)

    expect(result.accessibilityPreferences).toEqual({
      fontSize: 'md',
      reducedMotion: false,
      highContrast: true,
    })
  })

  it('restores accessibility preferences during undo', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.update') as CommandHandler
    const updateOrmEntity = jest.fn(async (options: Parameters<DataEngine['updateOrmEntity']>[0]) => {
      const current = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        email: 'after@example.com',
        organizationId: '223e4567-e89b-12d3-a456-426614174001',
        tenantId: '323e4567-e89b-12d3-a456-426614174001',
        passwordHash: null,
        name: 'After',
        isConfirmed: true,
        accessibilityPreferences: {
          highContrast: true,
          fontSize: 'xl',
          reducedMotion: true,
        },
      } as unknown as User
      await options.apply(current)
      return current
    }) as DataEngine['updateOrmEntity']

    const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'setCustomFields' | 'emitOrmEntityEvent' | 'markOrmEntityChange' | 'flushOrmEntityChanges'> = {
      updateOrmEntity,
      setCustomFields: jest.fn(async () => undefined) as DataEngine['setCustomFields'],
      emitOrmEntityEvent: (async () => undefined) as DataEngine['emitOrmEntityEvent'],
      markOrmEntityChange: jest.fn() as DataEngine['markOrmEntityChange'],
      flushOrmEntityChanges: (async () => undefined) as DataEngine['flushOrmEntityChanges'],
    }

    const em = {
      flush: jest.fn(async () => undefined),
      nativeDelete: jest.fn(async () => 0),
      find: jest.fn(async () => []),
      remove: jest.fn(),
      persist: jest.fn(),
      create: jest.fn((_entity: unknown, data: unknown) => data),
    } as unknown as EntityManager

    const ctx: CommandRuntimeContext = {
      container: {
        resolve: (token: string) => {
          switch (token) {
            case 'dataEngine':
              return dataEngine
            case 'em':
              return em
            case 'rbacService':
              return { invalidateUserCache: jest.fn(async () => undefined) }
            case 'cache':
              return { deleteByTags: jest.fn(async () => undefined) }
            default:
              throw new Error(`Unexpected dependency: ${token}`)
          }
        },
      } as any,
      auth: {
        sub: '423e4567-e89b-12d3-a456-426614174001',
        tenantId: '323e4567-e89b-12d3-a456-426614174001',
        orgId: '223e4567-e89b-12d3-a456-426614174001',
      } as any,
      organizationScope: null,
      selectedOrganizationId: '223e4567-e89b-12d3-a456-426614174001',
      organizationIds: ['223e4567-e89b-12d3-a456-426614174001'],
      request: undefined as any,
    }

    await handler.undo!({
      input: undefined,
      ctx,
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: '123e4567-e89b-12d3-a456-426614174001',
              email: 'before@example.com',
              organizationId: '223e4567-e89b-12d3-a456-426614174001',
              tenantId: '323e4567-e89b-12d3-a456-426614174001',
              passwordHash: null,
              name: 'Before',
              isConfirmed: true,
              accessibilityPreferences: {
                highContrast: false,
                fontSize: 'sm',
                reducedMotion: false,
              },
              roles: [],
              acls: [],
            },
            after: {
              id: '123e4567-e89b-12d3-a456-426614174001',
              email: 'after@example.com',
              organizationId: '223e4567-e89b-12d3-a456-426614174001',
              tenantId: '323e4567-e89b-12d3-a456-426614174001',
              passwordHash: null,
              name: 'After',
              isConfirmed: true,
              accessibilityPreferences: {
                highContrast: true,
                fontSize: 'xl',
                reducedMotion: true,
              },
              roles: [],
              acls: [],
            },
          },
        },
      } as any,
    })

    expect(updateOrmEntity).toHaveBeenCalled()
    const updated = await updateOrmEntity.mock.results[0]?.value
    expect(updated.accessibilityPreferences).toEqual({
      highContrast: false,
      fontSize: 'sm',
      reducedMotion: false,
    })
  })
})
