/**
 * How a jurisdiction slices the year. Types only.
 *
 * A fiscal calendar decides which period a posting date falls into and how a tax
 * return is filed. The Kingdom files VAT monthly or quarterly by turnover band
 * while keeping a Gregorian fiscal year, which is why frequency is part of the
 * contract rather than derived from the period count.
 */

export const FILING_FREQUENCIES = ['monthly', 'quarterly', 'annual'] as const
export type FilingFrequency = (typeof FILING_FREQUENCIES)[number]

export type FiscalPeriodDefinition = {
  fiscalYear: number
  periodNumber: number
  periodName: string
  /** ISO dates (`YYYY-MM-DD`) — a period boundary is a calendar date, not an instant. */
  startDate: string
  endDate: string
}

export type TaxFilingPeriod = {
  frequency: FilingFrequency
  fiscalYear: number
  /** 1-based period within the fiscal year, in the filing frequency's own numbering. */
  periodNumber: number
  label: string
  startDate: string
  endDate: string
}

export type FiscalCalendarContract = {
  readonly countryCode: string
  /** The fiscal year a date belongs to (Gregorian year for SA). */
  fiscalYearFor(date: Date | string): number
  /** The fiscal-period number a date belongs to, in this calendar's own numbering. */
  periodNumberFor(date: Date | string): number
  /** The periods of a fiscal year, in order. */
  buildPeriods(fiscalYear: number): readonly FiscalPeriodDefinition[]
  /** The period the jurisdiction files tax for, containing `date`. */
  filingPeriodFor(date: Date | string, frequency: FilingFrequency): TaxFilingPeriod
  /** The frequency an entity files at. Stored per tenant; the contract supplies the default. */
  defaultFilingFrequency(): FilingFrequency
}
