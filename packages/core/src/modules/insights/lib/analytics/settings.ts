import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InsightsProcessSettings } from '../../data/entities'
import { toXraySettingsSnapshot } from '../projection/settings'
import type { AnalyticsOrgSettings } from './types'

/**
 * Loads the effective analytics settings of organizations of one tenant (missing or soft-deleted
 * rows: defaults, i.e. enabled in UTC). Ids are compared lower-case and the result is keyed by
 * lower-case organization id.
 */
export type XraySettingsLoader = (tenantId: string, organizationIds: readonly string[]) => Promise<ReadonlyMap<string, AnalyticsOrgSettings>>

export function createEntityManagerSettingsLoader(em: EntityManager): XraySettingsLoader {
  return async (tenantId, organizationIds) => {
    const settings = new Map<string, AnalyticsOrgSettings>()
    const tenant = tenantId.toLowerCase()
    const organizations = Array.from(new Set(organizationIds.map((organizationId) => organizationId.toLowerCase())))
    if (organizations.length === 0) return settings
    const records = await findWithDecryption(
      em,
      InsightsProcessSettings,
      { tenantId: tenant, organizationId: { $in: organizations } },
      undefined,
      { tenantId: tenant },
    )
    for (const record of records) {
      if (record.tenantId.toLowerCase() !== tenant) continue
      const snapshot = toXraySettingsSnapshot(record)
      settings.set(record.organizationId.toLowerCase(), {
        kAnonymity: snapshot.kAnonymity,
        debounceSeconds: snapshot.debounceSeconds,
        individualsEnabled: snapshot.individualsEnabled,
        enabled: snapshot.enabled,
        timeZone: snapshot.timeZone,
      })
    }
    return settings
  }
}
