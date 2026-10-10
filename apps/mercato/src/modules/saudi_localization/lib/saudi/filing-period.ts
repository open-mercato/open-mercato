/**
 * Turning "which period am I filing for?" into a date range.
 *
 * The range comes from the jurisdiction's own fiscal calendar rather than from
 * arithmetic here, so a return and a period can never disagree about where a
 * quarter starts. What this module adds is the resolution an HTTP caller needs:
 * a year, a frequency and optionally a period number, defaulted to the period
 * that contains *now* — which is the one an operator asking "what do I owe"
 * almost always means.
 */
import { z } from 'zod'
import type { FilingFrequency, FiscalCalendarContract, TaxFilingPeriod } from '@/modules/financial/lib/contracts'

/** The frequencies a VAT return can be filed at. Annual is not a ZATCA band. */
export const SAUDI_RETURN_FREQUENCIES = ['monthly', 'quarterly'] as const

export const saudiFilingQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100).optional(),
  frequency: z.enum(SAUDI_RETURN_FREQUENCIES).optional(),
  periodNumber: z.coerce.number().int().min(1).max(12).optional(),
})

export type SaudiFilingQuery = z.infer<typeof saudiFilingQuerySchema>

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * A date inside the requested period. Mid-period rather than the first day, so a
 * caller that asked for a month gets a date the calendar cannot place in the
 * neighbouring one through a boundary interpretation.
 */
function representativeDate(fiscalYear: number, frequency: FilingFrequency, periodNumber: number): string {
  if (frequency === 'quarterly') {
    const firstMonth = (periodNumber - 1) * 3 + 1
    return isoDate(fiscalYear, firstMonth + 1, 15)
  }
  return isoDate(fiscalYear, periodNumber, 15)
}

/**
 * The filing period a caller asked for. With no period number, the answer is the
 * period containing `now` — never period 1, which would silently report a
 * January return every time somebody opened the screen in July.
 */
export function resolveSaudiFilingPeriod(input: {
  calendar: FiscalCalendarContract
  query: SaudiFilingQuery
  fallbackFrequency: FilingFrequency
  now?: Date
}): TaxFilingPeriod {
  const now = input.now ?? new Date()
  const frequency = (input.query.frequency ?? input.fallbackFrequency) as FilingFrequency
  const fiscalYear = input.query.fiscalYear ?? input.calendar.fiscalYearFor(now)
  const periodNumber =
    input.query.periodNumber ?? input.calendar.filingPeriodFor(now, frequency).periodNumber
  return input.calendar.filingPeriodFor(
    representativeDate(fiscalYear, frequency, periodNumber),
    frequency,
  )
}
