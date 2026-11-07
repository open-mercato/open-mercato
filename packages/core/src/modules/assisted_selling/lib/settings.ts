import type { EntityManager } from '@mikro-orm/postgresql'
import { AssistedSellingStoreSettings, type AssistedSellingStoreMode } from '../data/entities'

export type AssistedSellingSettingsScope = {
  tenantId: string
  organizationId: string
  storeId: string
}

// Only the Release 5-exposed fields (§5.6). The Phase 3 `ai_*` columns and `aiAgentUserId` are
// deliberately absent here too — nothing in this release reads them, mirroring the entity's own
// "not exposed by the Release 5 route" columns.
export type AssistedSellingEffectiveSettings = {
  mode: AssistedSellingStoreMode
  proposalTtlSeconds: number
  maxProposalLines: number
  conversationRetentionDays: number
  idleCloseDays: number
}

export const ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS: AssistedSellingEffectiveSettings = {
  mode: 'off',
  proposalTtlSeconds: 259200,
  maxProposalLines: 50,
  conversationRetentionDays: 365,
  idleCloseDays: 30,
}

export async function loadAssistedSellingStoreSettings(
  em: EntityManager,
  scope: AssistedSellingSettingsScope,
): Promise<AssistedSellingStoreSettings | null> {
  return em.findOne(AssistedSellingStoreSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    deletedAt: null,
  })
}

export async function resolveEffectiveAssistedSellingSettings(
  em: EntityManager,
  scope: AssistedSellingSettingsScope,
): Promise<AssistedSellingEffectiveSettings> {
  const settings = await loadAssistedSellingStoreSettings(em, scope)
  if (!settings) return ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS
  return {
    mode: settings.mode,
    proposalTtlSeconds: settings.proposalTtlSeconds,
    maxProposalLines: settings.maxProposalLines,
    conversationRetentionDays: settings.conversationRetentionDays,
    idleCloseDays: settings.idleCloseDays,
  }
}
