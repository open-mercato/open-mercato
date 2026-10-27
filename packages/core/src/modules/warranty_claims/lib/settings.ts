import type { EntityManager } from '@mikro-orm/postgresql'
import { DEFAULT_SLA_HOURS } from '../data/constants'
import { WarrantyClaimSettings } from '../data/entities'

export type WarrantyClaimEffectiveSettings = {
  slaHours: number
  slaPauseOnInfoRequested: boolean
  slaAtRiskThresholdPct: number
  autoApproveEnabled: boolean
  autoApproveMaxAmount: number | null
  autoApproveCurrencyCode: string | null
  autoApproveRequireInWarranty: boolean
  defaultWarrantyMonths: number | null
  businessHours: Record<string, unknown> | null
  escalationTiers: unknown[] | null
  adjudicationUseRules: boolean
  quarantineGrades: string[] | null
  returnLabelProvider: string | null
}

export const WARRANTY_CLAIM_SETTINGS_DEFAULTS: WarrantyClaimEffectiveSettings = {
  slaHours: DEFAULT_SLA_HOURS,
  slaPauseOnInfoRequested: true,
  slaAtRiskThresholdPct: 75,
  autoApproveEnabled: false,
  autoApproveMaxAmount: null,
  autoApproveCurrencyCode: null,
  autoApproveRequireInWarranty: true,
  defaultWarrantyMonths: null,
  businessHours: null,
  escalationTiers: null,
  adjudicationUseRules: false,
  quarantineGrades: null,
  returnLabelProvider: null,
}

function parseNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function loadWarrantyClaimSettings(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
): Promise<WarrantyClaimSettings | null> {
  if (!scope.organizationId) return null
  return em.findOne(WarrantyClaimSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
}

export async function resolveEffectiveWarrantyClaimSettings(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
): Promise<WarrantyClaimEffectiveSettings> {
  const settings = await loadWarrantyClaimSettings(em, scope)
  if (!settings) return WARRANTY_CLAIM_SETTINGS_DEFAULTS
  return {
    slaHours: settings.slaHours ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.slaHours,
    slaPauseOnInfoRequested: settings.slaPauseOnInfoRequested ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.slaPauseOnInfoRequested,
    slaAtRiskThresholdPct: settings.slaAtRiskThresholdPct ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.slaAtRiskThresholdPct,
    autoApproveEnabled: settings.autoApproveEnabled ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.autoApproveEnabled,
    autoApproveMaxAmount: parseNullableNumber(settings.autoApproveMaxAmount),
    autoApproveCurrencyCode: settings.autoApproveCurrencyCode ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.autoApproveCurrencyCode,
    autoApproveRequireInWarranty: settings.autoApproveRequireInWarranty ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.autoApproveRequireInWarranty,
    defaultWarrantyMonths: settings.defaultWarrantyMonths ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.defaultWarrantyMonths,
    businessHours: settings.businessHours ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.businessHours,
    escalationTiers: settings.escalationTiers ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.escalationTiers,
    adjudicationUseRules: settings.adjudicationUseRules ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.adjudicationUseRules,
    quarantineGrades: settings.quarantineGrades ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.quarantineGrades,
    returnLabelProvider: settings.returnLabelProvider ?? WARRANTY_CLAIM_SETTINGS_DEFAULTS.returnLabelProvider,
  }
}
