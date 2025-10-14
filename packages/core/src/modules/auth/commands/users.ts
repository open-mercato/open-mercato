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
  buildLog: async ({ result, ctx, snapshots }) => {
    const { translate } = await resolveTranslations()
    const current = snapshots.before as SerializedUser | undefined
    const roles = current?.roles ?? (await loadUserRoleNames(ctx.container.resolve<EntityManager>('em'), String(result.id)))
    return {
      actionLabel: translate('auth.audit.users.create', 'Create user'),
      resourceKind: 'auth.user',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      snapshotAfter: serializeUser(result, roles),
    }
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
    return { before: serializeUser(existing, roles) }
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
    const before = snapshots.before as SerializedUser | undefined
    const em = ctx.container.resolve<EntityManager>('em')
    const afterRoles = await loadUserRoleNames(em, String(result.id))
    const after = serializeUser(result, afterRoles)
    const changes = buildChanges(before ?? null, after as Record<string, unknown>, ['email', 'organizationId', 'tenantId'])
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
    }
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
    return { before: serializeUser(existing, roles) }
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
    const before = snapshots.before as SerializedUser | undefined
    const id = requireId(input, 'User id required')
    return {
      actionLabel: translate('auth.audit.users.delete', 'Delete user'),
      resourceKind: 'auth.user',
      resourceId: id,
      snapshotBefore: before ?? null,
      tenantId: before?.tenantId ?? null,
    }
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
  }
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
