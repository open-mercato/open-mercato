import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { User, UserRole, Role, UserAcl, Session, PasswordReset } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { E } from '#generated/entities.ids.generated'
import { z } from 'zod'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
  diffCustomFieldChanges,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { normalizeTenantId } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import notificationTypes from '@open-mercato/core/modules/auth/notifications'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'

type SerializedUser = {
  email: string
  organizationId: string | null
  tenantId: string | null
  roles: string[]
  name: string | null
  isConfirmed: boolean
  custom?: Record<string, unknown>
}

type UserAclSnapshot = {
  tenantId: string
  features: string[] | null
  isSuperAdmin: boolean
  organizations: string[] | null
}

type UserUndoSnapshot = {
  id: string
  email: string
  organizationId: string | null
  tenantId: string | null
  passwordHash: string | null
  name: string | null
  isConfirmed: boolean
  roles: string[]
  acls: UserAclSnapshot[]
  custom?: Record<string, unknown>
}

type UserSnapshots = {
  view: SerializedUser
  undo: UserUndoSnapshot
}

const passwordSchema = buildPasswordSchema()

const createSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  organizationId: z.string().uuid(),
  roles: z.array(z.string()).optional(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  password: passwordSchema.optional(),
  organizationId: z.string().uuid().optional(),
  roles: z.array(z.string()).optional(),
})

