/**
 * The jurisdiction a tenant keeps its books under, as a stored setting.
 *
 * It has to be a setting rather than a column somewhere, because the platform's
 * organization has no country field and this module is not the place to add one.
 * It selects the country plugin (`resolveFinancialCountryPlugin`), which is what
 * decides the chart of accounts a tenant is offered, the tax codes its returns
 * report and the fiscal calendar its periods follow.
 *
 * Absent is a legitimate value and resolves to the **generic** plugin, so a tenant
 * that never sets one still gets a working ledger with no tax rules imposed on it.
 */
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { normalizeFinancialCountryCode, resolveFinancialCountryPlugin } from './registries'

export const FINANCIAL_MODULE_ID = 'financial'
export const FINANCIAL_JURISDICTION_KEY = 'jurisdiction'

export type FinancialJurisdictionScope = {
  tenantId?: string | null
  organizationId?: string | null
}

export async function readFinancialJurisdiction(
  configService: ModuleConfigService | null | undefined,
  scope: FinancialJurisdictionScope,
): Promise<string | null> {
  if (!configService) return null
  try {
    const value = await configService.getValue<unknown>(
      FINANCIAL_MODULE_ID,
      FINANCIAL_JURISDICTION_KEY,
      { scope },
    )
    const raw = typeof value === 'string' ? value : (value as { countryCode?: unknown } | null)?.countryCode
    return normalizeFinancialCountryCode(typeof raw === 'string' ? raw : null)
  } catch {
    // A missing or unreadable setting is "no jurisdiction configured", never a
    // failure: setup must not be blocked by a config row that does not exist yet.
    return null
  }
}

export async function writeFinancialJurisdiction(
  configService: ModuleConfigService,
  countryCode: string | null,
  scope: FinancialJurisdictionScope,
): Promise<string | null> {
  const normalized = normalizeFinancialCountryCode(countryCode)
  await configService.setValue(FINANCIAL_MODULE_ID, FINANCIAL_JURISDICTION_KEY, normalized, scope)
  return normalized
}

/** The plugin a configured jurisdiction resolves to; the generic one when unset. */
export function resolveJurisdictionPlugin(countryCode: string | null | undefined) {
  return resolveFinancialCountryPlugin(countryCode)
}
