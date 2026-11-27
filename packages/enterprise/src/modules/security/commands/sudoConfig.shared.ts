import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { SudoConfigUpdateInput } from '../data/validators'
import type { SudoChallengeService } from '../services/SudoChallengeService'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { ChallengeMethod, SudoChallengeConfig } from '../data/entities'
import type { SudoAuthScope } from '../services/SudoChallengeService'

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
  config.tenantId = snapshot.tenantId
  config.organizationId = snapshot.organizationId
  config.label = snapshot.label
  config.targetIdentifier = snapshot.targetIdentifier
  config.isEnabled = snapshot.isEnabled
  config.isDeveloperDefault = snapshot.isDeveloperDefault
  config.ttlSeconds = snapshot.ttlSeconds
  config.challengeMethod = snapshot.challengeMethod as ChallengeMethod
  config.configuredBy = snapshot.configuredBy
  config.deletedAt = snapshot.deletedAt ? new Date(snapshot.deletedAt) : null
  config.updatedAt = new Date()
}

export function buildSudoAuthScopeFromAuth(auth: AuthContext | null | undefined): SudoAuthScope {
  if (!auth) {
    return { tenantId: null, organizationId: null, isSuperAdmin: false }
  }
  return {
    tenantId: (auth.tenantId as string | null | undefined) ?? null,
    organizationId: (auth.orgId as string | null | undefined) ?? null,
    isSuperAdmin: auth.isSuperAdmin === true,
  }
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

const writeSnapshots = Symbol('sudoConfigWriteSnapshots')

export async function authorizeSudoConfigWrite(ctx: CommandRuntimeContext, id: string): Promise<void> {
  const service = ctx.container.resolve<SudoChallengeService>('sudoChallengeService')
  if (!await service.findWritableConfig(id, buildSudoAuthScopeFromAuth(ctx.auth))) {
    throw new CrudHttpError(404, { error: 'Sudo configuration not found' })
  }
}

export async function writeSudoConfig(
  ctx: CommandRuntimeContext,
  id: string,
  expected: string | undefined,
  mutation: { data: SudoConfigUpdateInput; configuredBy: string } | null,
) {
  const service = ctx.container.resolve<SudoChallengeService>('sudoChallengeService')
  const scope = buildSudoAuthScopeFromAuth(ctx.auth)
  const lock = { resourceKind: 'security.sudo_config', resourceId: id, expected }
  const { updatedAt, snapshots } = await service.writeConfig(id, scope, mutation, {
    onMissing: () => enforceRecordGoneIsConflict(lock),
    before: async (config) => {
      const before = captureSudoConfigSnapshot(config)
      await enforceCommandOptimisticLockWithGuards(ctx.container, { ...lock, current: config.updatedAt })
      return before
    },
    after: (config, before) => ({
      updatedAt: config.updatedAt.toISOString(),
      snapshots: mutation ? { before, after: captureSudoConfigSnapshot(config) } : { before },
    }),
  })
  const result = mutation ? { ok: true as const, updatedAt } : { ok: true as const }
  return Object.defineProperty(result, writeSnapshots, { value: snapshots })
}

export function readSudoConfigWriteSnapshots(result: unknown): SudoConfigUndoPayload | undefined {
  return (result as { [writeSnapshots]?: SudoConfigUndoPayload } | undefined)?.[writeSnapshots]
}