export const userCrudEvents: CrudEventsConfig = {
  module: 'auth',
  entity: 'user',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const userCrudIndexer: CrudIndexerConfig = {
  entityType: E.auth.user,
  buildUpsertPayload: (ctx) => ({
    entityType: E.auth.user,
    recordId: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
  buildDeletePayload: (ctx) => ({
    entityType: E.auth.user,
    recordId: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

async function notifyRoleChanges(
  ctx: CommandRuntimeContext,
  user: User,
  assignedRoles: string[],
  revokedRoles: string[],
): Promise<void> {
  const tenantId = user.tenantId ? String(user.tenantId) : null
  if (!tenantId) return
  const organizationId = user.organizationId ? String(user.organizationId) : null

  try {
    const notificationService = resolveNotificationService(ctx.container)
    if (assignedRoles.length) {
      const assignedType = notificationTypes.find((type) => type.type === 'auth.role.assigned')
      if (assignedType) {
        const notificationInput = buildNotificationFromType(assignedType, {
          recipientUserId: String(user.id),
          sourceEntityType: 'auth:user',
          sourceEntityId: String(user.id),
        })
        await notificationService.create(notificationInput, { tenantId, organizationId })
      }
    }

    if (revokedRoles.length) {
      const revokedType = notificationTypes.find((type) => type.type === 'auth.role.revoked')
      if (revokedType) {
        const notificationInput = buildNotificationFromType(revokedType, {
          recipientUserId: String(user.id),
          sourceEntityType: 'auth:user',
          sourceEntityId: String(user.id),
        })
        await notificationService.create(notificationInput, { tenantId, organizationId })
      }
    }
  } catch (err) {
    console.error('[auth.users.roles] Failed to create notification:', err)
  }
}

const createUserCommand: CommandHandler<Record<string, unknown>, User> = {
  id: 'auth.users.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(createSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)

    const organization = await findOneWithDecryption(
      em,
      Organization,
      { id: parsed.organizationId },
      { populate: ['tenant'] },
      { tenantId: null, organizationId: parsed.organizationId },
    )
    if (!organization) throw new CrudHttpError(400, { error: 'Organization not found' })

    const emailHash = computeEmailHash(parsed.email)
    const duplicate = await em.findOne(User, { $or: [{ email: parsed.email }, { emailHash }], deletedAt: null } as any)
    if (duplicate) await throwDuplicateEmailError()

    const { hash } = await import('bcryptjs')
    const passwordHash = await hash(parsed.password, 10)
    const tenantId = organization.tenant?.id ? String(organization.tenant.id) : null

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    let user: User
    try {
      user = await de.createOrmEntity({
        entity: User,
        data: {
          email: parsed.email,
          emailHash,
          passwordHash,
          isConfirmed: true,
          organizationId: parsed.organizationId,
          tenantId,
        },
      })
    } catch (error) {
      if (isUniqueViolation(error)) await throwDuplicateEmailError()
      throw error
    }

    let assignedRoles: string[] = []
    if (Array.isArray(parsed.roles) && parsed.roles.length) {
      await syncUserRoles(em, user, parsed.roles, tenantId)
      assignedRoles = await loadUserRoleNames(em, String(user.id))
    }

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.auth.user,
      recordId: String(user.id),
      organizationId: user.organizationId ? String(user.organizationId) : null,
      tenantId: tenantId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: user,
      identifiers: {
        id: String(user.id),
        organizationId: user.organizationId ? String(user.organizationId) : null,
        tenantId,
      },
      events: userCrudEvents,
      indexer: userCrudIndexer,
    })

    if (assignedRoles.length) {
      await notifyRoleChanges(ctx, user, assignedRoles, [])
    }

    return user
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const roles = await loadUserRoleNames(em, String(result.id))
    const custom = await loadUserCustomSnapshot(
      em,
      String(result.id),
      result.tenantId ? String(result.tenantId) : null,
      result.organizationId ? String(result.organizationId) : null
    )
    return serializeUser(result, roles, custom)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const roles = await loadUserRoleNames(em, String(result.id))
    const custom = await loadUserCustomSnapshot(
      em,
      String(result.id),
      result.tenantId ? String(result.tenantId) : null,
      result.organizationId ? String(result.organizationId) : null
    )
    const snapshot = captureUserSnapshots(result, roles, undefined, custom)
    return {
      actionLabel: translate('auth.audit.users.create', 'Create user'),
      resourceKind: 'auth.user',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      snapshotAfter: snapshot.view,
      payload: {
        undo: {
          after: snapshot.undo,
        },
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const userId = typeof logEntry?.resourceId === 'string' ? logEntry.resourceId : null
    if (!userId) return
    const snapshot = logEntry?.snapshotAfter as SerializedUser | undefined
    const em = (ctx.container.resolve('em') as EntityManager)
    await em.nativeDelete(UserAcl, { user: userId })
    await em.nativeDelete(UserRole, { user: userId })
    await em.nativeDelete(Session, { user: userId })
    await em.nativeDelete(PasswordReset, { user: userId })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const reset = buildCustomFieldResetMap(undefined, snapshot.custom)
      if (Object.keys(reset).length) {
        await setCustomFieldsIfAny({
          dataEngine: de,
          entityId: E.auth.user,
          recordId: userId,
          organizationId: snapshot.organizationId,
          tenantId: snapshot.tenantId,
          values: reset,
          notify: false,
        })
      }
    }
    const removed = await de.deleteOrmEntity({
      entity: User,
      where: { id: userId, deletedAt: null } as FilterQuery<User>,
      soft: false,
    })

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: {
        id: userId,
        organizationId: snapshot?.organizationId ?? null,
        tenantId: snapshot?.tenantId ?? null,
      },
      events: userCrudEvents,
      indexer: userCrudIndexer,
    })

    await invalidateUserCache(ctx, userId)
  },
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code === '23505') return true
  const messageRaw = (error as { message?: string })?.message
  const message = typeof messageRaw === 'string' ? messageRaw : ''
  return message.toLowerCase().includes('duplicate key')
}

const updateUserCommand: CommandHandler<Record<string, unknown>, User> = {
  id: 'auth.users.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(updateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const existing = await em.findOne(User, { id: parsed.id, deletedAt: null })
    if (!existing) throw new CrudHttpError(404, { error: 'User not found' })
    const roles = await loadUserRoleNames(em, parsed.id)
    const acls = await loadUserAclSnapshots(em, parsed.id)
    const custom = await loadUserCustomSnapshot(
      em,
      parsed.id,
      existing.tenantId ? String(existing.tenantId) : null,
      existing.organizationId ? String(existing.organizationId) : null
    )
    return { before: captureUserSnapshots(existing, roles, acls, custom) }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(updateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const rolesBefore = Array.isArray(parsed.roles)
      ? await loadUserRoleNames(em, parsed.id)
      : null

    if (parsed.email !== undefined) {
      const emailHash = computeEmailHash(parsed.email)
      const duplicate = await em.findOne(
        User,
        {
          $or: [{ email: parsed.email }, { emailHash }],
          deletedAt: null,
          id: { $ne: parsed.id } as any,
        } as FilterQuery<User>,
      )
      if (duplicate) await throwDuplicateEmailError()
    }

    let hashed: string | null = null
    let emailHash: string | null = null
    if (parsed.password) {
      const { hash } = await import('bcryptjs')
      hashed = await hash(parsed.password, 10)
    }
    if (parsed.email !== undefined) {
      emailHash = computeEmailHash(parsed.email)
    }

    let tenantId: string | null | undefined
    if (parsed.organizationId !== undefined) {
      const organization = await findOneWithDecryption(
        em,
        Organization,
        { id: parsed.organizationId },
        { populate: ['tenant'] },
        { tenantId: null, organizationId: parsed.organizationId ?? null },
      )
      if (!organization) throw new CrudHttpError(400, { error: 'Organization not found' })
      tenantId = organization.tenant?.id ? String(organization.tenant.id) : null
    }

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    let user: User | null
    try {
      user = await de.updateOrmEntity({
        entity: User,
        where: { id: parsed.id, deletedAt: null } as FilterQuery<User>,
        apply: (entity) => {
          if (parsed.email !== undefined) {
            entity.email = parsed.email
            entity.emailHash = emailHash
          }
          if (parsed.organizationId !== undefined) {
            entity.organizationId = parsed.organizationId
            entity.tenantId = tenantId ?? null
          }
          if (hashed) entity.passwordHash = hashed
        },
      })
    } catch (error) {
      if (isUniqueViolation(error)) await throwDuplicateEmailError()
      throw error
    }
    if (!user) throw new CrudHttpError(404, { error: 'User not found' })

    if (Array.isArray(parsed.roles)) {
      await syncUserRoles(em, user, parsed.roles, user.tenantId ? String(user.tenantId) : tenantId ?? null)
    }

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.auth.user,
      recordId: String(user.id),
      organizationId: user.organizationId ? String(user.organizationId) : null,
      tenantId: user.tenantId ? String(user.tenantId) : tenantId ?? null,
      values: custom,
    })

    const identifiers = {
      id: String(user.id),
      organizationId: user.organizationId ? String(user.organizationId) : null,
      tenantId: user.tenantId ? String(user.tenantId) : tenantId ?? null,
    }

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: user,
      identifiers,
      events: userCrudEvents,
      indexer: userCrudIndexer,
    })

    if (Array.isArray(parsed.roles) && rolesBefore) {
      const rolesAfter = await loadUserRoleNames(em, String(user.id))
      const { assigned, revoked } = diffRoleChanges(rolesBefore, rolesAfter)
      if (assigned.length || revoked.length) {
        await notifyRoleChanges(ctx, user, assigned, revoked)
      }
    }

    await invalidateUserCache(ctx, parsed.id)

    return user
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const roles = await loadUserRoleNames(em, String(result.id))
    const custom = await loadUserCustomSnapshot(
      em,
      String(result.id),
      result.tenantId ? String(result.tenantId) : null,
      result.organizationId ? String(result.organizationId) : null
    )
    return serializeUser(result, roles, custom)
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const beforeSnapshots = snapshots.before as UserSnapshots | undefined
    const before = beforeSnapshots?.view
    const beforeUndo = beforeSnapshots?.undo ?? null
    const em = (ctx.container.resolve('em') as EntityManager)
    const afterRoles = await loadUserRoleNames(em, String(result.id))
    const afterCustom = await loadUserCustomSnapshot(
      em,
      String(result.id),
      result.tenantId ? String(result.tenantId) : null,
      result.organizationId ? String(result.organizationId) : null
    )
    const afterSnapshots = captureUserSnapshots(result, afterRoles, undefined, afterCustom)
    const after = afterSnapshots.view
    const changes = buildChanges(before ?? null, after as Record<string, unknown>, ['email', 'organizationId', 'tenantId', 'name', 'isConfirmed'])
    if (before && !arrayEquals(before.roles, afterRoles)) {
      changes.roles = { from: before.roles, to: afterRoles }
    }
    const customDiff = diffCustomFieldChanges(before?.custom, afterCustom)
    for (const [key, diff] of Object.entries(customDiff)) {
      changes[`cf_${key}`] = diff
    }
    return {
      actionLabel: translate('auth.audit.users.update', 'Update user'),
      resourceKind: 'auth.user',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      changes,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: {
          before: beforeUndo,
          after: afterSnapshots.undo,
        },
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before) return
    const userId = before.id
    const em = (ctx.container.resolve('em') as EntityManager)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const updated = await de.updateOrmEntity({
      entity: User,
      where: { id: userId, deletedAt: null } as FilterQuery<User>,
      apply: (entity) => {
        entity.email = before.email
        entity.organizationId = before.organizationId ?? null
        entity.tenantId = before.tenantId ?? null
        entity.passwordHash = before.passwordHash ?? null
        entity.name = before.name ?? undefined
        entity.isConfirmed = before.isConfirmed
      },
    })

    if (updated) {
      await syncUserRoles(em, updated, before.roles, before.tenantId)
      await em.flush()
    }

    const reset = buildCustomFieldResetMap(before.custom, after?.custom)
    if (Object.keys(reset).length) {
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: E.auth.user,
        recordId: before.id,
        organizationId: before.organizationId ?? null,
        tenantId: before.tenantId ?? null,
        values: reset,
        notify: false,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: {
        id: before.id,
        organizationId: before.organizationId ?? null,
        tenantId: before.tenantId ?? null,
      },
      events: userCrudEvents,
      indexer: userCrudIndexer,
    })

    await invalidateUserCache(ctx, userId)
  },
}

const deleteUserCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, User> = {
  id: 'auth.users.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'User id required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const existing = await em.findOne(User, { id, deletedAt: null })
    if (!existing) return {}
    const roles = await loadUserRoleNames(em, id)
    const acls = await loadUserAclSnapshots(em, id)
    const custom = await loadUserCustomSnapshot(
      em,
      id,
      existing.tenantId ? String(existing.tenantId) : null,
      existing.organizationId ? String(existing.organizationId) : null
    )
    return { before: captureUserSnapshots(existing, roles, acls, custom) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'User id required')
    const em = (ctx.container.resolve('em') as EntityManager)

    await em.nativeDelete(UserAcl, { user: id })
    await em.nativeDelete(UserRole, { user: id })
    await em.nativeDelete(Session, { user: id })
    await em.nativeDelete(PasswordReset, { user: id })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const user = await de.deleteOrmEntity({
      entity: User,
      where: { id, deletedAt: null } as FilterQuery<User>,
      soft: false,
    })
    if (!user) throw new CrudHttpError(404, { error: 'User not found' })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: user,
      identifiers: {
        id: String(id),
        organizationId: user.organizationId ? String(user.organizationId) : null,
        tenantId: user.tenantId ? String(user.tenantId) : null,
      },
      events: userCrudEvents,
      indexer: userCrudIndexer,
    })

    await invalidateUserCache(ctx, id)

    return user
  },
  buildLog: async ({ snapshots, input, ctx }) => {
    const { translate } = await resolveTranslations()
    const beforeSnapshots = snapshots.before as UserSnapshots | undefined
    const before = beforeSnapshots?.view
    const beforeUndo = beforeSnapshots?.undo ?? null
    const id = requireId(input, 'User id required')
    return {
      actionLabel: translate('auth.audit.users.delete', 'Delete user'),
      resourceKind: 'auth.user',
      resourceId: id,
      snapshotBefore: before ?? null,
      tenantId: before?.tenantId ?? null,
      payload: {
        undo: {
          before: beforeUndo,
        },
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager)
    let user = await em.findOne(User, { id: before.id })
    const de = (ctx.container.resolve('dataEngine') as DataEngine)

    if (user) {
      if (user.deletedAt) {
        user.deletedAt = null
      }
      user.email = before.email
      user.organizationId = before.organizationId ?? null
      user.tenantId = before.tenantId ?? null
      user.passwordHash = before.passwordHash ?? null
      user.name = before.name ?? undefined
      user.isConfirmed = before.isConfirmed
      await em.flush()
    } else {
      user = await de.createOrmEntity({
        entity: User,
        data: {
          id: before.id,
          email: before.email,
          organizationId: before.organizationId ?? null,
          tenantId: before.tenantId ?? null,
          passwordHash: before.passwordHash ?? null,
          name: before.name ?? null,
          isConfirmed: before.isConfirmed,
        },
      })
    }

    if (!user) return

    await em.nativeDelete(UserRole, { user: before.id })
    await syncUserRoles(em, user, before.roles, before.tenantId)

    await restoreUserAcls(em, user, before.acls)

    const reset = buildCustomFieldResetMap(before.custom, undefined)
    if (Object.keys(reset).length) {
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: E.auth.user,
        recordId: before.id,
        organizationId: before.organizationId ?? null,
        tenantId: before.tenantId ?? null,
        values: reset,
        notify: false,
      })
    }

    await invalidateUserCache(ctx, before.id)
  },
}

