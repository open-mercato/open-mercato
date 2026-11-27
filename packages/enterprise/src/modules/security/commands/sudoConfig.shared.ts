import type { EntityManager } from '@mikro-orm/postgresql'
import type { ZodType } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SudoChallengeConfig, type ChallengeMethod } from '../data/entities'
import { sudoConfigMutationCriteria, type SudoAuthScope } from '../lib/sudo-config-scope'

export type SudoConfigUndoSnapshot = {
  id: string
  tenantId: string | null
  organizationId: string | null
  label: string | null
  targetIdentifier: string
  isEnabled: boolean
  isDeveloperDefault: boolean
  ttlSeconds: number
  challengeMethod: string
  configuredBy: string | null
  deletedAt: string | null
}

export type SudoConfigUndoPayload = {
  before?: SudoConfigUndoSnapshot | null
  after?: SudoConfigUndoSnapshot | null
}

export function captureSudoConfigSnapshot(config: SudoChallengeConfig): SudoConfigUndoSnapshot {
  return {
    id: config.id,
    tenantId: config.tenantId ?? null,
    organizationId: config.organizationId ?? null,
    label: config.label,
    targetIdentifier: config.targetIdentifier,
    isEnabled: config.isEnabled,
    isDeveloperDefault: config.isDeveloperDefault,
    ttlSeconds: config.ttlSeconds,
    challengeMethod: config.challengeMethod,
    configuredBy: config.configuredBy ?? null,
    deletedAt: config.deletedAt ? config.deletedAt.toISOString() : null,
  }
}

export function applySudoConfigSnapshot(
  config: SudoChallengeConfig,
  snapshot: SudoConfigUndoSnapshot,
): void {
  Object.assign(config, sudoConfigSnapshotValues(snapshot))
}

function sudoConfigSnapshotValues(snapshot: SudoConfigUndoSnapshot) {
  return {
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
    label: snapshot.label,
    targetIdentifier: snapshot.targetIdentifier,
    isEnabled: snapshot.isEnabled,
    isDeveloperDefault: snapshot.isDeveloperDefault,
    ttlSeconds: snapshot.ttlSeconds,
    challengeMethod: snapshot.challengeMethod as ChallengeMethod,
    configuredBy: snapshot.configuredBy,
    deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null,
    updatedAt: new Date(),
  }
}

export function buildSudoAuthScopeFromAuth(auth: AuthContext | null | undefined): SudoAuthScope {
  return {
    tenantId: auth?.tenantId ?? null,
    organizationId: auth?.orgId ?? null,
    isSuperAdmin: auth?.isSuperAdmin === true,
  }
}

export function parseSudoConfigCommandInput<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
}

export async function captureSudoConfigBeforeWrite(ctx: CommandRuntimeContext, id: string) {
  const where = sudoConfigMutationCriteria(id, buildSudoAuthScopeFromAuth(ctx.auth))
  const notFound = () => new CrudHttpError(404, { error: 'Sudo configuration not found' })
  if (!where) throw notFound()
  const em = ctx.container.resolve<EntityManager>('em')
  const config = await em.findOne(SudoChallengeConfig, where)
  if (!config) throw notFound()
  return { before: captureSudoConfigSnapshot(config) }
}

export async function readSudoConfigForAudit(ctx: CommandRuntimeContext, id: string) {
  // The write has succeeded, but the command's identity map can still hold its pre-write snapshot.
  const em = ctx.container.resolve<EntityManager>('em').fork()
  return em.findOne(SudoChallengeConfig, { id })
}

const sudoConfigAuditLabels = {
  create: ['security.audit.sudo.create', 'Create sudo configuration'],
  update: ['security.audit.sudo.update', 'Update sudo configuration'],
  delete: ['security.audit.sudo.delete', 'Delete sudo configuration'],
} as const

export async function buildSudoConfigAuditLog(
  ctx: CommandRuntimeContext,
  action: keyof typeof sudoConfigAuditLabels,
  resourceId: string | null,
  undo: SudoConfigUndoPayload,
) {
  const { translate } = await resolveTranslations()
  const [key, fallback] = sudoConfigAuditLabels[action]
  return {
    actionLabel: translate(key, fallback),
    resourceKind: 'security.sudo_config',
    resourceId,
    actorUserId: ctx.auth?.sub ?? null,
    payload: { undo },
  }
}

export function denySudoConfigReplay(): never {
  throw new Error('[internal] Sudo configuration commands do not support replay')
}

export async function restoreSudoConfigSnapshot(
  em: EntityManager,
  snapshot: SudoConfigUndoSnapshot,
  recreateMissing: boolean,
): Promise<void> {
  const existing = await em.findOne(SudoChallengeConfig, { id: snapshot.id })
  if (existing) {
    applySudoConfigSnapshot(existing, snapshot)
  } else if (recreateMissing) {
    em.persist(em.create(SudoChallengeConfig, {
      id: snapshot.id,
      createdAt: new Date(),
      ...sudoConfigSnapshotValues(snapshot),
    }))
  } else {
    return
  }
  await em.flush()
}

export function readSudoConfigUndoPayload(logEntry: unknown): SudoConfigUndoPayload | null {
  return extractUndoPayload<SudoConfigUndoPayload>(
    logEntry as {
      commandPayload?: unknown | null
      payload?: unknown | null
      snapshotBefore?: unknown | null
      snapshotAfter?: unknown | null
      before?: unknown | null
      after?: unknown | null
    } | null | undefined,
  )
}
