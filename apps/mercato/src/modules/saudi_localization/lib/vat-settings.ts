import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { SAUDI_STANDARD_VAT_RATE, isValidSaudiVatNumber } from './saudi/vat'
import {
  saudiVatSettingsInputSchema,
  saudiVatSettingsStoredSchema,
  type SaudiVatSettingsInput,
} from '../data/validators'

/**
 * The Kingdom's tax identity for one seller, stored in the platform's
 * `module_configs` store (tenant-scoped, cached, no bespoke entity or migration).
 *
 * These values are exactly the inputs the ZATCA QR needs, so the invoice pipeline
 * reads them from here rather than from anywhere invoice-adjacent. `isComplete`
 * exists so an invoice can fail with "configure Saudi VAT settings" instead of
 * building a QR with an empty seller name.
 */

export const SAUDI_VAT_SETTINGS_MODULE_ID = 'saudi_localization'
export const SAUDI_VAT_SETTINGS_KEY = 'vat'

export type SaudiVatSettings = {
  sellerName: string
  vatRegistrationNumber: string
  commercialRegistrationNumber: string | null
  vatRate: number
  invoiceQrEnabled: boolean
}

export const SAUDI_VAT_SETTINGS_DEFAULTS: SaudiVatSettings = {
  sellerName: '',
  vatRegistrationNumber: '',
  commercialRegistrationNumber: null,
  vatRate: SAUDI_STANDARD_VAT_RATE,
  invoiceQrEnabled: true,
}

export type SaudiVatSettingsScope = {
  tenantId?: string | null
  organizationId?: string | null
}

/** Stored value → settings, filling absent or malformed fields with defaults. */
export function mergeSaudiVatSettings(value: unknown): SaudiVatSettings {
  const parsed = saudiVatSettingsStoredSchema.safeParse(value)
  if (!parsed.success) return { ...SAUDI_VAT_SETTINGS_DEFAULTS }

  const stored = parsed.data
  return {
    sellerName: stored.sellerName ?? SAUDI_VAT_SETTINGS_DEFAULTS.sellerName,
    vatRegistrationNumber: stored.vatRegistrationNumber ?? SAUDI_VAT_SETTINGS_DEFAULTS.vatRegistrationNumber,
    commercialRegistrationNumber: stored.commercialRegistrationNumber ?? null,
    vatRate: stored.vatRate ?? SAUDI_VAT_SETTINGS_DEFAULTS.vatRate,
    invoiceQrEnabled: stored.invoiceQrEnabled ?? SAUDI_VAT_SETTINGS_DEFAULTS.invoiceQrEnabled,
  }
}

/** The settings a ZATCA QR needs before an invoice may be issued. */
export function isSaudiVatSettingsComplete(settings: SaudiVatSettings): boolean {
  return settings.sellerName.trim().length > 0 && isValidSaudiVatNumber(settings.vatRegistrationNumber)
}

export async function readSaudiVatSettings(
  configService: ModuleConfigService,
  scope: SaudiVatSettingsScope = {},
): Promise<SaudiVatSettings> {
  const stored = await configService.getValue<unknown>(SAUDI_VAT_SETTINGS_MODULE_ID, SAUDI_VAT_SETTINGS_KEY, { scope })
  return mergeSaudiVatSettings(stored)
}

export async function writeSaudiVatSettings(
  configService: ModuleConfigService,
  input: SaudiVatSettingsInput,
  scope: SaudiVatSettingsScope = {},
): Promise<SaudiVatSettings> {
  const settings: SaudiVatSettings = {
    sellerName: input.sellerName.trim(),
    vatRegistrationNumber: input.vatRegistrationNumber.trim(),
    commercialRegistrationNumber: input.commercialRegistrationNumber ?? null,
    vatRate: input.vatRate,
    invoiceQrEnabled: input.invoiceQrEnabled,
  }
  await configService.setValue(SAUDI_VAT_SETTINGS_MODULE_ID, SAUDI_VAT_SETTINGS_KEY, settings, scope)
  return settings
}

/** Validate a request body into settings, using the same rules as the API. */
export function parseSaudiVatSettingsInput(value: unknown): SaudiVatSettingsInput {
  return saudiVatSettingsInputSchema.parse(value)
}
