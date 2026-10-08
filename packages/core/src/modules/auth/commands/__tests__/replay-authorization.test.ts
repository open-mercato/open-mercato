jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    auth: { user: 'auth:user', role: 'auth:role' },
    directory: { organization: 'directory:organization' },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (
    em: { findOne: (...args: unknown[]) => unknown },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.findOne(entity, where, options),
  findWithDecryption: async (
    em: { find: (...args: unknown[]) => unknown },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.find(entity, where, options),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => {
  const actual = jest.requireActual(
    '@open-mercato/shared/lib/commands/customFieldSnapshots',
  )
  return {
    ...actual,
    loadCustomFieldSnapshot: jest.fn(async () => ({})),
  }
})

import '@open-mercato/core/modules/auth/commands/users'
import '@open-mercato/core/modules/auth/commands/roles'
import { CommandBus, commandRegistry } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import {
  Role,
  RoleAcl,
  User,
  UserAcl,
  UserRole,
} from '@open-mercato/core/modules/auth/data/entities'
import type {
  CommandHandler,
  CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import { lockReplayAuthorizationState } from '@open-mercato/core/modules/auth/lib/commandReplay'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const organizationA = '33333333-3333-4333-8333-333333333333'
const organizationB = '44444444-4444-4444-8444-444444444444'
const actorId = '55555555-5555-4555-8555-555555555555'
const userId = '66666666-6666-4666-8666-666666666666'
const roleId = '77777777-7777-4777-8777-777777777777'
const unrelatedProtectedRoleId = '88888888-8888-4888-8888-888888888888'

type ReplayState = {
  user: Record<string, unknown> | null
  role: Record<string, unknown> | null
  roles: Array<Record<string, unknown>>
  userRoles: Array<Record<string, unknown>>
  userAcls: Array<Record<string, unknown>>
  roleAcls: Array<Record<string, unknown>>
}

function userSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: userId,
    email: 'person@example.com',
    organizationId: organizationA,
    tenantId: tenantA,
    passwordHash: 'hash-current',
    name: 'Person',
    isConfirmed: true,
    roles: [],
    acls: [],
    ...overrides,
  }
}

function roleSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: roleId,
    name: 'After',
    tenantId: tenantA,
    acls: [],
    ...overrides,
  }
}

