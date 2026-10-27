import type {
  CommandReplayAuthorizationArgs,
  CommandRuntimeContext,
  CommandUndoLogEntry,
} from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  lockAuthorizationState,
  lockAuthorizationRoleRows,
  lockAuthorizationUserRows,
} from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'

export {
  lockAuthorizationRoleRows,
  lockAuthorizationUserRows,
} from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'

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
  const transactionalEm = requireTransactionalReplayEntityManager(ctx)

  let rbacService: RbacService
  try {
    rbacService = ctx.container.resolve('rbacService') as RbacService
  } catch {
    throw forbidden()
  }
  const scope = {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
  const allowed = await rbacService.userHasAllFeaturesWithEntityManager(
    transactionalEm,
    actorUserId,
    [feature],
    scope,
  )
  if (!allowed) throw forbidden()
}

export async function requireCurrentReplaySuperAdmin(
  ctx: CommandRuntimeContext,
): Promise<void> {
  if (ctx.systemActor === true) return
  const actorUserId = ctx.auth?.sub
  if (!actorUserId) throw forbidden()
  const transactionalEm = requireTransactionalReplayEntityManager(ctx)

  let rbacService: RbacService
  try {
    rbacService = ctx.container.resolve('rbacService') as RbacService
  } catch {
    throw forbidden()
  }
  const scope = {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
  const acl = await rbacService.loadAclWithEntityManager(transactionalEm, actorUserId, scope)
  if (!acl.isSuperAdmin) throw forbidden()
}

export function requireTransactionalReplayEntityManager(
  ctx: CommandRuntimeContext,
): EntityManager {
  if (ctx.transactionalEm) return ctx.transactionalEm
  throw new Error('[internal] Auth replay authorization requires a transactional EntityManager')
}

export async function rerunReplayTransactionGuardAfterLocks(
  params: CommandReplayAuthorizationArgs<unknown>,
  em: EntityManager,
): Promise<void> {
  if (!params.ctx.replayTransactionGuard) return
  await params.ctx.replayTransactionGuard({
    operation: params.operation,
    logEntry: params.logEntry,
    transactionalEm: em,
  })
}

export type ReplayAuthorizationLockTargets = {
  targetUserId?: string | null
  targetRoleId?: string | null
  targetUserIds?: readonly string[]
  targetRoleIds?: readonly string[]
  targetTenantIds?: readonly string[]
}

export async function lockReplayAuthorizationState(
  em: EntityManager,
  ctx: Pick<CommandRuntimeContext, 'auth'>,
  targets: ReplayAuthorizationLockTargets,
): Promise<void> {
  const actorId = ctx.auth?.sub ?? null
  const apiKeyId = actorId?.startsWith('api_key:')
    ? actorId.slice('api_key:'.length)
    : null
  await lockAuthorizationState(em, {
    apiKeyIds: apiKeyId ? [apiKeyId] : [],
    userIds: [
      ...(apiKeyId || !actorId ? [] : [actorId]),
      ...(targets.targetUserId ? [targets.targetUserId] : []),
      ...(targets.targetUserIds ?? []),
    ],
    roleIds: [
      ...(targets.targetRoleId ? [targets.targetRoleId] : []),
      ...(targets.targetRoleIds ?? []),
    ],
    tenantIds: [
      ...(ctx.auth?.tenantId ? [ctx.auth.tenantId] : []),
      ...(targets.targetTenantIds ?? []),
    ],
  }, { sealReplayFootprint: true })
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
