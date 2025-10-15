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

import '@open-mercato/core/modules/auth/commands/roles'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'

describe('auth.roles.update undo custom fields', () => {
  it('restores custom field diff', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.roles.update') as CommandHandler
    expect(handler).toBeDefined()

    const setCustomFields = jest.fn(async () => {})
    const updateOrmEntity = jest.fn(async ({ apply }: any) => {
      const entity = {
        id: 'role-1',
        name: 'After Role',
        tenantId: 'tenant-1',
      }
      await apply(entity as any)
      return entity
    })

    const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'setCustomFields'> = {
      updateOrmEntity,
      setCustomFields,
    }

    const em: Partial<EntityManager> = {
      nativeDelete: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn(),
      getReference: jest.fn(() => ({})),
      create: jest.fn((_entity: any, data: any) => data),
      persist: jest.fn(),
    }

    const container = {
      resolve: (token: string) => {
        switch (token) {
          case 'dataEngine':
            return dataEngine
          case 'em':
            return em
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
            id: 'role-1',
            name: 'Before Role',
            tenantId: 'tenant-1',
            acls: [],
            custom: { dashboard: true },
          },
          after: {
            id: 'role-1',
            name: 'After Role',
            tenantId: 'tenant-1',
            acls: [],
            custom: { dashboard: false, scope: 'limited' },
          },
        },
      },
    }

    await handler.undo!({ logEntry, ctx })

    expect(setCustomFields).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'auth:role',
      recordId: 'role-1',
      tenantId: 'tenant-1',
      organizationId: null,
      values: { dashboard: true, scope: null },
      notify: false,
    }))
  })
})
