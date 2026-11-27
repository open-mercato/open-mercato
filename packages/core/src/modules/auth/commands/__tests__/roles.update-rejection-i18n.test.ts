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

const translate = jest.fn((key: string, fallback?: string) => {
  const dict: Record<string, string> = {
    'auth.roles.errors.nameChangeBlockedByAssignments': '[translated] Role name cannot be changed while users are assigned',
    'auth.roles.errors.tenantMoveBlockedByAssignments': '[translated] Role cannot be moved to another tenant while users are assigned',
  }
  return dict[key] ?? fallback ?? key
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate }),
}))

import { createContainer, asValue, InjectionMode } from 'awilix'
import '@open-mercato/core/modules/auth/commands/roles'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { Role } from '@open-mercato/core/modules/auth/data/entities'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const roleId = '11111111-1111-4111-8111-111111111111'
const tenantA = '22222222-2222-4222-8222-222222222222'
const tenantB = '33333333-3333-4333-8333-333333333333'

function getUpdateHandler() {
  const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.roles.update') as CommandHandler<Record<string, unknown>, Role>
  expect(handler).toBeDefined()
  return handler
}

function makeCtx(
  dataEngine: object,
  em: object,
  { isSuperAdmin = false }: { isSuperAdmin?: boolean } = {},
): CommandRuntimeContext {
  const transactionEm = em as Record<string, unknown>
  if (typeof transactionEm.begin !== 'function') transactionEm.begin = jest.fn(async () => undefined)
  if (typeof transactionEm.commit !== 'function') transactionEm.commit = jest.fn(async () => undefined)
  if (typeof transactionEm.rollback !== 'function') transactionEm.rollback = jest.fn(async () => undefined)
  if (typeof transactionEm.flush !== 'function') transactionEm.flush = jest.fn(async () => undefined)
  if (typeof transactionEm.find !== 'function') transactionEm.find = jest.fn(async () => [])
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    dataEngine: asValue(dataEngine),
    em: asValue(em),
  })

  return {
    container,
    auth: { sub: 'actor-1', tenantId: tenantA, orgId: null, isSuperAdmin },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
}

describe('auth.roles.update forward-path rejection localization (#8980)', () => {
  beforeEach(() => {
    translate.mockClear()
  })

  it.each([
    {
      guard: 'rename',
      input: { id: roleId, name: 'Senior Manager' },
      isSuperAdmin: false,
      key: 'auth.roles.errors.nameChangeBlockedByAssignments',
      fallback: 'Role name cannot be changed while users are assigned',
      translated: '[translated] Role name cannot be changed while users are assigned',
    },
    {
      guard: 'tenant move',
      input: { id: roleId, tenantId: tenantB },
      isSuperAdmin: true,
      key: 'auth.roles.errors.tenantMoveBlockedByAssignments',
      fallback: 'Role cannot be moved to another tenant while users are assigned',
      translated: '[translated] Role cannot be moved to another tenant while users are assigned',
    },
  ])('routes the $guard rejection through translate() with the existing auth key, preserving HTTP 400', async ({ input, isSuperAdmin, key, fallback, translated }) => {
    const existingRole = { id: roleId, name: 'Manager', tenantId: tenantA, deletedAt: null } as unknown as Role
    const updateOrmEntity = jest.fn()
    const dataEngine = { updateOrmEntity, markOrmEntityChange: jest.fn() }
    const em = {
      findOne: jest.fn(async () => existingRole),
      find: jest.fn(async () => []),
      count: jest.fn(async () => 1),
      nativeDelete: jest.fn(async () => 0),
      begin: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
    }
    const ctx = makeCtx(dataEngine, em, { isSuperAdmin })

    await expect(getUpdateHandler().execute(input, ctx))
      .rejects.toMatchObject<Partial<CrudHttpError>>({
        status: 400,
        body: { error: translated },
      })

    expect(translate).toHaveBeenCalledWith(key, fallback)
    expect(updateOrmEntity).not.toHaveBeenCalled()
  })

  it('does not call translate when neither rejection guard trips', async () => {
    const existingRole = { id: roleId, name: 'Manager', tenantId: tenantA, deletedAt: null } as unknown as Role
    const updateOrmEntity = jest.fn(async (opts: { apply: (entity: Role) => void }) => {
      const entity = { ...existingRole } as Role
      opts.apply(entity)
      return entity
    })
    const dataEngine = { updateOrmEntity, markOrmEntityChange: jest.fn() }
    const em = {
      findOne: jest.fn(async () => existingRole),
      find: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      nativeDelete: jest.fn(async () => 0),
    }
    const ctx = makeCtx(dataEngine, em, { isSuperAdmin: true })

    await getUpdateHandler().execute({ id: roleId, name: 'Renamed Manager' }, ctx)

    expect(translate).not.toHaveBeenCalled()
  })
})
