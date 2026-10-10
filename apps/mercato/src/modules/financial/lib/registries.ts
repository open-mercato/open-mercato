/**
 * The country-plugin registry — the seam between a jurisdiction-neutral engine
 * and the rules a country actually imposes.
 *
 * The shape follows the in-repo precedents for "core asks, extension answers,
 * with a default" (`catalogPricingResolver`, `salesLineCalculator`): a
 * registration function, a resolver that **never throws**, and a test-only
 * reset. Resolution falling back to a generic plugin rather than returning null
 * is the load-order defence the engine needs — a deployment that never imports a
 * plugin still gets a working ledger, and a screen can say "no tax rules
 * configured here" instead of crashing on an absent country.
 *
 * Nothing in this file imports a country module. A plugin imports the contracts
 * (`./contracts`) and registers itself from its own module root.
 */
import type {
  ChartOfAccountsEntry,
  ChartOfAccountsTemplateContract,
  ComplianceCheckContract,
  ComplianceVerdict,
  FiscalCalendarContract,
  FiscalPeriodDefinition,
  InvoiceCapabilities,
  InvoiceFormatContract,
  InvoiceSubtype,
  NumberFormatContract,
  TaxCategory,
  TaxComputation,
  TaxComputeInput,
  TaxEngineContract,
  TaxFilingPeriod,
  TaxReportingContract,
} from './contracts'
import { formatMachineDecimal } from './money'

export type FinancialCountryPlugin = {
  /** ISO 3166-1 alpha-2, upper-case (`'SA'`). */
  countryCode: string
  tax: TaxEngineContract
  invoice: InvoiceFormatContract
  numberFormat: NumberFormatContract
  fiscalCalendar: FiscalCalendarContract
  chartOfAccounts?: ChartOfAccountsTemplateContract
  compliance?: ComplianceCheckContract
  taxReporting?: TaxReportingContract
}

export const GENERIC_COUNTRY_CODE = 'ZZ'

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

