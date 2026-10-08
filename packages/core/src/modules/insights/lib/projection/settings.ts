import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InsightsProcessSettings } from '../../data/entities'
import type { ProjectionScope } from './types'

export const XRAY_SETTINGS_RESOURCE_KIND = 'insights.xray_settings'

export const XRAY_K_ANONYMITY_MIN = 5

export const XRAY_SETTINGS_DEFAULTS = {
  enabled: true,
  retentionDays: 365,
  kAnonymity: 10,
  debounceSeconds: 120,
  individualsEnabled: false,
  conformanceWorkflowId: null as string | null,
  activityStepMap: null as Record<string, string> | null,
}

export type XraySettingsValues = {
  enabled: boolean
  retentionDays: number
  kAnonymity: number
  debounceSeconds: number
  individualsEnabled: boolean
  conformanceWorkflowId: string | null
  activityStepMap: Record<string, string> | null
}

export type XraySettingsSnapshot = XraySettingsValues & {
  id: string | null
  updatedAt: string | null
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

export function toXraySettingsSnapshot(record: InsightsProcessSettings | null): XraySettingsSnapshot {
  if (!record || record.deletedAt) return { id: record?.id ?? null, updatedAt: null, ...XRAY_SETTINGS_DEFAULTS }
  return {
    id: record.id,
    updatedAt: toIso(record.updatedAt),
    enabled: record.enabled,
    retentionDays: record.retentionDays,
    kAnonymity: Math.max(record.kAnonymity, XRAY_K_ANONYMITY_MIN),
    debounceSeconds: record.debounceSeconds,
    individualsEnabled: record.individualsEnabled,
    conformanceWorkflowId: record.conformanceWorkflowId ?? null,
    activityStepMap: record.activityStepMap ?? null,
  }
}

export async function findXraySettingsRecord(em: EntityManager, scope: ProjectionScope): Promise<InsightsProcessSettings | null> {
  return findOneWithDecryption(
    em,
    InsightsProcessSettings,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

/** Effective settings of one organization; a missing or soft-deleted row yields the defaults. */
export async function loadXraySettings(em: EntityManager, scope: ProjectionScope): Promise<XraySettingsSnapshot> {
  return toXraySettingsSnapshot(await findXraySettingsRecord(em, scope))
}
