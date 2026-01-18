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

import '@open-mercato/core/modules/auth/commands/roles'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { Role } from '../../data/entities'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'

describe('auth.roles.update undo custom fields', () => {
  it('restores custom field diff', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.roles.update') as CommandHandler
    expect(handler).toBeDefined()

    const setCustomFields = jest.fn(async (_opts: Parameters<DataEngine['setCustomFields']>[0]) => undefined) as jest.MockedFunction<DataEngine['setCustomFields']>
    const updateOrmEntity = (async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
      const entity = {
        id: 'role-1',
        name: 'After Role',
        tenantId: 'tenant-1',
        acls: [],
        custom: { dashboard: false, scope: 'limited' },
      } as unknown as Role
      await (opts.apply as (current: Role) => Promise<void> | void)(entity)
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
      nativeDelete: async () => 0,
      flush: async () => undefined,
      getReference: () => ({}),
      create: (_entity: unknown, data: unknown) => data,
      persist: () => undefined,
    } as unknown as EntityManager

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

    await handler.undo!({ input: undefined, logEntry, ctx })

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
