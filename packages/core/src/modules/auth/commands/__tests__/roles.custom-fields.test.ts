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
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { Role } from '../../data/entities'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'

const roleId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'

describe('auth.roles.update', () => {
  it('allows updating the built-in admin role when the name is unchanged', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.roles.update') as CommandHandler<Record<string, unknown>, Role>
    expect(handler).toBeDefined()

    const existingRole = {
      id: roleId,
      name: 'admin',
      tenantId,
      deletedAt: null,
    } as unknown as Role
    const updateOrmEntity = jest.fn(async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
      const entity = { ...existingRole } as Role
      await (opts.apply as (current: Role) => Promise<void> | void)(entity)
      return entity
    }) as jest.MockedFunction<DataEngine['updateOrmEntity']>
    const markOrmEntityChange = jest.fn()
    const dataEngine = {
      updateOrmEntity,
      markOrmEntityChange,
    }
    const em = {
      findOne: jest.fn(async () => existingRole),
      count: jest.fn(async () => 0),
    }
    const ctx = makeExecuteCtx(dataEngine, em)

    const result = await handler.execute({ id: roleId, name: 'admin' }, ctx)

    expect(result).toMatchObject({ id: roleId, name: 'admin', tenantId })
    expect(em.count).not.toHaveBeenCalled()
    expect(updateOrmEntity).toHaveBeenCalled()
    expect(markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'updated',
      identifiers: expect.objectContaining({ id: roleId, tenantId }),
    }))
  })

  it('rejects renaming a custom role to a reserved role name', async () => {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.roles.update') as CommandHandler<Record<string, unknown>, Role>
    expect(handler).toBeDefined()

    const existingRole = {
      id: roleId,
      name: 'Manager',
      tenantId,
      deletedAt: null,
    } as unknown as Role
    const dataEngine = {
      updateOrmEntity: jest.fn(),
      markOrmEntityChange: jest.fn(),
    }
    const em = {
      findOne: jest.fn(async () => existingRole),
      count: jest.fn(async () => 0),
    }
    const ctx = makeExecuteCtx(dataEngine, em)

    await expect(handler.execute({ id: roleId, name: 'admin' }, ctx))
      .rejects.toMatchObject<Partial<CrudHttpError>>({
        status: 400,
        body: { error: 'Role name is reserved' },
      })
    expect(dataEngine.updateOrmEntity).not.toHaveBeenCalled()
  })

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

function makeExecuteCtx(dataEngine: object, em: object): CommandRuntimeContext {
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

  return {
    container: container as any,
    auth: { sub: 'actor-1', tenantId, orgId: null } as any,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined as any,
  }
}
