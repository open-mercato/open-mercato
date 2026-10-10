/**
 * Tax reporting for a filing period. Types only.
 *
 * The shape is a **read model over posted lines**: a return posts nothing, it
 * groups what the ledger already says. Every figure therefore has to be
 * traceable back to `gl_journal_lines`, and the contract carries the
 * reconciliation delta for exactly that reason — a return that quietly rounds a
 * difference into agreement is worse than one that reports a number the operator
 * has to go and explain.
 */
import type { AccountClass } from '../../data/entities'
import type { FilingFrequency, TaxFilingPeriod } from './fiscal-calendar'
import type { TaxCategory } from './tax'

/**
 * One posted journal line, with the account information the return needs to
 * decide what the line *is*. `accountClass` is what separates the taxable base
 * (a revenue or expense account) from the tax itself (the VAT payable and
 * receivable accounts), so a caller must supply it rather than leave the return
 * guessing from the amount's sign.
 */
export type TaxReturnLine = {
  taxCode: string | null
  accountCode: string
  accountClass: AccountClass
  debit: string
  credit: string
}

export type TaxReturnBucket = {
  /** Taxable base, in the jurisdiction's currency. */
  net: string
  /** Tax on that base. */
  tax: string
}

export type TaxReturnInput = {
  period: TaxFilingPeriod
  lines: readonly TaxReturnLine[]
  /** The period the return is filed for, as the filing frequency numbers it. */
  frequency: FilingFrequency
  /** Injected so a regenerated return is reproducible; never `Date.now()` inside. */
  generatedAt: string
}

export type TaxReturn = {
  countryCode: string
  currencyCode: string
  period: {
    fiscalYear: number
    frequency: FilingFrequency
    periodNumber: number
    label: string
    startDate: string
    endDate: string
  }
  standardRated: TaxReturnBucket
  zeroRated: { net: string }
  exempt: { net: string }
  outOfScope: { net: string }
  /** Tax collected on sales. */
  outputVat: string
  /** Tax paid on purchases. */
  inputVat: string
  /** `outputVat - inputVat`; negative means the period is in credit. */
  netPayable: string
  lineCount: number
  /**
   * `outputVat` minus the tax the standard-rated base implies. Zero on a
   * consistently posted ledger; non-zero names a posting that is missing its
   * counterpart, which is the failure a silent round would hide.
   */
  reconciliationDelta: string
  generatedAt: string
}

export type TaxReportingContract = {
  readonly countryCode: string
  buildReturn(input: TaxReturnInput): TaxReturn
}

/** The category buckets a return reports, in the order a filing form lists them. */
export const TAX_RETURN_CATEGORIES: readonly TaxCategory[] = ['S', 'Z', 'E', 'O']
