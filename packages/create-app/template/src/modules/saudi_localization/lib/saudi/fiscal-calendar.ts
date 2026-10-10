/**
 * The Kingdom's fiscal calendar.
 *
 * The fiscal year is the **Gregorian** calendar year — a Hijri calendar is a
 * display concern on documents, never the posting or filing calendar, which is
 * the invariant `lib/saudi/hijri.ts` is documented as keeping. Periods are the
 * twelve Gregorian months.
 *
 * Filing frequency is the part with a rule behind it: ZATCA requires monthly
 * returns above a turnover threshold and quarterly below it, and the threshold is
 * periodically revised — so the default here is the common case (quarterly) and
 * the frequency a tenant actually files at is a setting, not something this file
 * decides on their behalf.
 */
import type {
  FilingFrequency,
  FiscalCalendarContract,
  FiscalPeriodDefinition,
  TaxFilingPeriod,
} from '@/modules/financial/lib/contracts'
import { SAUDI_COUNTRY_CODE } from './number-format'

const MONTHS = [
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

/**
 * Read in UTC. A posting date is a calendar date, not an instant: parsing it
 * against a zone would move a 1st-of-the-month posting into the previous period
 * for anyone west of Riyadh.
 */
function toUtcParts(value: Date | string): { year: number; month: number } {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
}

export const SAUDI_DEFAULT_FILING_FREQUENCY: FilingFrequency = 'quarterly'

export function buildSaudiFiscalCalendar(): FiscalCalendarContract {
  const buildPeriods = (fiscalYear: number): readonly FiscalPeriodDefinition[] =>
    MONTHS.map((label, index) => {
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
    countryCode: SAUDI_COUNTRY_CODE,
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
      if (frequency === 'monthly') {
        return {
          frequency,
          fiscalYear: year,
          periodNumber: month,
          label: `${year}-${pad2(month)}`,
          startDate: isoDate(year, month, 1),
          endDate: isoDate(year, month, daysInMonth(year, month)),
        }
      }
      const quarter = Math.floor((month - 1) / 3) + 1
      const firstMonth = (quarter - 1) * 3 + 1
      const lastMonth = firstMonth + 2
      return {
        frequency,
        fiscalYear: year,
        periodNumber: quarter,
        label: `${year}-Q${quarter}`,
        startDate: isoDate(year, firstMonth, 1),
        endDate: isoDate(year, lastMonth, daysInMonth(year, lastMonth)),
      }
    },
    defaultFilingFrequency: () => SAUDI_DEFAULT_FILING_FREQUENCY,
  }
}

/** The month label a period name uses, so a screen and a period agree. */
export function saudiMonthLabel(month: number): string {
  return MONTHS[month - 1] ?? String(month)
}
