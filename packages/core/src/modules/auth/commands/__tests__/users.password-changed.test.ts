const mockEmitAuthEvent = jest.fn(async (_eventId: string, _payload: Record<string, unknown>) => undefined)

jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: (eventId: string, payload: Record<string, unknown>) => mockEmitAuthEvent(eventId, payload),
}))

import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '../../data/entities'

const USER_ID = '523e4567-e89b-12d3-a456-426614174901'
const ADMIN_ID = '523e4567-e89b-12d3-a456-426614174902'

function buildHarness() {
  const updateOrmEntity = jest.fn(async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
    const entity = {
      id: USER_ID,
      email: 'ada@example.com',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      passwordHash: null,
      name: 'Ada',
      isConfirmed: true,
      roles: [],
      acls: [],
    } as unknown as User

    await (opts.apply as (current: User) => Promise<void> | void)(entity)
    return entity
  }) as DataEngine['updateOrmEntity']

  const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'setCustomFields' | 'emitOrmEntityEvent' | 'markOrmEntityChange' | 'flushOrmEntityChanges'> = {
    updateOrmEntity,
    setCustomFields: jest.fn(async () => undefined) as DataEngine['setCustomFields'],
    emitOrmEntityEvent: (async () => undefined) as DataEngine['emitOrmEntityEvent'],
    markOrmEntityChange: jest.fn() as never,
    flushOrmEntityChanges: (async () => undefined) as DataEngine['flushOrmEntityChanges'],
  }

  const em = {
    find: async () => [],
    begin: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    remove: () => undefined,
    persist: () => undefined,
    flush: async () => undefined,
    nativeDelete: async () => 0,
    create: (_entity: unknown, data: unknown) => data,
    findOne: async (entity: unknown) => (entity === User
      ? {
          id: USER_ID,
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          deletedAt: null,
        }
      : null),
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

  return { container }
}

function buildContext(actorId: string): CommandRuntimeContext {
  const { container } = buildHarness()
  return {
    container: container as never,
    auth: { sub: actorId, tenantId: 'tenant-1', orgId: null } as never,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined as never,
  }
}

function getUpdateHandler(): CommandHandler {
  const handler = commandRegistry.get<Record<string, unknown>, unknown>('auth.users.update') as CommandHandler
  expect(handler).toBeDefined()
  return handler
}

describe('auth.users.update — auth.password.changed event', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reports changedBy self when the actor updates their own password', async () => {
    await getUpdateHandler().execute({ id: USER_ID, password: 'New-Passw0rd!' }, buildContext(USER_ID))

    expect(mockEmitAuthEvent).toHaveBeenCalledWith('auth.password.changed', {
      id: USER_ID,
      email: 'ada@example.com',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      changedBy: 'self',
      changedById: USER_ID,
    })
  })

  it('reports changedBy admin when another user sets the password', async () => {
    await getUpdateHandler().execute({ id: USER_ID, password: 'New-Passw0rd!' }, buildContext(ADMIN_ID))

    expect(mockEmitAuthEvent).toHaveBeenCalledWith(
      'auth.password.changed',
      expect.objectContaining({ id: USER_ID, changedBy: 'admin', changedById: ADMIN_ID }),
    )
  })

  it('does not emit when the update carries no password', async () => {
    await getUpdateHandler().execute({ id: USER_ID, name: 'Ada Lovelace' }, buildContext(ADMIN_ID))

    expect(mockEmitAuthEvent).not.toHaveBeenCalled()
  })

  it('completes the update even when the event bus rejects', async () => {
    mockEmitAuthEvent.mockRejectedValueOnce(new Error('event bus down'))

    await expect(
      getUpdateHandler().execute({ id: USER_ID, password: 'New-Passw0rd!' }, buildContext(USER_ID)),
    ).resolves.toBeDefined()
  })
})
