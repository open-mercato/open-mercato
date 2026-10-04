import type {
  CommandRuntimeContext,
  CommandUndoLogEntry,
} from '@open-mercato/shared/lib/commands'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  Role,
  RoleAcl,
  User,
  UserAcl,
  UserRole,
} from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  const record = asRecord(value)
  if (!record) return value
  const entries = Object.entries(record)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalize(entry)])
  return Object.fromEntries(entries)
}

export function replaySnapshotsEqual(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  )
}

export async function assertReplaySnapshotMatches(
  current: unknown,
  expected: unknown,
): Promise<void> {
  if (replaySnapshotsEqual(current, expected)) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    error: translate(
      'auth.replay.errors.stale',
      'This action cannot be replayed because the target has changed.',
    ),
  })
}

export async function denyCredentialReplay(): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(400, {
    error: translate(
      'auth.replay.errors.credentials',
      'Password changes cannot be replayed.',
    ),
  })
}

export async function requireCurrentReplayFeature(
  ctx: CommandRuntimeContext,
  feature: string,
): Promise<void> {
  if (ctx.systemActor === true) return
  const actorUserId = ctx.auth?.sub
  if (!actorUserId) throw forbidden()

  let rbacService: RbacService
  try {
    rbacService = ctx.container.resolve('rbacService') as RbacService
  } catch {
    throw forbidden()
  }
  await rbacService.invalidateUserCache(actorUserId)
  const allowed = await rbacService.userHasAllFeatures(actorUserId, [feature], {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  })
  if (!allowed) throw forbidden()
}

export async function requireCurrentReplaySuperAdmin(
  ctx: CommandRuntimeContext,
): Promise<void> {
  if (ctx.systemActor === true) return
  const actorUserId = ctx.auth?.sub
  if (!actorUserId) throw forbidden()

  let rbacService: RbacService
  try {
    rbacService = ctx.container.resolve('rbacService') as RbacService
  } catch {
    throw forbidden()
  }
  await rbacService.invalidateUserCache(actorUserId)
  const acl = await rbacService.loadAcl(actorUserId, {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  })
  if (!acl.isSuperAdmin) throw forbidden()
}

type ReplayAuthorizationLockTargets = {
  targetUserId?: string | null
  targetRoleId?: string | null
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  const record = asRecord(value)
  return typeof record?.id === 'string' && record.id.length > 0
    ? record.id
    : null
}

export async function lockReplayAuthorizationState(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  targets: ReplayAuthorizationLockTargets,
): Promise<void> {
  const userIds = Array.from(new Set([
    ctx.auth?.sub ?? null,
    targets.targetUserId ?? null,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0))).sort()

  const userRoles = userIds.length
    ? await findWithDecryption(
        em,
        UserRole,
        { user: { $in: userIds } as unknown } as FilterQuery<UserRole>,
        { orderBy: { id: 'ASC' } },
        { tenantId: null, organizationId: null },
      )
    : []
  const roleIds = Array.from(new Set([
    targets.targetRoleId ?? null,
    ...userRoles.map((link) => relationId(link.role)),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0))).sort()

  if (roleIds.length) {
    await findWithDecryption(
      em,
      Role,
      { id: { $in: roleIds }, deletedAt: null } as FilterQuery<Role>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
      { tenantId: null, organizationId: null },
    )
  }
  if (userIds.length) {
    await findWithDecryption(
      em,
      User,
      { id: { $in: userIds }, deletedAt: null } as FilterQuery<User>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
      { tenantId: null, organizationId: null },
    )
    await findWithDecryption(
      em,
      UserRole,
      { user: { $in: userIds } as unknown } as FilterQuery<UserRole>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
      { tenantId: null, organizationId: null },
    )
    await findWithDecryption(
      em,
      UserAcl,
      { user: { $in: userIds } as unknown } as FilterQuery<UserAcl>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
      { tenantId: null, organizationId: null },
    )
  }
  if (roleIds.length) {
    await findWithDecryption(
      em,
      RoleAcl,
      { role: { $in: roleIds } as unknown } as FilterQuery<RoleAcl>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
      { tenantId: null, organizationId: null },
    )
  }
}

export function extractStoredReplayInput(
  input: unknown,
  logEntry: CommandUndoLogEntry,
): Record<string, unknown> {
  const payload = asRecord(logEntry.commandPayload)
  const stored =
    payload && '__redoInput' in payload ? asRecord(payload.__redoInput) : null
  if (stored) return stored
  const direct = asRecord(input)
  if (!direct || direct === payload || 'undo' in direct) return {}
  return direct
}

export function hasStoredPasswordInput(
  input: unknown,
  logEntry: CommandUndoLogEntry,
): boolean {
  const replayInput = extractStoredReplayInput(input, logEntry)
  return (
    typeof replayInput.password === 'string' && replayInput.password.length > 0
  )
}