function makeHarness(
  initial: Partial<ReplayState> = {},
  options: { featureAllowed?: boolean; actorSuperAdmin?: boolean } = {},
) {
  const state: ReplayState = {
    user: null,
    role: null,
    roles: [],
    userRoles: [],
    userAcls: [],
    roleAcls: [],
    ...initial,
  }
  const nativeDelete = jest.fn(async () => 0)
  const deleteOrmEntity = jest.fn(async ({ entity }: { entity: unknown }) => {
    if (entity !== User || !state.user) return null
    const deleted = state.user
    state.user = null
    return deleted
  })
  const updateOrmEntity = jest.fn(
    async ({
      entity,
      apply,
    }: {
      entity: unknown
      apply: (record: Record<string, unknown>) => void | Promise<void>
    }) => {
      const record =
        entity === User ? state.user : entity === Role ? state.role : null
      if (!record) return null
      await apply(record)
      return record
    },
  )
  const markOrmEntityChange = jest.fn()
  const flushOrmEntityChanges = jest.fn(async () => undefined)
  let inTransaction = false
  const lockEvents: string[] = []
  const entityName = (entity: unknown): string => {
    if (entity === User) return 'User'
    if (entity === Role) return 'Role'
    if (entity === Tenant) return 'Tenant'
    if (entity === Organization) return 'Organization'
    if (entity === UserRole) return 'UserRole'
    if (entity === UserAcl) return 'UserAcl'
    if (entity === RoleAcl) return 'RoleAcl'
    return 'Unknown'
  }
  const em = {
    findOne: jest.fn(
      async (entity: unknown, where: Record<string, unknown>, queryOptions?: Record<string, unknown>) => {
        if (queryOptions?.lockMode) lockEvents.push(entityName(entity))
        if (entity === User) return state.user
        if (entity === Role) {
          const candidates = [...state.roles, ...(state.role ? [state.role] : [])]
          return candidates.find((role) => (
            (typeof where?.id !== 'string' || role.id === where.id)
            && (typeof where?.name !== 'string' || role.name === where.name)
            && (typeof where?.tenantId !== 'string' || role.tenantId === where.tenantId)
          )) ?? null
        }
        if (entity === UserAcl) {
          return where?.isSuperAdmin === true
            ? (state.userAcls.find((acl) => acl.isSuperAdmin === true) ?? null)
            : (state.userAcls[0] ?? null)
        }
        if (entity === RoleAcl) {
          return where?.isSuperAdmin === true
            ? (state.roleAcls.find((acl) => acl.isSuperAdmin === true) ?? null)
            : (state.roleAcls[0] ?? null)
        }
        if (entity === Organization) {
          const organizationId = where?.id
          return organizationId === organizationA ||
            organizationId === organizationB
            ? {
                id: organizationId,
                tenant: {
                  id: organizationId === organizationA ? tenantA : tenantB,
                },
              }
            : null
        }
        return null
      },
    ),
    find: jest.fn(async (entity: unknown, where?: Record<string, unknown>, queryOptions?: Record<string, unknown>) => {
      if (queryOptions?.lockMode) lockEvents.push(entityName(entity))
      if (entity === UserRole) return state.userRoles
      if (entity === UserAcl) return state.userAcls
      if (entity === RoleAcl) return state.roleAcls
      if (entity === Role) {
        const candidates = [...state.roles, ...(state.role ? [state.role] : [])]
        const ids = where?.id && typeof where.id === 'object'
          ? (where.id as { $in?: unknown }).$in
          : undefined
        return candidates.filter((role) => (
          (typeof where?.tenantId !== 'string' || role.tenantId === where.tenantId)
          && (!Array.isArray(ids) || ids.includes(role.id))
          && (!where?.minActiveHolders || Number(role.minActiveHolders ?? 0) > 0)
          && (where?.deletedAt !== null || role.deletedAt == null)
        ))
      }
      return []
    }),
    fork: () => em,
    flush: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => inTransaction),
    begin: jest.fn(async () => { inTransaction = true }),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
    nativeDelete,
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn(),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
  }
  const rbacService = {
    userHasAllFeatures: jest.fn(async () => options.featureAllowed ?? true),
    userHasAllFeaturesWithEntityManager: jest.fn(async () => options.featureAllowed ?? true),
    loadAcl: jest.fn(async () => ({
      isSuperAdmin: options.actorSuperAdmin ?? false,
      features:
        options.featureAllowed === false
          ? []
          : ['auth.users.*', 'auth.roles.manage', 'auth.acl.manage'],
      organizations: null,
    })),
    loadAclWithEntityManager: jest.fn(async () => ({
      isSuperAdmin: options.actorSuperAdmin ?? false,
      features:
        options.featureAllowed === false
          ? []
          : ['auth.users.*', 'auth.roles.manage', 'auth.acl.manage'],
      organizations: null,
    })),
    invalidateUserCache: jest.fn(async () => undefined),
  }
  const actionLogService = {
    findByUndoToken: jest.fn(),
    claimForUndo: jest.fn(async () => true),
    claimForRedo: jest.fn(async () => true),
    releaseUndoClaim: jest.fn(async () => true),
    markUndone: jest.fn(async () => undefined),
    log: jest.fn(async () => ({ id: 'new-log' })),
  }
  const dataEngine = {
    updateOrmEntity,
    deleteOrmEntity,
    createOrmEntity: jest.fn(),
    markOrmEntityChange,
    flushOrmEntityChanges,
    setCustomFields: jest.fn(async () => undefined),
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'rbacService') return rbacService
      if (name === 'actionLogService') return actionLogService
      if (name === 'dataEngine') return dataEngine
      if (name === 'cache')
        return { deleteByTags: jest.fn(async () => undefined) }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
  const ctx: CommandRuntimeContext = {
    container: container as CommandRuntimeContext['container'],
    auth: {
      sub: actorId,
      tenantId: tenantA,
      orgId: organizationA,
    } as CommandRuntimeContext['auth'],
    organizationScope: {
      tenantId: tenantA,
      selectedId: organizationA,
      filterIds: [organizationA],
      allowedIds: null,
    },
    selectedOrganizationId: organizationA,
    organizationIds: [organizationA],
  }
  return {
    state,
    ctx,
    em,
    rbacService,
    actionLogService,
    dataEngine,
    nativeDelete,
    updateOrmEntity,
    deleteOrmEntity,
    markOrmEntityChange,
    lockEvents,
  }
}