registerCommand(createUserCommand)
registerCommand(updateUserCommand)
registerCommand(deleteUserCommand)

async function syncUserRoles(em: EntityManager, user: User, desiredRoles: string[], tenantId: string | null) {
  const unique = Array.from(new Set(desiredRoles.map((role) => role.trim()).filter(Boolean)))
  const currentLinks = await em.find(UserRole, { user })
  const currentNames = new Map(
    currentLinks.map((link) => {
      const roleEntity = link.role
      const name = roleEntity?.name ?? ''
      return [name, link] as const
    }),
  )

  for (const [name, link] of currentNames.entries()) {
    if (!unique.includes(name) && link) {
      em.remove(link)
    }
  }

  const normalizedTenantId = normalizeTenantId(tenantId ?? null) ?? null

  for (const name of unique) {
    if (!currentNames.has(name)) {
      let role = await em.findOne(Role, { name, tenantId: normalizedTenantId })
      if (!role && normalizedTenantId !== null) {
        role = await em.findOne(Role, { name, tenantId: null })
      }
      if (!role) {
        role = em.create(Role, { name, tenantId: normalizedTenantId, createdAt: new Date() })
        await em.persistAndFlush(role)
      } else if (normalizedTenantId !== null && role.tenantId !== normalizedTenantId) {
        role.tenantId = normalizedTenantId
        await em.persistAndFlush(role)
      }
      em.persist(em.create(UserRole, { user, role, createdAt: new Date() }))
    }
  }

  await em.flush()
}

