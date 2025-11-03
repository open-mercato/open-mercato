jest.mock('@open-mercato/core/generated/entities.ids.generated', () => ({
  E: {
    auth: {
      user: 'auth:user',
      role: 'auth:role',
    },
    directory: {
      organization: 'directory:organization',
    },
  },
}), { virtual: true })

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { User } from '../../data/entities'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'

describe('auth.users.update undo custom fields', () => {
  it('restores custom field diff during undo', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.update') as CommandHandler
    expect(handler).toBeDefined()

    const setCustomFields = jest.fn(async (_opts: Parameters<DataEngine['setCustomFields']>[0]) => undefined) as jest.MockedFunction<DataEngine['setCustomFields']>
    const updateOrmEntity = (async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
      const entity = {
        id: 'user-1',
        email: 'after@example.com',
        organizationId: 'org-after',
        tenantId: 'tenant-1',
        passwordHash: null,
        name: 'After',
        isConfirmed: true,
        roles: [],
        acls: [],
        custom: { priority: 5, severity: 'critical' },
      } as unknown as User
      await (opts.apply as (current: User) => Promise<void> | void)(entity)
      return entity
    }) as DataEngine['updateOrmEntity']

    const pending: Parameters<DataEngine['emitOrmEntityEvent']>[0][] = []
    const emitOrmEntityEvent: DataEngine['emitOrmEntityEvent'] = async () => undefined
    const markOrmEntityChange: DataEngine['markOrmEntityChange'] = (entry) => {
      if (!entry?.entity) return
      pending.push(entry as Parameters<DataEngine['emitOrmEntityEvent']>[0])
    }
    const flushOrmEntityChanges: DataEngine['flushOrmEntityChanges'] = async () => {
      while (pending.length > 0) {
        const next = pending.shift()
        if (next) await emitOrmEntityEvent(next)
      }
    }
    const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'setCustomFields' | 'emitOrmEntityEvent' | 'markOrmEntityChange' | 'flushOrmEntityChanges'> = {
      updateOrmEntity,
      setCustomFields,
      emitOrmEntityEvent,
      markOrmEntityChange,
      flushOrmEntityChanges,
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

    const logEntry = {
      commandPayload: {
        undo: {
          before: {
            id: 'user-1',
            email: 'before@example.com',
            organizationId: 'org-before',
            tenantId: 'tenant-1',
            passwordHash: null,
            name: 'Before',
            isConfirmed: true,
            roles: [],
            acls: [],
            custom: { priority: 3 },
          },
          after: {
            id: 'user-1',
            email: 'after@example.com',
            organizationId: 'org-after',
            tenantId: 'tenant-1',
            passwordHash: null,
            name: 'After',
            isConfirmed: true,
            roles: [],
            acls: [],
            custom: { priority: 5, severity: 'critical' },
          },
        },
      },
    }

    await handler.undo!({ input: undefined, logEntry, ctx })

    expect(setCustomFields).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'auth:user',
      recordId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-before',
      values: { priority: 3, severity: null },
      notify: false,
    }))
  })
})