describe('auth command replay authorization', () => {
  it('locks authorization parents and children in the canonical anti-phantom order', async () => {
    const harness = makeHarness({
      userRoles: [
        { user: { id: actorId }, role: { id: roleId } },
      ],
    })

    await withAtomicFlush(harness.em as never, [() => lockReplayAuthorizationState(
      harness.em as never,
      harness.ctx,
      { targetUserId: userId, targetRoleId: roleId },
    )], { transaction: true })

    expect(harness.lockEvents).toEqual([
      'User',
      'Role',
      'Tenant',
      'Organization',
      'UserRole',
      'UserAcl',
      'RoleAcl',
    ])
    expect(harness.em.find.mock.calls.map(([entity]) => entity)).toEqual([
      UserRole,
      ApiKey,
      User,
      UserRole,
      Role,
      ApiKey,
      Organization,
      UserRole,
      UserAcl,
      RoleAcl,
    ])
    expect(harness.em.find).toHaveBeenCalledWith(
      User,
      { id: { $in: [actorId, userId].sort((left, right) => left.localeCompare(right)) } },
      expect.objectContaining({ lockMode: expect.anything(), orderBy: { id: 'ASC' }, refresh: true }),
    )
    expect(harness.em.find).toHaveBeenCalledWith(
      Role,
      { id: { $in: [roleId] } },
      expect.objectContaining({ lockMode: expect.anything(), orderBy: { id: 'ASC' }, refresh: true }),
    )
  })

  it.each(['create', 'update'] as const)(
    'prelocks unrelated protected tenant roles before authorization children during %s undo',
    async (commandKind) => {
      const protectedRoles = [
        { id: roleId, name: 'Protected A', tenantId: tenantA, minActiveHolders: 1, deletedAt: null },
        { id: unrelatedProtectedRoleId, name: 'Protected B', tenantId: tenantA, minActiveHolders: 1, deletedAt: null },
      ]
      const current = userSnapshot({
        passwordHash: null,
        isConfirmed: true,
      })
      const harness = makeHarness({ user: current, roles: protectedRoles })
      const before = userSnapshot({ passwordHash: null, isConfirmed: false })
      const after = userSnapshot({ passwordHash: null, isConfirmed: true })
      const log = commandKind === 'create'
        ? {
            id: 'create-protected-role-log',
            commandId: 'auth.users.create',
            resourceId: userId,
            tenantId: tenantA,
            commandPayload: {
              __redoInput: { email: before.email, organizationId: organizationA, sendInviteEmail: true },
              undo: { after },
            },
            snapshotAfter: after,
          }
        : {
            id: 'update-protected-role-log',
            commandId: 'auth.users.update',
            resourceId: userId,
            tenantId: tenantA,
            commandPayload: {
              __redoInput: { id: userId, isConfirmed: true },
              undo: { before, after },
            },
          }
      harness.actionLogService.findByUndoToken.mockResolvedValue(log)

      await new CommandBus().undo(`${commandKind}-protected-role-token`, harness.ctx)

      const roleLockCalls = harness.em.find.mock.calls
        .filter(([entity, , queryOptions]) => entity === Role && queryOptions?.lockMode)
      expect(roleLockCalls.map(([, where]) => where)).toEqual([
        { id: { $in: [roleId, unrelatedProtectedRoleId] } },
      ])
      expect(harness.lockEvents.indexOf('Role')).toBeLessThan(harness.lockEvents.indexOf('UserRole'))
      expect(harness.em.findOne.mock.calls).not.toContainEqual([
        Role,
        expect.anything(),
        expect.objectContaining({ lockMode: expect.anything() }),
      ])
    },
  )

  it.each(['update', 'delete'] as const)(
    'reuses prelocked unrelated protected tenant roles during %s redo',
    async (commandKind) => {
      const protectedRoles = [
        { id: roleId, name: 'Protected A', tenantId: tenantA, minActiveHolders: 1, deletedAt: null },
        { id: unrelatedProtectedRoleId, name: 'Protected B', tenantId: tenantA, minActiveHolders: 1, deletedAt: null },
      ]
      const before = userSnapshot({ passwordHash: null, isConfirmed: true })
      const after = userSnapshot({ passwordHash: null, isConfirmed: false })
      const harness = makeHarness({ user: { ...before }, roles: protectedRoles })
      const input = commandKind === 'update'
        ? { id: userId, isConfirmed: false }
        : { id: userId }
      const sourceLog = {
        id: `${commandKind}-protected-role-redo-log`,
        commandId: `auth.users.${commandKind}`,
        resourceId: userId,
        tenantId: tenantA,
        organizationId: organizationA,
        commandPayload: commandKind === 'update'
          ? { __redoInput: input, undo: { before, after } }
          : { __redoInput: input, undo: { before } },
        snapshotBefore: before,
        snapshotAfter: commandKind === 'update' ? after : null,
        executionState: 'undone',
      }

      await new CommandBus().execute(sourceLog.commandId, {
        input,
        ctx: harness.ctx,
        redoLogEntry: sourceLog,
      })

      const roleLockCalls = harness.em.find.mock.calls
        .filter(([entity, , queryOptions]) => entity === Role && queryOptions?.lockMode)
      expect(roleLockCalls.map(([, where]) => where)).toEqual([
        { id: { $in: [roleId, unrelatedProtectedRoleId] } },
      ])
      expect(harness.lockEvents.indexOf('Role')).toBeLessThan(harness.lockEvents.indexOf('UserRole'))
    },
  )

  it('denies create undo after the user moved to a foreign tenant before claiming or deleting', async () => {
    const currentUser = userSnapshot({
      tenantId: tenantB,
      organizationId: organizationB,
      passwordHash: null,
    })
    const harness = makeHarness({ user: currentUser })
    const log = {
      id: 'create-log',
      commandId: 'auth.users.create',
      resourceId: userId,
      commandPayload: {
        __redoInput: {
          email: 'person@example.com',
          organizationId: organizationA,
        },
        undo: { after: userSnapshot({ passwordHash: null }) },
      },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)

    await expect(
      new CommandBus().undo('create-token', harness.ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })

    expect(harness.actionLogService.claimForUndo).not.toHaveBeenCalled()
    expect(harness.deleteOrmEntity).not.toHaveBeenCalled()
    expect(harness.nativeDelete).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('revalidates under a target lock after claim and rejects a concurrent foreign-tenant move without writes or events', async () => {
    const harness = makeHarness({
      user: userSnapshot({ passwordHash: null }),
    })
    const log = {
      id: 'create-race-log',
      commandId: 'auth.users.create',
      resourceId: userId,
      commandPayload: {
        __redoInput: {
          email: 'person@example.com',
          organizationId: organizationA,
          sendInviteEmail: true,
        },
        undo: { after: userSnapshot({ passwordHash: null }) },
      },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)
    harness.actionLogService.claimForUndo.mockImplementation(async () => {
      harness.state.user = userSnapshot({
        tenantId: tenantB,
        organizationId: organizationB,
        passwordHash: null,
      })
      return true
    })

    await expect(
      new CommandBus().undo('create-race-token', harness.ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })

    expect(harness.actionLogService.claimForUndo).toHaveBeenCalledTimes(1)
    expect(harness.em.begin).toHaveBeenCalledTimes(1)
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
    expect(harness.em.commit).not.toHaveBeenCalled()
    expect(harness.em.find).toHaveBeenCalledWith(
      User,
      { id: { $in: expect.arrayContaining([userId]) } },
      expect.objectContaining({ lockMode: expect.anything(), refresh: true }),
    )
    expect(harness.deleteOrmEntity).not.toHaveBeenCalled()
    expect(harness.nativeDelete).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
    expect(harness.dataEngine.flushOrmEntityChanges).not.toHaveBeenCalled()
    expect(harness.actionLogService.markUndone).not.toHaveBeenCalled()
  })

  it('fails closed for historical password-bearing user create undo before claim', async () => {
    const harness = makeHarness({ user: userSnapshot() })
    const log = {
      id: 'legacy-password-create-log',
      commandId: 'auth.users.create',
      resourceId: userId,
      commandPayload: {
        __redoInput: {
          email: 'person@example.com',
          organizationId: organizationA,
          password: 'legacy-plain-text',
        },
        undo: { after: userSnapshot({ passwordHash: 'legacy-password-hash' }) },
      },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)

    await expect(
      new CommandBus().undo('legacy-password-create-token', harness.ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 400 })

    expect(harness.actionLogService.claimForUndo).not.toHaveBeenCalled()
    expect(harness.deleteOrmEntity).not.toHaveBeenCalled()
    expect(harness.nativeDelete).not.toHaveBeenCalled()
  })

  it('fails closed for historical password-bearing user create redo before mutation or logging', async () => {
    const harness = makeHarness({ user: null })
    const sourceLog = {
      id: 'legacy-password-create-redo-log',
      commandId: 'auth.users.create',
      resourceId: userId,
      commandPayload: {
        __redoInput: {
          email: 'person@example.com',
          organizationId: organizationA,
          password: 'legacy-plain-text',
        },
        undo: { after: userSnapshot({ passwordHash: 'legacy-password-hash' }) },
      },
    }

    await expect(
      new CommandBus().execute('auth.users.create', {
        input: sourceLog.commandPayload.__redoInput,
        ctx: harness.ctx,
        redoLogEntry: sourceLog,
      }),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 400 })

    expect(harness.dataEngine.createOrmEntity).not.toHaveBeenCalled()
    expect(harness.actionLogService.log).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('denies role undo when current role-management privilege was revoked', async () => {
    const harness = makeHarness(
      { role: roleSnapshot() },
      { featureAllowed: false },
    )
    const log = {
      id: 'role-log',
      commandId: 'auth.roles.update',
      resourceId: roleId,
      commandPayload: {
        __redoInput: { id: roleId, name: 'After' },
        undo: {
          before: roleSnapshot({ name: 'Before' }),
          after: roleSnapshot(),
        },
      },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)

    await expect(
      new CommandBus().undo('role-token', harness.ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 403 })

    expect(harness.actionLogService.claimForUndo).not.toHaveBeenCalled()
    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
    expect(harness.nativeDelete).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('denies role undo when the current role ACL is now superadmin', async () => {
    const harness = makeHarness({
      role: roleSnapshot(),
      roleAcls: [
        {
          id: 'acl-superadmin',
          role: roleId,
          tenantId: tenantA,
          featuresJson: ['*'],
          isSuperAdmin: true,
          organizationsJson: null,
        },
      ],
    })
    const log = {
      id: 'role-superadmin-log',
      commandId: 'auth.roles.update',
      resourceId: roleId,
      commandPayload: {
        __redoInput: { id: roleId, name: 'After' },
        undo: {
          before: roleSnapshot({ name: 'Before' }),
          after: roleSnapshot(),
        },
      },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)

    await expect(
      new CommandBus().undo('role-superadmin-token', harness.ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 403 })

    expect(harness.actionLogService.claimForUndo).not.toHaveBeenCalled()
    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
    expect(harness.nativeDelete).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('keeps a later role ACL unchanged during an authorized scalar undo of a historical log', async () => {
    const currentAcl = {
      id: 'acl-current',
      tenantId: tenantA,
      featuresJson: ['auth.roles.list'],
      isSuperAdmin: false,
      organizationsJson: null,
    }
    const harness = makeHarness({
      role: roleSnapshot(),
      roleAcls: [currentAcl],
    })
    const historicalAcl = {
      id: 'acl-historical',
      tenantId: tenantA,
      features: ['*'],
      isSuperAdmin: true,
      organizations: null,
    }
    const log = {
      id: 'role-history-log',
      commandId: 'auth.roles.update',
      resourceId: roleId,
      commandPayload: {
        __redoInput: { id: roleId, name: 'After' },
        undo: {
          before: roleSnapshot({ name: 'Before', acls: [historicalAcl] }),
          after: roleSnapshot({ acls: [historicalAcl] }),
        },
      },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)

    await new CommandBus().undo('role-history-token', harness.ctx)

    expect(harness.state.role).toMatchObject({ name: 'Before' })
    expect(harness.state.roleAcls).toEqual([currentAcl])
    expect(harness.nativeDelete).not.toHaveBeenCalledWith(
      RoleAcl,
      expect.anything(),
    )
    expect(harness.actionLogService.markUndone).toHaveBeenCalledTimes(1)
  })

  it('rejects a historical password redo before reading or mutating the promoted user', async () => {
    const harness = makeHarness({
      user: userSnapshot(),
      userRoles: [
        {
          user: { id: userId },
          role: { id: roleId, name: 'Admin', tenantId: tenantA },
        },
      ],
      roleAcls: [
        {
          role: roleId,
          tenantId: tenantA,
          isSuperAdmin: true,
          featuresJson: ['*'],
        },
      ],
    })
    const sourceLog = {
      id: 'password-log',
      commandId: 'auth.users.update',
      resourceId: userId,
      commandPayload: {
        __redoInput: { id: userId, password: 'known-old-password' },
        undo: {
          before: userSnapshot({ passwordHash: 'hash-before' }),
          after: userSnapshot({ passwordHash: 'hash-known' }),
        },
      },
    }

    await expect(
      new CommandBus().execute('auth.users.update', {
        input: { id: userId, password: 'known-old-password' },
        ctx: harness.ctx,
        redoLogEntry: sourceLog,
      }),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 400 })

    expect(harness.em.findOne).not.toHaveBeenCalled()
    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
    expect(harness.actionLogService.log).not.toHaveBeenCalled()
  })

  it('rejects a historical password undo before claiming the log or restoring credentials', async () => {
    const harness = makeHarness({ user: userSnapshot() })
    const log = {
      id: 'password-undo-log',
      commandId: 'auth.users.update',
      resourceId: userId,
      commandPayload: {
        __redoInput: { id: userId, password: 'known-old-password' },
        undo: {
          before: userSnapshot({ passwordHash: 'hash-before' }),
          after: userSnapshot({ passwordHash: 'hash-known' }),
        },
      },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)

    await expect(
      new CommandBus().undo('password-undo-token', harness.ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 400 })

    expect(harness.actionLogService.claimForUndo).not.toHaveBeenCalled()
    expect(harness.em.findOne).not.toHaveBeenCalled()
    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('rejects stale user update undo before the log claim and secondary effects', async () => {
    const harness = makeHarness({
      user: userSnapshot({ email: 'later@example.com' }),
    })
    const log = {
      id: 'stale-user-log',
      commandId: 'auth.users.update',
      resourceId: userId,
      commandPayload: {
        __redoInput: { id: userId, email: 'after@example.com' },
        undo: {
          before: userSnapshot({ email: 'before@example.com' }),
          after: userSnapshot({ email: 'after@example.com' }),
        },
      },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)

    await expect(
      new CommandBus().undo('stale-user-token', harness.ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 409 })

    expect(harness.actionLogService.claimForUndo).not.toHaveBeenCalled()
    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('rejects stale user update redo before mutation, logging, or events', async () => {
    const harness = makeHarness({
      user: userSnapshot({ email: 'intervening@example.com' }),
    })
    const sourceLog = {
      id: 'stale-redo-log',
      commandId: 'auth.users.update',
      resourceId: userId,
      commandPayload: {
        __redoInput: { id: userId, email: 'after@example.com' },
        undo: {
          before: userSnapshot({ email: 'before@example.com' }),
          after: userSnapshot({ email: 'after@example.com' }),
        },
      },
    }

    await expect(
      new CommandBus().execute('auth.users.update', {
        input: { id: userId, email: 'after@example.com' },
        ctx: harness.ctx,
        redoLogEntry: sourceLog,
      }),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 409 })

    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
    expect(harness.actionLogService.log).not.toHaveBeenCalled()
  })

  it('allows a fresh self-service email undo and preserves normal side effects', async () => {
    const harness = makeHarness({
      user: userSnapshot({ id: actorId, email: 'after@example.com' }),
    })
    harness.ctx.auth = {
      sub: actorId,
      tenantId: tenantA,
      orgId: organizationA,
    } as CommandRuntimeContext['auth']
    const log = {
      id: 'safe-user-log',
      commandId: 'auth.users.update',
      resourceId: actorId,
      commandPayload: {
        __redoInput: { id: actorId, email: 'after@example.com' },
        undo: {
          before: userSnapshot({ id: actorId, email: 'before@example.com' }),
          after: userSnapshot({ id: actorId, email: 'after@example.com' }),
        },
      },
      snapshotBefore: { email: 'before@example.com' },
      snapshotAfter: { email: 'after@example.com' },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)

    await new CommandBus().undo('safe-user-token', harness.ctx)

    expect(harness.state.user).toMatchObject({ email: 'before@example.com' })
    expect(harness.actionLogService.claimForUndo).toHaveBeenCalledTimes(1)
    expect(harness.actionLogService.markUndone).toHaveBeenCalledTimes(1)
    expect(harness.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'updated' }),
    )
    expect(harness.dataEngine.flushOrmEntityChanges).toHaveBeenCalledTimes(1)
  })

  it('requires current canonical superadmin authority to undo an empty-ACL role tenant move', async () => {
    const harness = makeHarness({
      role: roleSnapshot({ tenantId: tenantB, acls: [] }),
    }, { actorSuperAdmin: false })
    harness.ctx.auth = {
      sub: actorId,
      tenantId: tenantB,
      orgId: organizationB,
      isSuperAdmin: true,
    } as CommandRuntimeContext['auth']
    const log = {
      id: 'empty-acl-role-move-undo-log',
      commandId: 'auth.roles.update',
      resourceId: roleId,
      commandPayload: {
        __redoInput: { id: roleId, tenantId: tenantB },
        undo: {
          before: roleSnapshot({ tenantId: tenantA, acls: [] }),
          after: roleSnapshot({ tenantId: tenantB, acls: [] }),
        },
      },
    }
    harness.actionLogService.findByUndoToken.mockResolvedValue(log)

    await expect(
      new CommandBus().undo('empty-acl-role-move-undo-token', harness.ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 403 })

    expect(harness.rbacService.loadAcl).not.toHaveBeenCalled()
    expect(harness.rbacService.loadAclWithEntityManager).toHaveBeenCalledWith(
      harness.em,
      actorId,
      expect.objectContaining({ tenantId: tenantB }),
    )
    expect(harness.actionLogService.claimForUndo).not.toHaveBeenCalled()
    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
  })

  it('requires current canonical superadmin authority to redo an empty-ACL role tenant move', async () => {
    const harness = makeHarness({
      role: roleSnapshot({ tenantId: tenantA, acls: [] }),
    }, { actorSuperAdmin: false })
    harness.ctx.auth = {
      sub: actorId,
      tenantId: tenantA,
      orgId: organizationA,
      isSuperAdmin: true,
    } as CommandRuntimeContext['auth']
    const sourceLog = {
      id: 'empty-acl-role-move-redo-log',
      commandId: 'auth.roles.update',
      resourceId: roleId,
      commandPayload: {
        __redoInput: { id: roleId, tenantId: tenantB },
        undo: {
          before: roleSnapshot({ tenantId: tenantA, acls: [] }),
          after: roleSnapshot({ tenantId: tenantB, acls: [] }),
        },
      },
    }

    await expect(
      new CommandBus().execute('auth.roles.update', {
        input: sourceLog.commandPayload.__redoInput,
        ctx: harness.ctx,
        redoLogEntry: sourceLog,
      }),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 403 })

    expect(harness.rbacService.loadAcl).not.toHaveBeenCalled()
    expect(harness.rbacService.loadAclWithEntityManager).toHaveBeenCalledWith(
      harness.em,
      actorId,
      expect.objectContaining({ tenantId: tenantA }),
    )
    expect(harness.updateOrmEntity).not.toHaveBeenCalled()
    expect(harness.actionLogService.log).not.toHaveBeenCalled()
  })

  it('keeps password-bearing create logs undoable while omitting every credential', async () => {
    const handler = commandRegistry.get('auth.users.create') as CommandHandler<
      Record<string, unknown>,
      { user: User }
    >
    const harness = makeHarness()
    const result = userSnapshot() as unknown as User
    const metadata = await handler.buildLog!({
      input: {
        email: 'person@example.com',
        organizationId: organizationA,
        password: 'new-secret-password',
      },
      result: { user: result },
      ctx: harness.ctx,
      snapshots: {},
    })

    // Undoing a create only deletes the row, so it stays available: the entry
    // keeps its undo token and its after-snapshot (which carries the original id
    // so a redo restores it). Only the credentials are withheld.
    expect(metadata?.replayable).toBeUndefined()
    expect(metadata?.payload).toBeDefined()
    expect(
      (metadata as { redoInput?: Record<string, unknown> } | null | undefined)?.redoInput,
    ).not.toHaveProperty('password')
    expect(JSON.stringify(metadata)).not.toContain('new-secret-password')
    expect(JSON.stringify(metadata)).not.toContain('hash-current')
  })

  it('marks new password update logs non-replayable and omits credential snapshots', async () => {
    const handler = commandRegistry.get('auth.users.update') as CommandHandler<
      Record<string, unknown>,
      User
    >
    const harness = makeHarness()
    const result = userSnapshot() as unknown as User
    const metadata = await handler.buildLog!({
      input: { id: userId, password: 'new-secret-password' },
      result,
      ctx: harness.ctx,
      snapshots: {
        before: {
          view: {
            email: 'person@example.com',
            organizationId: organizationA,
            tenantId: tenantA,
            roles: [],
            name: 'Person',
            isConfirmed: true,
          },
          undo: userSnapshot({ passwordHash: 'hash-before' }),
        },
      },
    })

    expect(metadata).toMatchObject({ replayable: false })
    expect(metadata?.payload).toBeUndefined()
    expect(JSON.stringify(metadata)).not.toContain('new-secret-password')
    expect(JSON.stringify(metadata)).not.toContain('hash-before')
  })
})
