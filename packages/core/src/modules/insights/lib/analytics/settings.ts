import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InsightsProcessSettings } from '../../data/entities'
import { toXraySettingsSnapshot } from '../projection/settings'
import type { AnalyticsOrgSettings } from './types'

/** Loads the effective analytics settings of organizations of one tenant (missing rows: defaults). */
export type XraySettingsLoader = (tenantId: string, organizationIds: readonly string[]) => Promise<ReadonlyMap<string, AnalyticsOrgSettings>>

export function createEntityManagerSettingsLoader(em: EntityManager): XraySettingsLoader {
  return async (tenantId, organizationIds) => {
    const settings = new Map<string, AnalyticsOrgSettings>()
    if (organizationIds.length === 0) return settings
    const records = await findWithDecryption(
      em,
      InsightsProcessSettings,
      { tenantId, organizationId: { $in: Array.from(new Set(organizationIds)) } },
      undefined,
      { tenantId },
    )
    for (const record of records) {
      if (record.tenantId !== tenantId) continue
      const snapshot = toXraySettingsSnapshot(record)
      settings.set(record.organizationId, {
        kAnonymity: snapshot.kAnonymity,
        debounceSeconds: snapshot.debounceSeconds,
        individualsEnabled: snapshot.individualsEnabled,
      })
    }
    return settings
  }
}