async function loadUserRoleNames(em: EntityManager, userId: string): Promise<string[]> {
  const links = await findWithDecryption(
    em,
    UserRole,
    { user: userId as unknown as User },
    { populate: ['role'] },
    { tenantId: null, organizationId: null },
  )
  const names = links
    .map((link) => link.role?.name ?? '')
    .filter((name): name is string => !!name)
  return Array.from(new Set(names)).sort()
}

function serializeUser(user: User, roles: string[], custom?: Record<string, unknown> | null): SerializedUser {
  const payload: SerializedUser = {
    email: String(user.email ?? ''),
    organizationId: user.organizationId ? String(user.organizationId) : null,
    tenantId: user.tenantId ? String(user.tenantId) : null,
    roles,
    name: user.name ? String(user.name) : null,
    isConfirmed: Boolean(user.isConfirmed),
  }
  if (custom && Object.keys(custom).length) payload.custom = custom
  return payload
}

function captureUserSnapshots(
  user: User,
  roles: string[],
  acls: UserAclSnapshot[] = [],
  custom?: Record<string, unknown> | null
): UserSnapshots {
  return {
    view: serializeUser(user, roles, custom),
    undo: {
      id: String(user.id),
      email: String(user.email ?? ''),
      organizationId: user.organizationId ? String(user.organizationId) : null,
      tenantId: user.tenantId ? String(user.tenantId) : null,
      passwordHash: user.passwordHash ? String(user.passwordHash) : null,
      name: user.name ? String(user.name) : null,
      isConfirmed: Boolean(user.isConfirmed),
      roles: [...roles],
      acls,
      ...(custom && Object.keys(custom).length ? { custom } : {}),
    },
  }
}