const pad2 = (value: number) => String(value).padStart(2, '0')

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toUtcParts(value: Date | string): { year: number; month: number; day: number } {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

/**
 * The jurisdictional no-op: no tax rules, no e-invoicing, a Gregorian calendar
 * year and Western formatting. It exists so `resolveFinancialCountryPlugin`
 * has an answer for every input — including the empty country code an entity
 * has before anybody configures one.
 */
function buildGenericTaxEngine(): TaxEngineContract {
  const round = (value: string | number) => formatMachineDecimal(value, 2)
  return {
    countryCode: GENERIC_COUNTRY_CODE,
    currencyCode: 'USD',
    minorUnitScale: 2,
    listRates: () => [],
    findRate: () => null,
    // Nothing is taxed by a jurisdiction we do not know, and "no rule" is not
    // the same claim as "zero-rated": the safe reading is out of scope.
    classify: (): TaxCategory => 'O',
    compute: (input: TaxComputeInput): TaxComputation => {
      const net = round(input.net)
      return {
        taxCode: input.taxCode,
        category: input.statedCategory ?? 'O',
        rate: 0,
        net,
        tax: round(0),
        gross: net,
      }
    },
    roundMoney: round,
  }
}

function buildGenericInvoiceFormat(): InvoiceFormatContract {
  const capabilities: InvoiceCapabilities = {
    qrCode: false,
    realtimeClearance: false,
    signedDocuments: false,
    subtypes: ['standard'] as readonly InvoiceSubtype[],
    hashChain: false,
  }
  return {
    countryCode: GENERIC_COUNTRY_CODE,
    capabilities: () => capabilities,
    defaultSubtype: () => 'standard',
  }
}

function buildGenericNumberFormat(): NumberFormatContract {
  return {
    countryCode: GENERIC_COUNTRY_CODE,
    currencyCode: 'USD',
    decimalSeparator: '.',
    groupSeparator: ',',
    fractionDigits: 2,
    formatMachine: (value: string | number) => formatMachineDecimal(value, 2),
    formatDisplay: (value: string | number, locale?: string) => {
      const amount = formatMachineDecimal(value, 2)
      try {
        return new Intl.NumberFormat(locale || 'en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(Number(amount))
      } catch {
        return amount
      }
    },
  }
}

function buildGenericFiscalCalendar(): FiscalCalendarContract {
  const buildPeriods = (fiscalYear: number): readonly FiscalPeriodDefinition[] =>
    MONTH_LABELS.map((label, index) => {
      const month = index + 1
      return {
        fiscalYear,
        periodNumber: month,
        periodName: `${fiscalYear}-${pad2(month)}`,
        startDate: isoDate(fiscalYear, month, 1),
        endDate: isoDate(fiscalYear, month, daysInMonth(fiscalYear, month)),
      }
    })
  return {
    countryCode: GENERIC_COUNTRY_CODE,
    fiscalYearFor: (date) => toUtcParts(date).year,
    periodNumberFor: (date) => toUtcParts(date).month,
    buildPeriods,
    filingPeriodFor: (date, frequency): TaxFilingPeriod => {
      const { year, month } = toUtcParts(date)
      if (frequency === 'annual') {
        return {
          frequency,
          fiscalYear: year,
          periodNumber: 1,
          label: String(year),
          startDate: isoDate(year, 1, 1),
          endDate: isoDate(year, 12, 31),
        }
      }
      const quarter = Math.floor((month - 1) / 3) + 1
      const months = frequency === 'quarterly' ? 3 : 1
      const firstMonth = frequency === 'quarterly' ? (quarter - 1) * 3 + 1 : month
      const lastMonth = firstMonth + months - 1
      const periodNumber = frequency === 'quarterly' ? quarter : month
      return {
        frequency,
        fiscalYear: year,
        periodNumber,
        label: frequency === 'quarterly' ? `${year}-Q${quarter}` : `${year}-${pad2(month)}`,
        startDate: isoDate(year, firstMonth, 1),
        endDate: isoDate(year, lastMonth, daysInMonth(year, lastMonth)),
      }
    },
    defaultFilingFrequency: () => 'annual',
  }
}

function buildGenericChartOfAccounts(): ChartOfAccountsTemplateContract {
  const accounts: readonly ChartOfAccountsEntry[] = []
  return {
    countryCode: GENERIC_COUNTRY_CODE,
    listAccounts: () => accounts,
    accountCodeForTaxCode: () => null,
  }
}

function buildGenericCompliance(): ComplianceCheckContract {
  const verdict: ComplianceVerdict = {
    ok: false,
    issues: [{ code: 'no_localization_configured', field: null }],
  }
  return {
    countryCode: GENERIC_COUNTRY_CODE,
    // An unknown jurisdiction has no number format to validate, so anything
    // non-empty is structurally acceptable; the absence of rules is reported
    // through `checkInvoicePrerequisites`, where it actually blocks a document.
    isValidTaxRegistrationNumber: (value) => typeof value === 'string' && value.trim().length > 0,
    isValidRegistrationNumber: (value) => value == null || value.trim().length > 0,
    checkInvoicePrerequisites: () => verdict,
  }
}

let genericPlugin: FinancialCountryPlugin | null = null

/** The fallback, built once so `resolve` stays cheap on a hot path. */
export function resolveGenericFinancialCountryPlugin(): FinancialCountryPlugin {
  if (!genericPlugin) {
    genericPlugin = {
      countryCode: GENERIC_COUNTRY_CODE,
      tax: buildGenericTaxEngine(),
      invoice: buildGenericInvoiceFormat(),
      numberFormat: buildGenericNumberFormat(),
      fiscalCalendar: buildGenericFiscalCalendar(),
      chartOfAccounts: buildGenericChartOfAccounts(),
      compliance: buildGenericCompliance(),
    }
  }
  return genericPlugin
}

type RegisteredPlugin = { plugin: FinancialCountryPlugin; priority: number }

const plugins = new Map<string, RegisteredPlugin>()

export function normalizeFinancialCountryCode(countryCode: string | null | undefined): string | null {
  if (typeof countryCode !== 'string') return null
  const normalized = countryCode.trim().toUpperCase()
  return normalized.length > 0 ? normalized : null
}

/**
 * Register (or replace) a country's plugin. A later registration for the same
 * country wins when its priority is at least as high, so an app can override a
 * plugin a dependency registered without reaching into its source.
 */
export function registerFinancialCountryPlugin(
  plugin: FinancialCountryPlugin,
  options?: { priority?: number },
): void {
  const countryCode = normalizeFinancialCountryCode(plugin.countryCode)
  if (!countryCode) {
    throw new Error('[internal] A financial country plugin needs an ISO 3166-1 alpha-2 country code.')
  }
  const priority = options?.priority ?? 0
  const existing = plugins.get(countryCode)
  if (existing && existing.priority > priority) return
  plugins.set(countryCode, { plugin: { ...plugin, countryCode }, priority })
}

/**
 * The plugin for a country code. Never throws and never returns null: an unknown
 * or absent code resolves to the generic plugin, so the engine runs without any
 * plugin installed.
 */
export function resolveFinancialCountryPlugin(
  countryCode: string | null | undefined,
): FinancialCountryPlugin {
  const normalized = normalizeFinancialCountryCode(countryCode)
  if (!normalized) return resolveGenericFinancialCountryPlugin()
  return plugins.get(normalized)?.plugin ?? resolveGenericFinancialCountryPlugin()
}

export function isGenericFinancialCountryPlugin(plugin: FinancialCountryPlugin): boolean {
  return plugin.countryCode === GENERIC_COUNTRY_CODE
}

export function listRegisteredFinancialCountryCodes(): readonly string[] {
  return [...plugins.keys()].sort()
}

/** Tests only: drop every registration so a suite starts from a known state. */
export function resetFinancialCountryPlugins(): void {
  plugins.clear()
  genericPlugin = null
}
