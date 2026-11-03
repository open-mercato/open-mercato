import '@open-mercato/core/modules/auth/commands/users'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '../../data/entities'

const USER_ID = '523e4567-e89b-12d3-a456-426614174911'

type StoredUser = {
  id: string
  email: string
  organizationId: string
  tenantId: string
  passwordHash: null
  name: string | null
  isConfirmed: boolean
  timezone?: string | null
  deletedAt: null
}

function storedUser(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: USER_ID,
    email: 'ada@example.com',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    passwordHash: null,
    name: 'Ada',
    isConfirmed: true,
    timezone: 'Asia/Tokyo',
    deletedAt: null,
    ...overrides,
  }
}

function harness(current: StoredUser) {
  const applied: Array<Record<string, unknown>> = []
  const updateOrmEntity = jest.fn(async (opts: Parameters<DataEngine['updateOrmEntity']>[0]) => {
    const entity = { ...current, roles: [], acls: [] } as unknown as User
    await (opts.apply as (target: User) => Promise<void> | void)(entity)
    applied.push(entity as unknown as Record<string, unknown>)
    return entity
  }) as DataEngine['updateOrmEntity']

  const dataEngine = {
    updateOrmEntity,
    setCustomFields: jest.fn(async () => undefined),
    emitOrmEntityEvent: async () => undefined,
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: async () => undefined,
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
    findOne: async (entity: unknown) => (entity === User ? current : null),
  } as unknown as EntityManager

  const rbacService = {
    invalidateUserCache: jest.fn(async () => {}),
    userHasAllFeatures: jest.fn(async () => true),
    userHasAllFeaturesWithEntityManager: jest.fn(async () => true),
    loadAcl: jest.fn(async () => ({ isSuperAdmin: true, features: ['*'], organizations: null })),
    loadAclWithEntityManager: jest.fn(async () => ({ isSuperAdmin: true, features: ['*'], organizations: null })),
  }

  const container = {
    resolve: (token: string) => {
      if (token === 'dataEngine') return dataEngine
      if (token === 'em') return em
      if (token === 'rbacService') return rbacService
      if (token === 'cache') return { deleteByTags: jest.fn(async () => {}) }
      throw new Error(`Unexpected dependency: ${token}`)
    },
  }

  const ctx = {
    container,
    auth: { sub: 'actor-1', tenantId: 'tenant-1', orgId: null },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined,
  } as unknown as CommandRuntimeContext

  return { ctx, applied, updateOrmEntity }
}

function undoSnapshot(overrides: Partial<StoredUser>): Record<string, unknown> {
  const { deletedAt: _deletedAt, ...rest } = storedUser(overrides)
  return { ...rest, roles: [], acls: [] }
}

const handler = () => commandRegistry.get<Record<string, unknown>, unknown>('auth.users.update') as CommandHandler

describe('auth.users.update personal time zone', () => {
  it('stores the canonical zone', async () => {
    const { ctx, applied } = harness(storedUser({ timezone: null }))
    await handler().execute({ id: USER_ID, timezone: 'europe/warsaw' }, ctx)
    expect(applied.at(-1)?.timezone).toBe('Europe/Warsaw')
  })

  it('clears the zone with null', async () => {
    const { ctx, applied } = harness(storedUser())
    await handler().execute({ id: USER_ID, timezone: null }, ctx)
    expect(applied.at(-1)?.timezone).toBeNull()
  })

  it('leaves the zone untouched when the input omits it', async () => {
    const { ctx, applied } = harness(storedUser())
    await handler().execute({ id: USER_ID, name: 'Ada L.' }, ctx)
    expect(applied.at(-1)?.timezone).toBe('Asia/Tokyo')
  })

  it('rejects an unknown zone or a UTC offset before writing', async () => {
    const { ctx, updateOrmEntity } = harness(storedUser())
    await expect(handler().execute({ id: USER_ID, timezone: 'Mars/Olympus' }, ctx)).rejects.toThrow()
    await expect(handler().execute({ id: USER_ID, timezone: '+01:00' }, ctx)).rejects.toThrow()
    expect(updateOrmEntity).not.toHaveBeenCalled()
  })

  it('undo of a time-zone-only update restores the previous zone', async () => {
    const { ctx, applied } = harness(storedUser({ timezone: 'Asia/Tokyo' }))
    const logEntry = {
      payload: {
        undo: {
          before: undoSnapshot({ timezone: 'Europe/Warsaw' }),
          after: undoSnapshot({ timezone: 'Asia/Tokyo' }),
        },
      },
    }
    await (handler().undo as (args: { logEntry: typeof logEntry; ctx: CommandRuntimeContext }) => Promise<void>)({ logEntry, ctx })
    expect(applied.at(-1)?.timezone).toBe('Europe/Warsaw')
  })

  it('undo of a snapshot recorded before the column existed neither reports drift nor touches the zone', async () => {
    const { ctx, applied } = harness(storedUser({ name: 'Ada L.', timezone: null }))
    const { timezone: _beforeZone, ...before } = undoSnapshot({ name: 'Ada' })
    const { timezone: _afterZone, ...after } = undoSnapshot({ name: 'Ada L.' })
    const logEntry = { payload: { undo: { before, after } } }
    await (handler().undo as (args: { logEntry: typeof logEntry; ctx: CommandRuntimeContext }) => Promise<void>)({ logEntry, ctx })
    expect(applied.at(-1)?.name).toBe('Ada')
    expect(applied.at(-1)?.timezone).toBeNull()
  })
})
