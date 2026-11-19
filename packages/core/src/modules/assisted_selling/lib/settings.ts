import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AssistedSellingStoreSettings, type AssistedSellingStoreMode } from '../data/entities'

export type AssistedSellingSettingsScope = {
  tenantId: string
  organizationId: string
  storeId: string
}

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
  return findOneWithDecryption(
    em,
    AssistedSellingStoreSettings,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, storeId: scope.storeId, deletedAt: null },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

export function toEffectiveAssistedSellingSettings(
  settings: AssistedSellingStoreSettings | null,
): AssistedSellingEffectiveSettings {
  if (!settings) return { ...ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS }
  return {
    mode: settings.mode,
    proposalTtlSeconds: settings.proposalTtlSeconds,
    maxProposalLines: settings.maxProposalLines,
    conversationRetentionDays: settings.conversationRetentionDays,
    idleCloseDays: settings.idleCloseDays,
  }
}

export async function resolveEffectiveAssistedSellingSettings(
  em: EntityManager,
  scope: AssistedSellingSettingsScope,
): Promise<AssistedSellingEffectiveSettings> {
  return toEffectiveAssistedSellingSettings(await loadAssistedSellingStoreSettings(em, scope))
}