async function loadUserAclSnapshots(em: EntityManager, userId: string): Promise<UserAclSnapshot[]> {
  const list = await em.find(UserAcl, { user: userId as unknown as User })
  return list.map((acl) => ({
    tenantId: String(acl.tenantId),
    features: Array.isArray(acl.featuresJson) ? [...acl.featuresJson] : null,
    isSuperAdmin: Boolean(acl.isSuperAdmin),
    organizations: Array.isArray(acl.organizationsJson) ? [...acl.organizationsJson] : null,
  }))
}

async function restoreUserAcls(em: EntityManager, user: User, acls: UserAclSnapshot[]) {
  await em.nativeDelete(UserAcl, { user: String(user.id) })
  for (const acl of acls) {
    const entity = em.create(UserAcl, {
      user,
      tenantId: acl.tenantId,
      featuresJson: acl.features ?? null,
      isSuperAdmin: acl.isSuperAdmin,
      organizationsJson: acl.organizations ?? null,
      createdAt: new Date(),
    })
    em.persist(entity)
  }
  await em.flush()
}

type UndoPayload = { undo?: { before?: UserUndoSnapshot | null; after?: UserUndoSnapshot | null } }

function extractUndoPayload(logEntry: { commandPayload?: unknown }): { before?: UserUndoSnapshot | null; after?: UserUndoSnapshot | null } | null {
  const payload = logEntry?.commandPayload as UndoPayload | undefined
  if (!payload || typeof payload !== 'object') return null
  return payload.undo ?? null
}

async function loadUserCustomSnapshot(
  em: EntityManager,
  id: string,
  tenantId: string | null,
  organizationId: string | null
): Promise<Record<string, unknown>> {
  return await loadCustomFieldSnapshot(em, {
    entityId: E.auth.user,
    recordId: id,
    tenantId,
    organizationId,
  })
}

async function invalidateUserCache(ctx: CommandRuntimeContext, userId: string) {
  try {
    const rbacService = ctx.container.resolve('rbacService') as { invalidateUserCache: (uid: string) => Promise<void> }
    await rbacService.invalidateUserCache(userId)
  } catch {
    // RBAC not available
  }

  try {
    const cache = ctx.container.resolve('cache') as { deleteByTags?: (tags: string[]) => Promise<void> }
    if (cache?.deleteByTags) await cache.deleteByTags([`rbac:user:${userId}`])
  } catch {
    // cache not available
  }
}

function diffRoleChanges(before: string[], after: string[]) {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  const assigned = after.filter((role) => !beforeSet.has(role))
  const revoked = before.filter((role) => !afterSet.has(role))
  return { assigned, revoked }
}

function arrayEquals(left: string[] | undefined, right: string[]): boolean {
  if (!left) return false
  if (left.length !== right.length) return false
  return left.every((value, idx) => value === right[idx])
}

async function throwDuplicateEmailError(): Promise<never> {
  const { translate } = await resolveTranslations()
  const message = translate('auth.users.errors.emailExists', 'Email already in use')
  throw new CrudHttpError(400, {
    error: message,
    fieldErrors: { email: message },
    details: [{ path: ['email'], message, code: 'duplicate', origin: 'validation' }],
  })
}
