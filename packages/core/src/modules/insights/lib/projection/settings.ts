import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InsightsProcessSettings } from '../../data/entities'
import { canonicalIanaTimeZone } from '../analytics/window'
import type { ProjectionScope } from './types'

export const XRAY_SETTINGS_RESOURCE_KIND = 'insights.xray_settings'

export const XRAY_K_ANONYMITY_MIN = 5

/** Lowest per-organization override of the suggestion support threshold (`suggestionMinSupport`). */
export const XRAY_SUGGESTION_MIN_SUPPORT_FLOOR = 5

export const XRAY_SETTINGS_DEFAULTS = {
  enabled: true,
  retentionDays: 365,
  kAnonymity: 10,
  debounceSeconds: 120,
  individualsEnabled: false,
  timeZone: 'UTC',
  suggestionMinSupport: null as number | null,
  conformanceWorkflowId: null as string | null,
  activityStepMap: null as Record<string, string> | null,
}

export type XraySettingsValues = {
  enabled: boolean
  retentionDays: number
  kAnonymity: number
  debounceSeconds: number
  individualsEnabled: boolean
  timeZone: string
  suggestionMinSupport: number | null
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
    timeZone: canonicalIanaTimeZone(record.timeZone ?? '') ?? XRAY_SETTINGS_DEFAULTS.timeZone,
    suggestionMinSupport: typeof record.suggestionMinSupport === 'number'
      ? Math.max(record.suggestionMinSupport, XRAY_SUGGESTION_MIN_SUPPORT_FLOOR)
      : null,
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

export function xrayScopeKey(scope: ProjectionScope): string {
  return `${scope.tenantId}|${scope.organizationId}`
}

/**
 * Organizations of a page of scopes (any tenants) whose saved settings disable X-Ray, as
 * `xrayScopeKey` values (one query; organizations without settings use the defaults: enabled).
 */
export async function listDisabledXrayOrganizations(em: EntityManager, scopes: readonly ProjectionScope[]): Promise<Set<string>> {
  const disabled = new Set<string>()
  if (scopes.length === 0) return disabled
  const wanted = new Set(scopes.map(xrayScopeKey))
  const records = await findWithDecryption(
    em,
    InsightsProcessSettings,
    {
      tenantId: { $in: Array.from(new Set(scopes.map((scope) => scope.tenantId))) },
      organizationId: { $in: Array.from(new Set(scopes.map((scope) => scope.organizationId))) },
      enabled: false,
      deletedAt: null,
    },
    undefined,
    { tenantId: null, organizationId: null },
  )
  for (const record of records) {
    const key = xrayScopeKey({ tenantId: record.tenantId, organizationId: record.organizationId })
    if (wanted.has(key)) disabled.add(key)
  }
  return disabled
}
