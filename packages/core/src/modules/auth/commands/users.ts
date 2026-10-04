import type { CommandHandler, CommandReplayAuthorizationArgs, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
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
import { UniqueConstraintViolationException, LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import {
  User,
  UserRole,
  Role,
  UserAcl,
  Session,
  PasswordReset,
  UserSidebarPreference,
  SidebarVariant,
} from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveOrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { E } from '#generated/entities.ids.generated'
import { z } from 'zod'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
  diffCustomFieldChanges,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { normalizeTenantId } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { computeEmailHash, emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import notificationTypes from '@open-mercato/core/modules/auth/notifications'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { emitAuthEvent } from '@open-mercato/core/modules/auth/events'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import InviteUserEmail from '@open-mercato/core/modules/auth/emails/InviteUserEmail'
import { INVITE_TOKEN_TTL_MS } from '@open-mercato/core/modules/auth/lib/inviteToken'
import { getSecurityEmailBaseUrl } from '@open-mercato/shared/lib/url'
import { generateAuthToken, hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { normalizeDisplayNameInput } from '@open-mercato/core/modules/auth/lib/displayName'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  assertActorCanAssignUserDestination,
  assertActorCanAccessUserTarget,
  assertActorCanGrantAcl,
  assertActorCanGrantRoleTokens,
  assertActorCanModifySuperAdminUserTarget,
  resolveUserDestinationRoles,
  throwUserDestinationOrganizationNotFound,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  assertReplaySnapshotMatches,
  denyCredentialReplay,
  extractStoredReplayInput,
  hasStoredPasswordInput,
  lockAuthorizationRoleRows,
  lockAuthorizationUserRows,
  lockReplayAuthorizationState,
  rerunReplayTransactionGuardAfterLocks,
  requireCurrentReplayFeature,
  requireTransactionalReplayEntityManager,
} from '@open-mercato/core/modules/auth/lib/commandReplay'

const logger = createLogger('auth').child({ component: 'users-commands' })
const USER_REDO_LOG = Symbol('auth.users.redoLog')

type UserReplayRuntimeContext = CommandRuntimeContext & {
  [USER_REDO_LOG]?: CommandUndoLogEntry
}

function withUserRedoLog(
  ctx: CommandRuntimeContext,
  logEntry: CommandUndoLogEntry,
): UserReplayRuntimeContext {
  return { ...ctx, [USER_REDO_LOG]: logEntry }
}

function resolveCommandEm(ctx: CommandRuntimeContext, forkWhenUnbound = false): EntityManager {
  if (ctx.transactionalEm) return ctx.transactionalEm
  const em = ctx.container.resolve('em') as EntityManager
  return forkWhenUnbound ? em.fork() : em
}

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
  passwordHash?: string | null
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

function resolveActorTenantScope(ctx: CommandRuntimeContext): string | null {
  if (ctx.systemActor === true) return null
  const auth = ctx.auth
  if (!auth) return null
  if ((auth as { isSuperAdmin?: boolean }).isSuperAdmin === true) return null
  const actorTenantId = normalizeTenantId(auth.tenantId ?? null) ?? null
  return actorTenantId
}

function assertTargetTenantInScope(actorTenantScope: string | null, targetTenantId: unknown, notFoundError: string): void {
  if (!actorTenantScope) return
  const targetTenant = normalizeTenantId(targetTenantId) ?? null
  if (!targetTenant || targetTenant !== actorTenantScope) {
    throw new CrudHttpError(404, { error: notFoundError })
  }
}

const passwordSchema = buildPasswordSchema()

const displayNameSchema = z.preprocess(
  normalizeDisplayNameInput,
  z.string().trim().min(1).max(120).nullable().optional(),
)

const createSchema = z.object({
  email: z.string().email(),
  name: displayNameSchema,
  password: passwordSchema.optional(),
  sendInviteEmail: z.boolean().optional(),
  organizationId: z.string().uuid(),
  roles: z.array(z.string()).optional(),
}).refine(
  (data) => data.password || data.sendInviteEmail,
  { message: 'Either password or sendInviteEmail is required', path: ['password'] },
)

const updateSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  name: displayNameSchema,
  password: passwordSchema.optional(),
  organizationId: z.string().uuid().optional(),
  roles: z.array(z.string()).optional(),
  isConfirmed: z.boolean().optional(),
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
    logger.error('Failed to create notification', { err })
  }
}

type CreateUserResult = { user: User; warning?: 'invite_email_failed' }

const createUserCommand: CommandHandler<Record<string, unknown>, CreateUserResult> = {
  id: 'auth.users.create',
  atomicReplay: true,
  authorizeReplay: (params) => authorizeUserReplay('create', params),
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(createSchema, rawInput)
    const em = resolveCommandEm(ctx)

    const organization = await findOneWithDecryption(
      em,
      Organization,
      { id: parsed.organizationId },
      { populate: ['tenant'] },
      { tenantId: null, organizationId: parsed.organizationId },
    )
    if (!organization) throw new CrudHttpError(400, { error: 'Organization not found' })
    const tenantId = organization.tenant?.id ? String(organization.tenant.id) : null
    assertTargetTenantInScope(resolveActorTenantScope(ctx), tenantId, 'Organization not found')

    const emailHash = computeEmailHash(parsed.email)
    // Email is unique per-tenant, not globally (see Migration20260610120000:
    // users_tenant_email_hash_uniq). Scope the duplicate check to the target tenant so the same
    // email may legitimately exist in other tenants without blocking creation or leaking
    // cross-tenant account existence (#2934).
    const duplicate = await findOneWithDecryption(em, User, { $or: [{ email: parsed.email }, { emailHash: { $in: emailHashLookupValues(parsed.email) } }], deletedAt: null, tenantId } as any, {}, { tenantId: null, organizationId: null })
    if (duplicate) await throwDuplicateEmailError()

    let passwordHash: string | null = null
    if (parsed.password) {
      const { hash } = await import('bcryptjs')
      passwordHash = await hash(parsed.password, 10)
    }

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    let user: User
    try {
      user = await de.createOrmEntity({
        entity: User,
        data: {
          email: parsed.email,
          name: parsed.name,
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
      await withAtomicFlush(em, [
        async () => syncUserRoles(em, user, parsed.roles ?? [], tenantId),
      ], { transaction: true, label: 'auth.users.create.roles' })
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

    let inviteEmailSent = false
    if (parsed.sendInviteEmail) {
      const inviteResult = await sendInviteToUser(em, user)
      inviteEmailSent = inviteResult.emailSent
    }

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

    if (assignedRoles.length && !parsed.sendInviteEmail) {
      await notifyRoleChanges(ctx, user, assignedRoles, [])
    }

    const warning = (parsed.sendInviteEmail && !inviteEmailSent) ? 'invite_email_failed' as const : undefined

    return { user, warning }
  },
  captureAfter: async (_input, { user }, ctx) => {
    const em = resolveCommandEm(ctx, true)
    const roles = await loadUserRoleNames(em, String(user.id))
    const custom = await loadUserCustomSnapshot(
      em,
      String(user.id),
      user.tenantId ? String(user.tenantId) : null,
      user.organizationId ? String(user.organizationId) : null
    )
    return serializeUser(user, roles, custom)
  },
  buildLog: async ({ input, result: { user }, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = resolveCommandEm(ctx, true)
    const roles = await loadUserRoleNames(em, String(user.id))
    const custom = await loadUserCustomSnapshot(
      em,
      String(user.id),
      user.tenantId ? String(user.tenantId) : null,
      user.organizationId ? String(user.organizationId) : null
    )
    const snapshot = captureUserSnapshots(user, roles, undefined, custom)
    const replayable = typeof input.password !== 'string' || input.password.length === 0
    return {
      replayable,
      actionLabel: translate('auth.audit.users.create', 'Create user'),
      resourceKind: 'auth.user',
      resourceId: String(user.id),
      tenantId: user.tenantId ? String(user.tenantId) : null,
      organizationId: user.organizationId ? String(user.organizationId) : null,
      snapshotAfter: snapshot.view,
      payload: replayable
        ? {
            undo: {
              after: snapshot.undo,
            },
          }
        : undefined,
    }
  },
  undo: async ({ input, logEntry, ctx }) => {
    const userId = typeof logEntry?.resourceId === 'string' ? logEntry.resourceId : null
    if (!userId) return
    const snapshot = logEntry?.snapshotAfter as SerializedUser | undefined
    const em = resolveCommandEm(ctx)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)

    // Evaluate the floor against the user's CURRENT tenant, not the one recorded at
    // creation. A user moved to another tenant after being created would otherwise be
    // checked against the origin tenant — where they no longer hold anything — and the
    // undo would hard-delete the destination tenant's last administrator unchecked.
    // The create snapshot is only a fallback for a row that is already gone.
    let removed: User | null = null
    await withAtomicFlush(em, [
      async () => {
        await authorizeUserReplayAtMutation('create', {
          operation: 'undo',
          input,
          ctx,
          logEntry,
        })
        const current = await findOneWithDecryption(em, User, { id: userId, deletedAt: null }, {}, { tenantId: null, organizationId: null })
        const floorTenantId = current?.tenantId ? String(current.tenantId) : (snapshot?.tenantId ?? null)

        // Undoing a create hard-deletes the user, so it can strip a tenant's last active
        // admin exactly like `auth.users.delete` can — promote a second admin, delete the
        // first, then undo the promotion's create. Same guard applies.
        await enforceProtectedRoleFloor(em, floorTenantId, userId, { deleting: true }, ctx)

        await em.nativeDelete(UserAcl, { user: userId })
        await em.nativeDelete(UserRole, { user: userId })
        await em.nativeDelete(Session, { user: userId })
        await em.nativeDelete(PasswordReset, { user: userId })
        await em.nativeDelete(UserSidebarPreference, { user: userId })
        await em.nativeDelete(SidebarVariant, { user: userId })

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
        removed = await de.deleteOrmEntity({
          entity: User,
          where: { id: userId, deletedAt: null } as FilterQuery<User>,
          soft: false,
        })
      },
    ], { transaction: true, label: 'auth.users.create.undo' })

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
  // Password-bearing creates are audit-only. Redo therefore reaches this handler
  // only for credential-free creates and restores the original stable id (#2506).
  redo: async ({ input, logEntry, ctx }) => {
    const after = resolveRedoSnapshot<UserUndoSnapshot>(logEntry)
    if (!after) throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for user create' })
    const em = resolveCommandEm(ctx)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const emailHash = computeEmailHash(after.email)

    let user: User | null = null
    await withAtomicFlush(em, [
      async () => {
        await authorizeUserReplayAtMutation('create', {
          operation: 'redo',
          input,
          ctx,
          logEntry,
        })
        user = await findOneWithDecryption(em, User, { id: after.id }, {}, { tenantId: null, organizationId: null })
        if (user) {
          user.deletedAt = null
          user.email = after.email
          user.emailHash = emailHash
          user.organizationId = after.organizationId ?? null
          user.tenantId = after.tenantId ?? null
          user.passwordHash = after.passwordHash ?? null
          user.name = after.name ?? null
          user.isConfirmed = after.isConfirmed
          await em.flush()
        } else {
          user = await de.createOrmEntity({
            entity: User,
            data: {
              id: after.id,
              email: after.email,
              emailHash,
              organizationId: after.organizationId ?? null,
              tenantId: after.tenantId ?? null,
              passwordHash: after.passwordHash ?? null,
              name: after.name ?? null,
              isConfirmed: after.isConfirmed,
            },
          })
        }

        if (!user) return

        await em.nativeDelete(UserRole, { user: after.id })
        await syncUserRoles(em, user, after.roles, after.tenantId)
        await restoreUserAcls(em, user, after.acls)

        if (after.custom && Object.keys(after.custom).length) {
          const reset = buildCustomFieldResetMap(after.custom, undefined)
          if (Object.keys(reset).length) {
            await setCustomFieldsIfAny({
              dataEngine: de,
              entityId: E.auth.user,
              recordId: after.id,
              organizationId: after.organizationId ?? null,
              tenantId: after.tenantId ?? null,
              values: reset,
              notify: false,
            })
          }
        }
      },
    ], { transaction: true })

    if (!user) throw new CrudHttpError(400, { error: '[internal] redo failed to restore user row' })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: user,
      identifiers: {
        id: after.id,
        organizationId: after.organizationId ?? null,
        tenantId: after.tenantId ?? null,
      },
      events: userCrudEvents,
      indexer: userCrudIndexer,
    })

    await invalidateUserCache(ctx, after.id)

    return { user }
  },
}

async function sendInviteToUser(
  em: EntityManager,
  user: User,
): Promise<{ emailSent: boolean }> {
  const rawToken = generateAuthToken()
  const tokenHash = hashAuthToken(rawToken)
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS)
  const row = em.create(PasswordReset, { user, token: tokenHash, expiresAt, createdAt: new Date() })
  await em.persist(row).flush()

  const base = getSecurityEmailBaseUrl()
  const inviteUrl = `${base}/reset/${rawToken}`

  const { translate } = await resolveTranslations()
  const subject = translate('auth.email.invite.subject', 'You have been invited')
  const copy = {
    preview: translate('auth.email.invite.preview', 'Set up your account'),
    title: translate('auth.email.invite.title', 'You have been invited'),
    body: translate('auth.email.invite.body', 'An administrator has created an account for you. Click the link below to set your password. This link will expire in 48 hours.'),
    cta: translate('auth.email.invite.cta', 'Set up your password'),
    hint: translate('auth.email.invite.hint', 'If you did not expect this invitation, you can safely ignore this email.'),
  }

  let emailSent = true
  try {
    await sendEmail({
      to: user.email,
      subject,
      react: InviteUserEmail({ inviteUrl, copy }),
      tenantId: user.tenantId ? String(user.tenantId) : undefined,
      organizationId: user.organizationId ? String(user.organizationId) : null,
    })
  } catch (err) {
    logger.error('Failed to send invitation email', { err })
    emailSent = false
  }

  return { emailSent }
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
  atomicReplay: true,
  authorizeReplay: (params) => authorizeUserReplay('update', params),
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(updateSchema, rawInput)
    const em = resolveCommandEm(ctx)
    const existing = await findOneWithDecryption(em, User, { id: parsed.id, deletedAt: null }, {}, { tenantId: null, organizationId: null })
    if (!existing) throw new CrudHttpError(404, { error: 'User not found' })
    assertTargetTenantInScope(resolveActorTenantScope(ctx), existing.tenantId, 'User not found')
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
    const em = resolveCommandEm(ctx)
    const actorTenantScope = resolveActorTenantScope(ctx)
    const existing = await findOneWithDecryption(em, User, { id: parsed.id, deletedAt: null }, {}, { tenantId: null, organizationId: null })
    if (!existing) throw new CrudHttpError(404, { error: 'User not found' })
    if (actorTenantScope && existing.tenantId && String(existing.tenantId) !== actorTenantScope) {
      throw new CrudHttpError(404, { error: 'User not found' })
    }

    const rolesBefore = Array.isArray(parsed.roles)
      ? await loadUserRoleNames(em, parsed.id)
      : null

    let tenantId: string | null | undefined
    let destinationChanged = false
    if (parsed.organizationId !== undefined) {
      const organization = await findOneWithDecryption(
        em,
        Organization,
        { id: parsed.organizationId },
        { populate: ['tenant'] },
        { tenantId: null, organizationId: parsed.organizationId ?? null },
      )
      if (!organization) return throwUserDestinationOrganizationNotFound(400)
      tenantId = organization.tenant?.id ? String(organization.tenant.id) : null
      if (!tenantId) return throwUserDestinationOrganizationNotFound(400)
      const currentUser = await findOneWithDecryption(
        em,
        User,
        { id: parsed.id, deletedAt: null },
        {},
        { tenantId: null, organizationId: null },
      )
      if (!currentUser) throw new CrudHttpError(404, { error: 'User not found' })
      const currentOrganizationId = currentUser.organizationId ? String(currentUser.organizationId) : null
      const currentTenantId = currentUser.tenantId ? String(currentUser.tenantId) : null
      destinationChanged = currentOrganizationId !== parsed.organizationId || currentTenantId !== tenantId
      if (destinationChanged) {
        const rbacService = ctx.container.resolve('rbacService') as RbacService
        const destinationRoles = await resolveUserDestinationRoles({
          em,
          targetUserId: parsed.id,
          destinationTenantId: tenantId,
          roleTokens: parsed.roles,
        })
        const actorIsSuperAdmin = ctx.systemActor === true || ctx.auth?.isSuperAdmin === true
        const organizationScope = ctx.organizationScope?.tenantId === tenantId
          ? ctx.organizationScope
          : !actorIsSuperAdmin && ctx.auth?.sub
            ? await resolveOrganizationScope({
                em,
                rbac: rbacService,
                auth: ctx.auth,
                tenantId,
              })
            : null
        await assertActorCanAssignUserDestination({
          em,
          rbacService,
          actorUserId: ctx.auth?.sub,
          actorIsSuperAdmin,
          tenantId: ctx.auth?.tenantId ?? null,
          organizationId: ctx.auth?.orgId ?? null,
          allowedOrganizationIds: organizationScope?.allowedIds,
          destinationTenantId: tenantId,
          destinationOrganizationId: parsed.organizationId,
          roles: destinationRoles,
        })
      }
    }

    const userTenantId = existing.tenantId ? String(existing.tenantId) : null
    const targetTenantId = tenantId !== undefined ? tenantId : userTenantId
    const isTenantChanging = targetTenantId !== userTenantId

    // Hash password BEFORE transaction begins to avoid holding locks during CPU-heavy tasks
    let hashed: string | null = null
    let emailHash: string | null = null
    if (parsed.password) {
      const { hash } = await import('bcryptjs')
      hashed = await hash(parsed.password, 10)
    }
    if (parsed.email !== undefined) {
      emailHash = computeEmailHash(parsed.email)
    }

    const updateWhere: Record<string, unknown> = { id: parsed.id, deletedAt: null }
    if (actorTenantScope) updateWhere.tenantId = actorTenantScope

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    let user!: User

    await withAtomicFlush(em, [
      async () => {
        const redoLogEntry = (ctx as UserReplayRuntimeContext)[USER_REDO_LOG]
        if (redoLogEntry) {
          await authorizeUserReplayAtMutation('update', {
            operation: 'redo',
            input: rawInput,
            ctx,
            logEntry: redoLogEntry,
          })
        }
        await lockAuthorizationUserRows(em, [parsed.id])
        // Floor check must run inside the transaction so that LockMode.PESSIMISTIC_WRITE locks Role rows properly
        await enforceProtectedRoleFloor(em, userTenantId, parsed.id, {
          deactivating: parsed.isConfirmed === false || isTenantChanging,
          newRoles: parsed.roles,
        }, ctx)

        // Email is unique per-tenant, not globally (see Migration20260610120000:
        // users_tenant_email_hash_uniq) — a matching email in another tenant must not block
        // the update or leak cross-tenant account existence (#2934). `targetTenantId` is the
        // tenant the user will belong to after this update, so the check follows a move.
        if (parsed.email !== undefined) {
          const duplicate = await findOneWithDecryption(
            em,
            User,
            {
              $or: [{ email: parsed.email }, { emailHash: { $in: emailHashLookupValues(parsed.email) } }],
              deletedAt: null,
              tenantId: targetTenantId,
              id: { $ne: parsed.id } as any,
            } as FilterQuery<User>,
            {},
            { tenantId: null, organizationId: null },
          )
          if (duplicate) await throwDuplicateEmailError()
        }

        try {
          const updated = await de.updateOrmEntity({
            entity: User,
            where: updateWhere as FilterQuery<User>,
            apply: (entity) => {
              if (parsed.email !== undefined) {
                entity.email = parsed.email
                entity.emailHash = emailHash
              }
              if (parsed.name !== undefined) {
                entity.name = parsed.name
              }
              if (parsed.organizationId !== undefined) {
                entity.organizationId = parsed.organizationId
                entity.tenantId = tenantId ?? null
              }
              if (parsed.isConfirmed !== undefined) {
                entity.isConfirmed = parsed.isConfirmed
              }
              if (hashed) entity.passwordHash = hashed
            },
          })
          if (updated) user = updated
        } catch (error) {
          if (isUniqueViolation(error)) await throwDuplicateEmailError()
          throw error
        }
        if (!user) throw new CrudHttpError(404, { error: 'User not found' })

        if (hashed || parsed.isConfirmed === false) {
          await em.nativeDelete(Session, { user: parsed.id })
        }

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
      }
    ], { transaction: true, label: destinationChanged ? 'auth.users.update.destination' : 'auth.users.update' })

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

    if (hashed) {
      const actorId = ctx.auth?.sub ? String(ctx.auth.sub) : null
      // `system` covers a command invocation with no auth context and one running under
      // `ctx.systemActor`. Without it those writes would be indistinguishable from an
      // administrator setting someone else's password, which is exactly the case security
      // alerting escalates on. Password writes that never reach this command — `mercato
      // auth set-password`, tenant provisioning — set `passwordHash` directly and emit
      // nothing, so a subscriber cannot treat this event as covering every credential change.
      const changedBy = ctx.systemActor === true || !actorId
        ? 'system'
        : actorId === identifiers.id ? 'self' : 'admin'
      void emitAuthEvent('auth.password.changed', {
        id: identifiers.id,
        tenantId: identifiers.tenantId,
        organizationId: identifiers.organizationId,
        changedBy,
        changedById: actorId,
        at: new Date().toISOString(),
      }, { persistent: true }).catch(() => undefined)
    }

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
    const em = resolveCommandEm(ctx, true)
    const roles = await loadUserRoleNames(em, String(result.id))
    const custom = await loadUserCustomSnapshot(
      em,
      String(result.id),
      result.tenantId ? String(result.tenantId) : null,
      result.organizationId ? String(result.organizationId) : null
    )
    return serializeUser(result, roles, custom)
  },
  buildLog: async ({ input, result, snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const beforeSnapshots = snapshots.before as UserSnapshots | undefined
    const before = beforeSnapshots?.view
    const beforeUndo = beforeSnapshots?.undo ?? null
    const em = resolveCommandEm(ctx, true)
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
    const replayable = typeof input.password !== 'string' || input.password.length === 0
    return {
      replayable,
      actionLabel: translate('auth.audit.users.update', 'Update user'),
      resourceKind: 'auth.user',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      organizationId: result.organizationId ? String(result.organizationId) : null,
      changes,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: replayable
        ? {
            undo: {
              before: withoutPasswordHash(beforeUndo),
              after: withoutPasswordHash(afterSnapshots.undo),
            },
          }
        : undefined,
    }
  },
  undo: async ({ input, logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<UserUndoSnapshot>>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before) return
    const userId = before.id
    const storedReplayInput = extractStoredReplayInput(logEntry.commandPayload, logEntry)
    const replayInput = Object.keys(storedReplayInput).length
      ? storedReplayInput
      : deriveUserUpdateReplayInput(before, after ?? null)
    const em = resolveCommandEm(ctx)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)

    // Reverting an update can drop the tenant below a protected role's floor just as the
    // forward path can — restoring an empty `before.roles` on what is now the last admin,
    // or restoring `isConfirmed: false`. Undo is reachable from the audit-log UI, so the
    // guard has to run here too, inside a transaction so the row lock is valid.
    const restoredTenantId = before.tenantId ? String(before.tenantId) : null

    let updated: User | null = null
    await withAtomicFlush(em, [
      async () => {
        await authorizeUserReplayAtMutation('update', {
          operation: 'undo',
          input,
          ctx,
          logEntry,
        })
        const current = await findOneWithDecryption(em, User, { id: userId, deletedAt: null }, {}, { tenantId: null, organizationId: null })
        const currentTenantId = current?.tenantId ? String(current.tenantId) : null

        await enforceProtectedRoleFloor(em, currentTenantId, userId, {
          deactivating:
            ('isConfirmed' in replayInput && before.isConfirmed === false)
            || ('organizationId' in replayInput && restoredTenantId !== currentTenantId),
          newRoles: Array.isArray(replayInput.roles) ? before.roles : undefined,
        }, ctx)

        updated = await de.updateOrmEntity({
          entity: User,
          where: { id: userId, deletedAt: null } as FilterQuery<User>,
          apply: (entity) => {
            if ('email' in replayInput) entity.email = before.email
            if ('organizationId' in replayInput) {
              entity.organizationId = before.organizationId ?? null
              entity.tenantId = before.tenantId ?? null
            }
            if ('name' in replayInput) entity.name = before.name ?? null
            if ('isConfirmed' in replayInput) entity.isConfirmed = before.isConfirmed
          },
        })

        if (updated && Array.isArray(replayInput.roles)) {
          await syncUserRoles(em, updated, before.roles, before.tenantId)
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
      },
    ], { transaction: true, label: 'auth.users.update.undo' })

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
  redo: ({ input, ctx, logEntry }) => updateUserCommand.execute(
    input,
    withUserRedoLog(ctx, logEntry),
  ),
}

const deleteUserCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, User> = {
  id: 'auth.users.delete',
  atomicReplay: true,
  authorizeReplay: (params) => authorizeUserReplay('delete', params),
  async prepare(input, ctx) {
    const id = requireId(input, 'User id required')
    const em = resolveCommandEm(ctx)
    const existing = await findOneWithDecryption(em, User, { id, deletedAt: null }, {}, { tenantId: null, organizationId: null })
    if (!existing) return {}
    const actorTenantScope = resolveActorTenantScope(ctx)
    if (actorTenantScope) {
      const targetTenant = normalizeTenantId(existing.tenantId) ?? null
      if (!targetTenant || targetTenant !== actorTenantScope) return {}
    }
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
    const em = resolveCommandEm(ctx)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const actorTenantScope = resolveActorTenantScope(ctx)

    const existing = await findOneWithDecryption(em, User, { id, deletedAt: null }, {}, { tenantId: null, organizationId: null })
    if (!existing) throw new CrudHttpError(404, { error: 'User not found' })
    if (actorTenantScope && existing.tenantId && String(existing.tenantId) !== actorTenantScope) {
      throw new CrudHttpError(404, { error: 'User not found' })
    }

    const deleteWhere: Record<string, unknown> = { id, deletedAt: null }
    if (actorTenantScope) deleteWhere.tenantId = actorTenantScope

    let user!: User
    await withAtomicFlush(em, [
      async () => {
        const redoLogEntry = (ctx as UserReplayRuntimeContext)[USER_REDO_LOG]
        if (redoLogEntry) {
          await authorizeUserReplayAtMutation('delete', {
            operation: 'redo',
            input,
            ctx,
            logEntry: redoLogEntry,
          })
        }
        await lockAuthorizationUserRows(em, [id])
        const userTenantId = existing.tenantId ? String(existing.tenantId) : null
        await enforceProtectedRoleFloor(em, userTenantId, id, { deleting: true }, ctx)

        await em.nativeDelete(UserAcl, { user: id })
        await em.nativeDelete(UserRole, { user: id })
        await em.nativeDelete(Session, { user: id })
        await em.nativeDelete(PasswordReset, { user: id })
        await em.nativeDelete(UserSidebarPreference, { user: id })
        await em.nativeDelete(SidebarVariant, { user: id })
        const removed = await de.deleteOrmEntity({
          entity: User,
          where: deleteWhere as FilterQuery<User>,
          soft: false,
        })
        if (!removed) throw new CrudHttpError(404, { error: 'User not found' })
        user = removed
      },
    ], { transaction: true })

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
      organizationId: before?.organizationId ?? null,
      payload: {
        undo: {
          before: beforeUndo,
        },
      },
    }
  },
  undo: async ({ input, logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<UserUndoSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = resolveCommandEm(ctx)
    let user: User | null = null
    const de = (ctx.container.resolve('dataEngine') as DataEngine)

    await withAtomicFlush(em, [
      async () => {
        await authorizeUserReplayAtMutation('delete', {
          operation: 'undo',
          input,
          ctx,
          logEntry,
        })
        user = await findOneWithDecryption(em, User, { id: before.id }, {}, { tenantId: null, organizationId: null })
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
      },
    ], { transaction: true })

    await invalidateUserCache(ctx, before.id)
  },
  redo: ({ input, ctx, logEntry }) => deleteUserCommand.execute(
    input,
    withUserRedoLog(ctx, logEntry),
  ),
}

type UserReplayCommandKind = 'create' | 'update' | 'delete'

function withoutPasswordHash(snapshot: UserUndoSnapshot | null): UserUndoSnapshot | null {
  if (!snapshot) return null
  const safeSnapshot = { ...snapshot }
  delete safeSnapshot.passwordHash
  return safeSnapshot
}

function normalizeUserAclSnapshots(acls: UserAclSnapshot[]): UserAclSnapshot[] {
  return acls
    .map((acl) => ({
      ...acl,
      features: acl.features ? [...acl.features].sort((left, right) => left.localeCompare(right)) : null,
      organizations: acl.organizations ? [...acl.organizations].sort((left, right) => left.localeCompare(right)) : null,
    }))
    .sort((left, right) => left.tenantId.localeCompare(right.tenantId))
}

function normalizeUserReplaySnapshot(snapshot: UserUndoSnapshot): UserUndoSnapshot {
  return {
    ...snapshot,
    roles: [...snapshot.roles].sort((left, right) => left.localeCompare(right)),
    acls: normalizeUserAclSnapshots(snapshot.acls),
  }
}

function toUserUpdateReplayState(snapshot: UserUndoSnapshot): SerializedUser {
  return {
    email: snapshot.email,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    roles: [...snapshot.roles].sort((left, right) => left.localeCompare(right)),
    name: snapshot.name,
    isConfirmed: snapshot.isConfirmed,
    ...(snapshot.custom && Object.keys(snapshot.custom).length ? { custom: snapshot.custom } : {}),
  }
}

function deriveUserUpdateReplayInput(
  before: UserUndoSnapshot | null,
  after: UserUndoSnapshot | null,
): Record<string, unknown> {
  if (!before) return {}
  if (!after) {
    return {
      id: before.id,
      email: before.email,
      organizationId: before.organizationId,
      name: before.name,
      isConfirmed: before.isConfirmed,
      roles: before.roles,
    }
  }
  const input: Record<string, unknown> = { id: after.id }
  if (before.email !== after.email) input.email = after.email
  if (before.organizationId !== after.organizationId || before.tenantId !== after.tenantId) {
    input.organizationId = after.organizationId
  }
  if (before.name !== after.name) input.name = after.name
  if (before.isConfirmed !== after.isConfirmed) input.isConfirmed = after.isConfirmed
  if (!arrayEquals(before.roles, after.roles)) input.roles = after.roles
  return input
}

function isSelfProfileReplay(
  input: Record<string, unknown>,
  ctx: CommandRuntimeContext,
  userId: string,
): boolean {
  if (!ctx.auth?.sub || ctx.auth.sub !== userId) return false
  const allowedKeys = new Set(['id', 'email', 'password'])
  return Object.keys(input).every((key) => allowedKeys.has(key) || input[key] === undefined)
}

async function authorizeUserReplay(
  commandKind: UserReplayCommandKind,
  params: CommandReplayAuthorizationArgs<unknown>,
): Promise<void> {
  const { operation, ctx, logEntry } = params
  const undoPayload = extractUndoPayload<UndoPayload<UserUndoSnapshot>>(logEntry)
  const before = undoPayload?.before ?? null
  const after = undoPayload?.after ?? null
  const passwordHashChanged = Boolean(
    commandKind === 'update'
      && before
      && after
      && 'passwordHash' in before
      && 'passwordHash' in after
      && before.passwordHash !== after.passwordHash,
  )
  const createdWithPassword = commandKind === 'create' && Boolean(
    hasStoredPasswordInput(params.input, logEntry)
      || (after && typeof after.passwordHash === 'string' && after.passwordHash.length > 0),
  )
  if (
    createdWithPassword
    || (commandKind === 'update' && (hasStoredPasswordInput(params.input, logEntry) || passwordHashChanged))
  ) {
    await denyCredentialReplay()
  }
  const userId = logEntry.resourceId ?? before?.id ?? after?.id ?? null
  if (!userId) {
    await assertReplaySnapshotMatches(null, { required: 'user replay snapshot' })
    return
  }

  const storedReplayInput = extractStoredReplayInput(params.input, logEntry)
  const replayInput = Object.keys(storedReplayInput).length
    ? storedReplayInput
    : deriveUserUpdateReplayInput(before, after)
  const requiredFeature = commandKind === 'create'
    ? operation === 'undo' ? 'auth.users.delete' : 'auth.users.create'
    : commandKind === 'delete'
      ? operation === 'undo' ? 'auth.users.create' : 'auth.users.delete'
      : 'auth.users.edit'
  const em = requireTransactionalReplayEntityManager(ctx)
  if (commandKind !== 'update' || !isSelfProfileReplay(replayInput, ctx, userId)) {
    await requireCurrentReplayFeature(ctx, requiredFeature)
  }

  const currentUser = await findOneWithDecryption(
    em,
    User,
    { id: userId, deletedAt: null },
    {},
    { tenantId: null, organizationId: null },
  )
  const rbacService = ctx.systemActor === true
    ? null
    : ctx.container.resolve('rbacService') as RbacService

  if (rbacService && currentUser) {
    const allowedIds = ctx.organizationScope?.allowedIds
      ?? ctx.organizationIds
      ?? (ctx.auth?.orgId ? [ctx.auth.orgId] : null)
    await assertActorCanAccessUserTarget({
      em,
      rbacService,
      requireBoundRbac: true,
      actorUserId: ctx.auth?.sub,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.auth?.orgId ?? null,
      organizationScope: { allowedIds },
      targetUserId: userId,
    })
    await assertActorCanModifySuperAdminUserTarget({
      em,
      rbacService,
      requireBoundRbac: true,
      actorUserId: ctx.auth?.sub,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.auth?.orgId ?? null,
      targetUserId: userId,
    })
  }

  let currentSnapshot: UserUndoSnapshot | null = null
  if (currentUser) {
    const currentTenantId = currentUser.tenantId ? String(currentUser.tenantId) : null
    const currentOrganizationId = currentUser.organizationId ? String(currentUser.organizationId) : null
    const [roles, acls, custom] = await Promise.all([
      loadUserRoleNames(em, userId),
      loadUserAclSnapshots(em, userId),
      loadUserCustomSnapshot(em, userId, currentTenantId, currentOrganizationId),
    ])
    currentSnapshot = captureUserSnapshots(currentUser, roles, acls, custom).undo
  }

  const expectedCurrent = operation === 'undo'
    ? commandKind === 'create' ? after : commandKind === 'update' ? after : null
    : commandKind === 'create' ? null : before

  if (commandKind === 'update') {
    if (!currentSnapshot || !expectedCurrent) {
      await assertReplaySnapshotMatches(currentSnapshot, expectedCurrent)
    } else {
      await assertReplaySnapshotMatches(
        toUserUpdateReplayState(currentSnapshot),
        toUserUpdateReplayState(expectedCurrent),
      )
    }
  } else {
    await assertReplaySnapshotMatches(
      currentSnapshot ? normalizeUserReplaySnapshot(currentSnapshot) : null,
      expectedCurrent ? normalizeUserReplaySnapshot(expectedCurrent) : null,
    )
  }

  const desiredState = operation === 'undo'
    ? commandKind === 'create' ? null : before
    : commandKind === 'delete' ? null : after
  if (!desiredState || !rbacService) return

  const restoresMembership = commandKind !== 'update'
    || Array.isArray(replayInput.roles)
    || 'organizationId' in replayInput
  if (restoresMembership) {
    const roles = await assertActorCanGrantRoleTokens({
      em,
      rbacService,
      requireBoundRbac: true,
      actorUserId: ctx.auth?.sub,
      tenantId: desiredState.tenantId,
      organizationId: desiredState.organizationId,
      roleTokens: desiredState.roles,
    })
    await assertActorCanAssignUserDestination({
      em,
      rbacService,
      requireBoundRbac: true,
      actorUserId: ctx.auth?.sub,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.auth?.orgId ?? null,
      allowedOrganizationIds: ctx.organizationScope?.allowedIds ?? ctx.organizationIds,
      destinationTenantId: desiredState.tenantId,
      destinationOrganizationId: desiredState.organizationId,
      roles,
    })
  }

  const restoresAcls = commandKind !== 'update' && desiredState.acls.length > 0
  if (!restoresAcls) return
  await requireCurrentReplayFeature(ctx, 'auth.acl.manage')
  for (const acl of desiredState.acls) {
    await assertActorCanGrantAcl({
      em,
      rbacService,
      requireBoundRbac: true,
      actorUserId: ctx.auth?.sub,
      tenantId: acl.tenantId,
      organizationId: desiredState.organizationId,
      features: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
      organizations: acl.organizations,
    })
  }
}

async function authorizeUserReplayAtMutation(
  commandKind: UserReplayCommandKind,
  params: CommandReplayAuthorizationArgs<unknown>,
): Promise<void> {
  const undoPayload = extractUndoPayload<UndoPayload<UserUndoSnapshot>>(params.logEntry)
  const targetUserId = params.logEntry.resourceId
    ?? undoPayload?.before?.id
    ?? undoPayload?.after?.id
    ?? null
  const em = params.ctx.transactionalEm
    ?? params.ctx.container.resolve('em') as EntityManager
  const boundParams = params.ctx.transactionalEm
    ? params
    : { ...params, ctx: { ...params.ctx, transactionalEm: em } }
  await lockReplayAuthorizationState(em, boundParams.ctx, { targetUserId })
  await rerunReplayTransactionGuardAfterLocks(boundParams, em)
  await authorizeUserReplay(commandKind, boundParams)
}

registerCommand(createUserCommand)
registerCommand(updateUserCommand)
registerCommand(deleteUserCommand)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveRole(
  em: EntityManager,
  value: string,
  normalizedTenantId: string | null,
): Promise<Role | null> {
  if (UUID_RE.test(value)) {
    const where: Record<string, unknown> = { id: value }
    if (normalizedTenantId !== null) {
      where.tenantId = normalizedTenantId
    }
    return findOneWithDecryption(em, Role, where as any, {}, { tenantId: normalizedTenantId, organizationId: null })
  }
  return findOneWithDecryption(em, Role, { name: value, tenantId: normalizedTenantId }, {}, { tenantId: normalizedTenantId, organizationId: null })
}

async function syncUserRoles(em: EntityManager, user: User, desiredRoles: string[], tenantId: string | null) {
  const userId = String(user.id)
  await lockAuthorizationUserRows(em, [userId])
  const unique = Array.from(new Set(desiredRoles.map((role) => role.trim()).filter(Boolean)))
  const normalizedTenantId = normalizeTenantId(tenantId ?? null) ?? null

  const resolvedRoles: Role[] = []
  const missingRoles: string[] = []
  for (const value of unique) {
    const role = await resolveRole(em, value, normalizedTenantId)
    if (!role) {
      missingRoles.push(value)
    } else {
      resolvedRoles.push(role)
    }
  }

  if (missingRoles.length) {
    const labels = missingRoles.map((n) => `"${n}"`).join(', ')
    throw new CrudHttpError(400, { error: `Role(s) not found: ${labels}` })
  }

  const discoveredLinks = await findWithDecryption(
    em,
    UserRole,
    { user },
    { orderBy: { id: 'ASC' } },
    { tenantId: null, organizationId: null },
  )
  const discoveredRoleIds = discoveredLinks
    .map((link) => String(link.role?.id ?? (link.role as unknown as string) ?? ''))
    .filter(Boolean)
  const desiredIds = new Set(resolvedRoles.map((role) => String(role.id)))
  await lockAuthorizationRoleRows(em, [...desiredIds, ...discoveredRoleIds])
  const currentLinks = await findWithDecryption(
    em,
    UserRole,
    { user },
    { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
    { tenantId: null, organizationId: null },
  )
  const currentRoleIds = new Map(
    currentLinks.map((link) => {
      const roleId = String(link.role?.id ?? (link.role as unknown as string) ?? '')
      return [roleId, link] as const
    }),
  )

  for (const [roleId, link] of currentRoleIds.entries()) {
    if (!desiredIds.has(roleId) && link) {
      em.remove(link)
    }
  }

  for (const role of resolvedRoles) {
    if (!currentRoleIds.has(String(role.id))) {
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
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
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
  const list = await findWithDecryption(em, UserAcl, { user: userId as unknown as User }, {}, { tenantId: null, organizationId: null })
  return list.map((acl) => ({
    tenantId: String(acl.tenantId),
    features: Array.isArray(acl.featuresJson) ? [...acl.featuresJson] : null,
    isSuperAdmin: Boolean(acl.isSuperAdmin),
    organizations: Array.isArray(acl.organizationsJson) ? [...acl.organizationsJson] : null,
  }))
}

async function restoreUserAcls(em: EntityManager, user: User, acls: UserAclSnapshot[]) {
  await lockAuthorizationUserRows(em, [String(user.id)])
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

type ProtectedRoleFloorOptions = {
  deactivating?: boolean
  newRoles?: string[]
  deleting?: boolean
}

/**
 * True when the requested mutation can lower a role's active holder count. Guards the
 * floor check so that ordinary edits (display name, password, email) never take the
 * tenant-wide role lock — `PUT /api/auth/profile` routes every self-service password
 * change through `auth.users.update`, so an unconditional lock would serialize them.
 */
function couldReduceActiveHolders(options: ProtectedRoleFloorOptions): boolean {
  return options.deleting === true || options.deactivating === true || options.newRoles !== undefined
}

async function enforceProtectedRoleFloor(
  em: EntityManager,
  tenantId: string | null,
  userId: string,
  options: ProtectedRoleFloorOptions,
  ctx?: CommandRuntimeContext,
): Promise<void> {
  // Internal automation (CLI, migrations, tenant teardown) must never be blocked by the
  // floor. Superadmins are deliberately NOT exempt — see the spec's Risks section.
  if (ctx?.systemActor === true) return
  if (!couldReduceActiveHolders(options)) return

  const normalizedTenantId = normalizeTenantId(tenantId) ?? null
  if (!normalizedTenantId) return

  // Find all protected roles in this tenant, acquiring a pessimistic write lock in a deterministic primary key order
  const protectedRoles = await findWithDecryption(em, Role, {
    tenantId: normalizedTenantId,
    minActiveHolders: { $gt: 0 },
    deletedAt: null
  }, {
    lockMode: LockMode.PESSIMISTIC_WRITE,
    orderBy: { id: 'ASC' }
  }, { tenantId: normalizedTenantId, organizationId: null })

  if (protectedRoles.length === 0) return

  const { translate } = await resolveTranslations()

  for (const role of protectedRoles) {
    const minFloor = role.minActiveHolders ?? 0
    if (minFloor <= 0) continue

    // Active links for this role, scoped to the tenant by the nested user filter so the
    // database — not a post-filter — enforces isolation. Deliberately NOT populated:
    // `findWithDecryption` runs `decryptEntityGraph` over loaded relations, which would
    // decrypt every admin's email and name on each check just to read their ids.
    const activeLinks = await findWithDecryption(em, UserRole, {
      role: role.id,
      deletedAt: null,
      user: {
        deletedAt: null,
        isConfirmed: true,
        tenantId: normalizedTenantId
      }
    }, {}, { tenantId: null, organizationId: null })

    // Count distinct user IDs in the tenant holding this role to prevent overcounting due to duplicate links
    const activeUserIds = Array.from(
      new Set(
        activeLinks
          .map((link) => {
            const userRef = link.user as unknown as { id?: string } | string | null | undefined
            const linkedUserId = typeof userRef === 'string' ? userRef : userRef?.id
            return linkedUserId ? String(linkedUserId) : null
          })
          .filter((id): id is string => !!id)
      )
    )

    // Is the target user currently one of the active holders?
    if (activeUserIds.includes(userId)) {
      // Determine if they will remain an active holder
      let willStillBeActiveHolder = true

      if (options.deleting || options.deactivating) {
        willStillBeActiveHolder = false
      } else if (options.newRoles !== undefined) {
        // Checking role list
        const desiredUnique = Array.from(new Set(options.newRoles.map((r) => r.trim().toLowerCase()).filter(Boolean)))
        const roleNameLower = role.name.toLowerCase()
        const hasRoleByName = desiredUnique.includes(roleNameLower) || desiredUnique.includes(String(role.id).toLowerCase())
        if (!hasRoleByName) {
          willStillBeActiveHolder = false
        }
      }

      if (!willStillBeActiveHolder) {
        const remaining = activeUserIds.length - 1
        if (remaining < minFloor) {
          throw new CrudHttpError(400, {
            error: translate('auth.users.errors.lastHolderOfCriticalRole', 'Cannot remove the last active holder of role "{roleName}"', { roleName: role.name })
          })
        }
      }
    }
  }
}
