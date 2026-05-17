import {
  startOfDay,
  endOfDay,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from 'date-fns'
import type { DateRange } from '../backend/date-range/dateRanges'

export type DateRangePresetItem = {
  id: string
  labelKey: string
  range: (referenceDate?: Date) => DateRange
}

/**
 * Returns the canonical 8 date-range presets aligned with the Figma
 * Range Picker spec (`446:7412` Period Range track).
 *
 * The list is intentionally shorter than `DATE_RANGE_OPTIONS` from
 * `@open-mercato/ui/backend/date-range`: that constant powers
 * dashboard/analytics modules with 13 presets (today, yesterday,
 * this/last week/month/quarter/year, last 7/30/90 days), but the Figma
 * Range Picker UI exposes 8 options optimised for filter UX (today plus
 * sliding windows and month/year-to-date).
 *
 * Used by `<DateRangePicker>` as the default `presets` value.
 */
export function defaultDateRangePresets(): DateRangePresetItem[] {
  return [
    {
      id: 'today',
      labelKey: 'ui.dateRangePicker.presets.today',
      range: (ref = new Date()) => ({ start: startOfDay(ref), end: endOfDay(ref) }),
    },
    {
      id: 'last_7_days',
      labelKey: 'ui.dateRangePicker.presets.last7Days',
      range: (ref = new Date()) => ({
        start: startOfDay(subDays(ref, 6)),
        end: endOfDay(ref),
      }),
    },
    {
      id: 'last_30_days',
      labelKey: 'ui.dateRangePicker.presets.last30Days',
      range: (ref = new Date()) => ({
        start: startOfDay(subDays(ref, 29)),
        end: endOfDay(ref),
      }),
    },
    {
      id: 'last_3_months',
      labelKey: 'ui.dateRangePicker.presets.last3Months',
      range: (ref = new Date()) => ({
        start: startOfDay(subMonths(ref, 3)),
        end: endOfDay(ref),
      }),
    },
    {
      id: 'last_12_months',
      labelKey: 'ui.dateRangePicker.presets.last12Months',
      range: (ref = new Date()) => ({
        start: startOfDay(subYears(ref, 1)),
        end: endOfDay(ref),
      }),
    },
    {
      id: 'month_to_date',
      labelKey: 'ui.dateRangePicker.presets.monthToDate',
      range: (ref = new Date()) => ({
        start: startOfMonth(ref),
        end: endOfDay(ref),
      }),
    },
    {
      id: 'year_to_date',
      labelKey: 'ui.dateRangePicker.presets.yearToDate',
      range: (ref = new Date()) => ({
        start: startOfYear(ref),
        end: endOfDay(ref),
      }),
    },
    {
      id: 'all_time',
      labelKey: 'ui.dateRangePicker.presets.allTime',
      range: (ref = new Date()) => ({
        // Symbolic "all time": from epoch to end of reference day.
        start: new Date(0),
        end: endOfDay(ref),
      }),
    },
  ]
}
