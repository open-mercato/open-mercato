import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { SAUDI_STANDARD_VAT_RATE } from '../../saudi_localization/lib/saudi/vat'
import type { BillingCycle } from '../data/entities'
import { freightSettingsStoredSchema, type FreightSettingsInput } from '../data/validators'

/**
 * Module settings live in the platform's `module_configs` store (tenant-scoped,
 * no bespoke entity or migration), following the saudi_localization VAT settings
 * pattern. The defaults here feed new records: a contract pre-fills
 * `requires_customer_approval` from `defaultRequiresCustomerApproval`, and every
 * abstract snapshots whatever the contract held at generation time — a later
 * settings change can never alter an issued abstract.
 */

export const FREIGHT_SETTINGS_MODULE_ID = 'freight_operations'
export const FREIGHT_SETTINGS_KEY = 'settings'

export type FreightScope = { tenantId: string; organizationId: string }

export type FreightSettings = {
  defaultRequiresCustomerApproval: boolean
  defaultPaymentTermsDays: number
  defaultBillingCycle: BillingCycle
  defaultVatRate: number
  salesChannelId: string | null
  requirePodForBilling: boolean
  orderNumberPrefix: string
  contractNumberPrefix: string
  tripNumberPrefix: string
  abstractNumberPrefix: string
}

export const FREIGHT_SETTINGS_DEFAULTS: FreightSettings = {
  defaultRequiresCustomerApproval: true,
  defaultPaymentTermsDays: 30,
  defaultBillingCycle: 'monthly',
  defaultVatRate: SAUDI_STANDARD_VAT_RATE,
  salesChannelId: null,
  requirePodForBilling: false,
  orderNumberPrefix: 'FO',
  contractNumberPrefix: 'FC',
  tripNumberPrefix: 'FT',
  abstractNumberPrefix: 'FA',
}

export type FreightSettingsScope = {
  tenantId?: string | null
  organizationId?: string | null
}

export function mergeFreightSettings(value: unknown): FreightSettings {
  const parsed = freightSettingsStoredSchema.safeParse(value)
  if (!parsed.success) return { ...FREIGHT_SETTINGS_DEFAULTS }

  const stored = parsed.data
  return {
    defaultRequiresCustomerApproval:
      stored.defaultRequiresCustomerApproval ?? FREIGHT_SETTINGS_DEFAULTS.defaultRequiresCustomerApproval,
    defaultPaymentTermsDays: stored.defaultPaymentTermsDays ?? FREIGHT_SETTINGS_DEFAULTS.defaultPaymentTermsDays,
    defaultBillingCycle: stored.defaultBillingCycle ?? FREIGHT_SETTINGS_DEFAULTS.defaultBillingCycle,
    defaultVatRate: stored.defaultVatRate ?? FREIGHT_SETTINGS_DEFAULTS.defaultVatRate,
    salesChannelId: stored.salesChannelId ?? null,
    requirePodForBilling: stored.requirePodForBilling ?? FREIGHT_SETTINGS_DEFAULTS.requirePodForBilling,
    orderNumberPrefix: stored.orderNumberPrefix ?? FREIGHT_SETTINGS_DEFAULTS.orderNumberPrefix,
    contractNumberPrefix: stored.contractNumberPrefix ?? FREIGHT_SETTINGS_DEFAULTS.contractNumberPrefix,
    tripNumberPrefix: stored.tripNumberPrefix ?? FREIGHT_SETTINGS_DEFAULTS.tripNumberPrefix,
    abstractNumberPrefix: stored.abstractNumberPrefix ?? FREIGHT_SETTINGS_DEFAULTS.abstractNumberPrefix,
  }
}

export type FreightSettingsRecord = {
  settings: FreightSettings
  updatedAt: string | null
}

export async function readFreightSettingsRecord(
  configService: ModuleConfigService,
  scope: FreightSettingsScope = {},
): Promise<FreightSettingsRecord> {
  const record = await configService.getRecord(FREIGHT_SETTINGS_MODULE_ID, FREIGHT_SETTINGS_KEY, scope)
  if (!record) return { settings: { ...FREIGHT_SETTINGS_DEFAULTS }, updatedAt: null }
  return { settings: mergeFreightSettings(record.value), updatedAt: record.updatedAt }
}

export async function readFreightSettings(
  configService: ModuleConfigService,
  scope: FreightSettingsScope = {},
): Promise<FreightSettings> {
  return (await readFreightSettingsRecord(configService, scope)).settings
}

export async function writeFreightSettings(
  configService: ModuleConfigService,
  input: FreightSettingsInput,
  scope: FreightSettingsScope = {},
): Promise<FreightSettingsRecord> {
  const settings = mergeFreightSettings(input)
  const record = await configService.setValue(FREIGHT_SETTINGS_MODULE_ID, FREIGHT_SETTINGS_KEY, settings, scope)
  return { settings, updatedAt: record?.updatedAt ?? null }
}
