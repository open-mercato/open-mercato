/**
 * The Kingdom of Saudi Arabia as the financial module's first country plugin.
 *
 * This file is an **adapter and nothing else**. Every capability below is
 * implemented by a primitive this module already shipped and already pins with
 * tests — the 15% rate and halala rounding, the ZATCA QR, the UBL/hash/ICV stack,
 * the Hijri helpers, the seller settings. The plugin's whole job is to answer the
 * engine's contracts by delegating to them, so there is exactly one
 * implementation of each Saudi rule in the repository and the ledger cannot drift
 * away from the compliance vectors the e-invoice path is pinned to.
 *
 * Registration is a **side effect**, imported from the module root the way the
 * platform's other registries bootstrap. The engine resolves a plugin through
 * `resolveFinancialCountryPlugin`, which falls back to a generic jurisdiction when
 * nothing registered — so a deployment that never loads this module still runs a
 * working ledger, and `registerFinancialCountryPlugin` throwing here could not
 * take the app down.
 */
import { registerFinancialCountryPlugin } from '@/modules/financial/lib/registries'
import { buildSaudiChartOfAccounts } from './lib/saudi/coa'
import { buildSaudiCompliance } from './lib/saudi/compliance'
import { buildSaudiInvoiceFormat } from './lib/saudi/e-invoicing'
import { buildSaudiFiscalCalendar } from './lib/saudi/fiscal-calendar'
import { buildSaudiNumberFormat, SAUDI_COUNTRY_CODE } from './lib/saudi/number-format'
import { buildSaudiTaxEngine } from './lib/saudi/tax-engine'
import { buildSaudiTaxReporting } from './lib/saudi/vat-return'

export function buildSaudiFinancialPlugin() {
  const tax = buildSaudiTaxEngine()
  return {
    countryCode: SAUDI_COUNTRY_CODE,
    tax,
    invoice: buildSaudiInvoiceFormat(),
    numberFormat: buildSaudiNumberFormat(),
    fiscalCalendar: buildSaudiFiscalCalendar(),
    chartOfAccounts: buildSaudiChartOfAccounts(),
    compliance: buildSaudiCompliance(),
    taxReporting: buildSaudiTaxReporting(tax),
  }
}

registerFinancialCountryPlugin(buildSaudiFinancialPlugin())

export default buildSaudiFinancialPlugin
