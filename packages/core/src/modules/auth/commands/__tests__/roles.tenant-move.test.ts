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
import { RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import type { Role } from '@open-mercato/core/modules/auth/data/entities'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

const roleId = '11111111-1111-4111-8111-111111111111'
const tenantA = '22222222-2222-4222-8222-222222222222'
const tenantB = '33333333-3333-4333-8333-333333333333'

describe('auth.roles.update tenant move', () => {
  function getHandler() {
    const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.roles.update') as CommandHandler<Record<string, unknown>, Role>
    expect(handler).toBeDefined()
    return handler
  }

  it('rejects tenant change when users are assigned', async () => {
    const existingRole = { id: roleId, name: 'Manager', tenantId: tenantA, deletedAt: null } as unknown as Role
    const updateOrmEntity = jest.fn()
    const nativeDelete = jest.fn(async () => 0)
    const dataEngine = { updateOrmEntity, markOrmEntityChange: jest.fn() }
    const em = {
      findOne: jest.fn(async () => existingRole),
      count: jest.fn(async () => 2),
      nativeDelete,
    }
    const ctx = makeCtx(dataEngine, em)

    await expect(getHandler().execute({ id: roleId, tenantId: tenantB }, ctx))
      .rejects.toMatchObject<Partial<CrudHttpError>>({
        status: 400,
        body: { error: 'Role cannot be moved to another tenant while users are assigned' },
      })

    expect(updateOrmEntity).not.toHaveBeenCalled()
    expect(nativeDelete).not.toHaveBeenCalled()
  })

  it('clears RoleAcl rows when tenant changes and no users are assigned', async () => {
    const existingRole = { id: roleId, name: 'Manager', tenantId: tenantA, deletedAt: null } as unknown as Role
    const updateOrmEntity = jest.fn(async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
      const entity = { ...existingRole } as Role
      await (opts.apply as (current: Role) => Promise<void> | void)(entity)
      return entity
    }) as jest.MockedFunction<DataEngine['updateOrmEntity']>
    const nativeDelete = jest.fn(async () => 0)
    const dataEngine = { updateOrmEntity, markOrmEntityChange: jest.fn() }
    const em = {
      findOne: jest.fn(async () => existingRole),
      count: jest.fn(async () => 0),
      nativeDelete,
    }
    const ctx = makeCtx(dataEngine, em)

    const result = await getHandler().execute({ id: roleId, tenantId: tenantB }, ctx)

    expect(result).toMatchObject({ id: roleId, tenantId: tenantB })
    expect(nativeDelete).toHaveBeenCalledWith(RoleAcl, { role: roleId })
    expect(updateOrmEntity).toHaveBeenCalled()
  })

  it('does not clear RoleAcl rows when tenantId is unchanged', async () => {
    const existingRole = { id: roleId, name: 'Manager', tenantId: tenantA, deletedAt: null } as unknown as Role
    const updateOrmEntity = jest.fn(async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
      const entity = { ...existingRole } as Role
      await (opts.apply as (current: Role) => Promise<void> | void)(entity)
      return entity
    }) as jest.MockedFunction<DataEngine['updateOrmEntity']>
    const nativeDelete = jest.fn(async () => 0)
    const dataEngine = { updateOrmEntity, markOrmEntityChange: jest.fn() }
    const em = {
      findOne: jest.fn(async () => existingRole),
      count: jest.fn(async () => 0),
      nativeDelete,
    }
    const ctx = makeCtx(dataEngine, em)

    await getHandler().execute({ id: roleId, tenantId: tenantA, name: 'Senior Manager' }, ctx)

    expect(nativeDelete).not.toHaveBeenCalled()
    expect(em.count).toHaveBeenCalled()
  })

  it('does not run tenant-move guard when tenantId is omitted from the payload', async () => {
    const existingRole = { id: roleId, name: 'Manager', tenantId: tenantA, deletedAt: null } as unknown as Role
    const updateOrmEntity = jest.fn(async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
      const entity = { ...existingRole } as Role
      await (opts.apply as (current: Role) => Promise<void> | void)(entity)
      return entity
    }) as jest.MockedFunction<DataEngine['updateOrmEntity']>
    const nativeDelete = jest.fn(async () => 0)
    const dataEngine = { updateOrmEntity, markOrmEntityChange: jest.fn() }
    const em = {
      findOne: jest.fn(async () => existingRole),
      count: jest.fn(async () => 5),
      nativeDelete,
    }
    const ctx = makeCtx(dataEngine, em)

    await getHandler().execute({ id: roleId }, ctx)

    expect(em.count).not.toHaveBeenCalled()
    expect(nativeDelete).not.toHaveBeenCalled()
    expect(updateOrmEntity).toHaveBeenCalled()
  })
})

function makeCtx(dataEngine: object, em: object): CommandRuntimeContext {
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
    auth: { sub: 'actor-1', tenantId: tenantA, orgId: null } as any,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined as any,
  }
}
