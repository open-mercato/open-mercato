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
