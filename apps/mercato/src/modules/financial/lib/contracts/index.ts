/**
 * Layer 2 — the types a country plugin implements and the engine consumes.
 *
 * This barrel imports nothing but types, so a plugin can depend on the contract
 * surface without pulling engine code into its own bundle, and the engine can be
 * read as jurisdiction-neutral because nothing under `contracts/` can reach a
 * country module.
 */
export type {
  TaxCategory,
  TaxRateDefinition,
  TaxComputation,
  TaxComputeInput,
  TaxEngineContract,
} from './tax'
export { TAX_CATEGORIES } from './tax'

export type {
  InvoiceSubtype,
  InvoiceCapabilities,
  InvoiceFormatContract,
} from './invoice'
export { INVOICE_SUBTYPES } from './invoice'

export type { NumberFormatContract } from './number-format'

export type {
  FilingFrequency,
  FiscalPeriodDefinition,
  TaxFilingPeriod,
  FiscalCalendarContract,
} from './fiscal-calendar'
export { FILING_FREQUENCIES } from './fiscal-calendar'

export type { ChartOfAccountsEntry, ChartOfAccountsTemplateContract } from './coa'

export type {
  ComplianceIssue,
  ComplianceCheckInput,
  ComplianceVerdict,
  ComplianceCheckContract,
} from './compliance'

export type {
  TaxReturnLine,
  TaxReturnBucket,
  TaxReturnInput,
  TaxReturn,
  TaxReportingContract,
} from './reporting'
export { TAX_RETURN_CATEGORIES } from './reporting'
