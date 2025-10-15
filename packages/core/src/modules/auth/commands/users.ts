import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
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
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { z } from 'zod'

type SerializedUser = {
  email: string
  organizationId: string | null
  tenantId: string | null
  roles: string[]
  name: string | null
  isConfirmed: boolean
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
}

type UserSnapshots = {
  view: SerializedUser
  undo: UserUndoSnapshot
}

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  organizationId: z.string().uuid(),
  roles: z.array(z.string()).optional(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  organizationId: z.string().uuid().optional(),
  roles: z.array(z.string()).optional(),
})

export const userCrudEvents: CrudEventsConfig<User> = {
  module: 'auth',
  entity: 'user',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const userCrudIndexer: CrudIndexerConfig<User> = {
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

const createUserCommand: CommandHandler<Record<string, unknown>, User> = {
  id: 'auth.users.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(createSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')

    const organization = await em.findOne(Organization, { id: parsed.organizationId }, { populate: ['tenant'] })
    if (!organization) throw new CrudHttpError(400, { error: 'Organization not found' })

    const duplicate = await em.findOne(User, { email: parsed.email, deletedAt: null })
    if (duplicate) await throwDuplicateEmailError()

    const { hash } = await import('bcryptjs')
    const passwordHash = await hash(parsed.password, 10)
    const tenantId = organization.tenant?.id ? String(organization.tenant.id) : null

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    let user: User
    try {
      user = await de.createOrmEntity({
        entity: User,
        data: {
          email: parsed.email,
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

    if (Array.isArray(parsed.roles) && parsed.roles.length) {
      await syncUserRoles(em, user, parsed.roles, tenantId)
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

    return user
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    const roles = await loadUserRoleNames(em, String(result.id))
    return serializeUser(result, roles)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = ctx.container.resolve<EntityManager>('em')
    const roles = await loadUserRoleNames(em, String(result.id))
    const snapshot = captureUserSnapshots(result, roles)
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
    const em = ctx.container.resolve<EntityManager>('em')
    await em.nativeDelete(UserAcl, { user: userId })
    await em.nativeDelete(UserRole, { user: userId })
    await em.nativeDelete(Session, { user: userId })
    await em.nativeDelete(PasswordReset, { user: userId })

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await de.deleteOrmEntity({
      entity: User,
      where: { id: userId, deletedAt: null } as FilterQuery<User>,
      soft: false,
    })

    await invalidateUserCache(ctx, userId)
  },
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code === '23505') return true
  const message = typeof (error as { message?: string }).message === 'string' ? (error as { message?: string }).message : ''
  return message.toLowerCase().includes('duplicate key')
}

const updateUserCommand: CommandHandler<Record<string, unknown>, User> = {
  id: 'auth.users.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(updateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(User, { id: parsed.id, deletedAt: null })
    if (!existing) throw new CrudHttpError(404, { error: 'User not found' })
    const roles = await loadUserRoleNames(em, parsed.id)
    const acls = await loadUserAclSnapshots(em, parsed.id)
    return { before: captureUserSnapshots(existing, roles, acls) }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(updateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')

    if (parsed.email !== undefined) {
      const duplicate = await em.findOne(
        User,
        {
          email: parsed.email,
          deletedAt: null,
          id: { $ne: parsed.id } as any,
        } as FilterQuery<User>,
      )
      if (duplicate) await throwDuplicateEmailError()
    }

    let hashed: string | null = null
    if (parsed.password) {
      const { hash } = await import('bcryptjs')
      hashed = await hash(parsed.password, 10)
    }

    let tenantId: string | null | undefined
    if (parsed.organizationId !== undefined) {
      const organization = await em.findOne(Organization, { id: parsed.organizationId }, { populate: ['tenant'] })
      if (!organization) throw new CrudHttpError(400, { error: 'Organization not found' })
      tenantId = organization.tenant?.id ? String(organization.tenant.id) : null
    }

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    let user: User | null
    try {
      user = await de.updateOrmEntity({
        entity: User,
        where: { id: parsed.id, deletedAt: null } as FilterQuery<User>,
        apply: (entity) => {
          if (parsed.email !== undefined) entity.email = parsed.email
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

    await invalidateUserCache(ctx, parsed.id)

    return user
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    const roles = await loadUserRoleNames(em, String(result.id))
    return serializeUser(result, roles)
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const beforeSnapshots = snapshots.before as UserSnapshots | undefined
    const before = beforeSnapshots?.view
    const beforeUndo = beforeSnapshots?.undo ?? null
    const em = ctx.container.resolve<EntityManager>('em')
    const afterRoles = await loadUserRoleNames(em, String(result.id))
    const afterSnapshots = captureUserSnapshots(result, afterRoles)
    const after = afterSnapshots.view
    const changes = buildChanges(before ?? null, after as Record<string, unknown>, ['email', 'organizationId', 'tenantId', 'name', 'isConfirmed'])
    if (before && !arrayEquals(before.roles, afterRoles)) {
      changes.roles = { from: before.roles, to: afterRoles }
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
    if (!before) return
    const userId = before.id
    const em = ctx.container.resolve<EntityManager>('em')
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    const updated = await de.updateOrmEntity({
      entity: User,
      where: { id: userId, deletedAt: null } as FilterQuery<User>,
      apply: (entity) => {
        entity.email = before.email
        entity.organizationId = before.organizationId ?? null
        entity.tenantId = before.tenantId ?? null
        entity.passwordHash = before.passwordHash ?? null
        entity.name = before.name ?? null
        entity.isConfirmed = before.isConfirmed
      },
    })

    if (updated) {
      await syncUserRoles(em, updated, before.roles, before.tenantId)
      await em.flush()
    }

    await invalidateUserCache(ctx, userId)
  },
}

const deleteUserCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, User> = {
  id: 'auth.users.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'User id required')
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(User, { id, deletedAt: null })
    if (!existing) return {}
    const roles = await loadUserRoleNames(em, id)
    const acls = await loadUserAclSnapshots(em, id)
    return { before: captureUserSnapshots(existing, roles, acls) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'User id required')
    const em = ctx.container.resolve<EntityManager>('em')

    await em.nativeDelete(UserAcl, { user: id })
    await em.nativeDelete(UserRole, { user: id })
    await em.nativeDelete(Session, { user: id })
    await em.nativeDelete(PasswordReset, { user: id })

    const de = ctx.container.resolve<DataEngine>('dataEngine')
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
    const em = ctx.container.resolve<EntityManager>('em')
    let user = await em.findOne(User, { id: before.id })
    const de = ctx.container.resolve<DataEngine>('dataEngine')

    if (user) {
      if (user.deletedAt) {
        user.deletedAt = null
      }
      user.email = before.email
      user.organizationId = before.organizationId ?? null
      user.tenantId = before.tenantId ?? null
      user.passwordHash = before.passwordHash ?? null
      user.name = before.name ?? null
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

  for (const name of unique) {
    if (!currentNames.has(name)) {
      let role = await em.findOne(Role, { name })
      if (!role) {
        role = em.create(Role, { name, tenantId })
        await em.persistAndFlush(role)
      }
      em.persist(em.create(UserRole, { user, role }))
    }
  }

  await em.flush()
}

async function loadUserRoleNames(em: EntityManager, userId: string): Promise<string[]> {
  const links = await em.find(UserRole, { user: userId as unknown as User }, { populate: ['role'] })
  const names = links
    .map((link) => link.role?.name ?? '')
    .filter((name): name is string => !!name)
  return Array.from(new Set(names)).sort()
}

function serializeUser(user: User, roles: string[]): SerializedUser {
  return {
    email: String(user.email ?? ''),
    organizationId: user.organizationId ? String(user.organizationId) : null,
    tenantId: user.tenantId ? String(user.tenantId) : null,
    roles,
    name: user.name ? String(user.name) : null,
    isConfirmed: Boolean(user.isConfirmed),
  }
}

function captureUserSnapshots(user: User, roles: string[], acls: UserAclSnapshot[] = []): UserSnapshots {
  return {
    view: serializeUser(user, roles),
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

function arrayEquals(left: string[] | undefined, right: string[]): boolean {
  if (!left) return false
  if (left.length !== right.length) return false
  return left.every((value, idx) => value === right[idx])
}

async function throwDuplicateEmailError(): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(400, { error: translate('auth.users.errors.emailExists', 'Email already in use') })
}
