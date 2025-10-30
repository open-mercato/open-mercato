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
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'

describe('auth.users.update undo custom fields', () => {
  it('restores custom field diff during undo', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.update') as CommandHandler
    expect(handler).toBeDefined()

    const setCustomFields = jest.fn(async () => {})
    const updateOrmEntity = jest.fn(async ({ apply }: any) => {
      const entity = {
        id: 'user-1',
        email: 'after@example.com',
        organizationId: 'org-after',
        tenantId: 'tenant-1',
        passwordHash: null,
        name: 'After',
        isConfirmed: true,
      }
      await apply(entity as any)
      return entity
    })

    const pending: any[] = []
    const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'setCustomFields' | 'emitOrmEntityEvent' | 'markOrmEntityChange' | 'flushOrmEntityChanges'> = {
      updateOrmEntity,
      setCustomFields,
      emitOrmEntityEvent: jest.fn(async () => {}),
      markOrmEntityChange: jest.fn((entry: any) => {
        if (!entry || !entry.entity) return
        pending.push(entry)
      }),
      flushOrmEntityChanges: jest.fn(async () => {
        while (pending.length > 0) {
          const next = pending.shift()
          await dataEngine.emitOrmEntityEvent(next as any)
        }
      }),
    }

    const em: Partial<EntityManager> = {
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn(),
      persist: jest.fn(),
      flush: jest.fn(),
      nativeDelete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((_entity: any, data: any) => data),
      findOne: jest.fn().mockResolvedValue(null),
    }

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

    await handler.undo!({ logEntry, ctx })

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
