import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  subDays,
  subWeeks,
  subMonths,
  subQuarters,
  subYears,
  differenceInDays,
} from 'date-fns'

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_year'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'

export type DateRange = {
  start: Date
  end: Date
}

export type DateRangeOption = {
  value: DateRangePreset
  labelKey: string
}

export const DATE_RANGE_OPTIONS: DateRangeOption[] = [
  { value: 'today', labelKey: 'dashboards.analytics.dateRange.today' },
  { value: 'yesterday', labelKey: 'dashboards.analytics.dateRange.yesterday' },
  { value: 'this_week', labelKey: 'dashboards.analytics.dateRange.thisWeek' },
  { value: 'last_week', labelKey: 'dashboards.analytics.dateRange.lastWeek' },
  { value: 'this_month', labelKey: 'dashboards.analytics.dateRange.thisMonth' },
  { value: 'last_month', labelKey: 'dashboards.analytics.dateRange.lastMonth' },
  { value: 'this_quarter', labelKey: 'dashboards.analytics.dateRange.thisQuarter' },
  { value: 'last_quarter', labelKey: 'dashboards.analytics.dateRange.lastQuarter' },
  { value: 'this_year', labelKey: 'dashboards.analytics.dateRange.thisYear' },
  { value: 'last_year', labelKey: 'dashboards.analytics.dateRange.lastYear' },
  { value: 'last_7_days', labelKey: 'dashboards.analytics.dateRange.last7Days' },
  { value: 'last_30_days', labelKey: 'dashboards.analytics.dateRange.last30Days' },
  { value: 'last_90_days', labelKey: 'dashboards.analytics.dateRange.last90Days' },
]

export function resolveDateRange(preset: DateRangePreset, referenceDate: Date = new Date()): DateRange {
  const today = referenceDate

  switch (preset) {
    case 'today':
      return { start: startOfDay(today), end: endOfDay(today) }

    case 'yesterday': {
      const yesterday = subDays(today, 1)
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) }
    }

    case 'this_week':
      return { start: startOfWeek(today, { weekStartsOn: 1 }), end: endOfWeek(today, { weekStartsOn: 1 }) }

    case 'last_week': {
      const lastWeek = subWeeks(today, 1)
      return { start: startOfWeek(lastWeek, { weekStartsOn: 1 }), end: endOfWeek(lastWeek, { weekStartsOn: 1 }) }
    }

    case 'this_month':
      return { start: startOfMonth(today), end: endOfMonth(today) }

    case 'last_month': {
      const lastMonth = subMonths(today, 1)
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) }
    }

    case 'this_quarter':
      return { start: startOfQuarter(today), end: endOfQuarter(today) }

    case 'last_quarter': {
      const lastQuarter = subQuarters(today, 1)
      return { start: startOfQuarter(lastQuarter), end: endOfQuarter(lastQuarter) }
    }

    case 'this_year':
      return { start: startOfYear(today), end: endOfYear(today) }

    case 'last_year': {
      const lastYear = subYears(today, 1)
      return { start: startOfYear(lastYear), end: endOfYear(lastYear) }
    }

    case 'last_7_days':
      return { start: startOfDay(subDays(today, 6)), end: endOfDay(today) }

    case 'last_30_days':
      return { start: startOfDay(subDays(today, 29)), end: endOfDay(today) }

    case 'last_90_days':
      return { start: startOfDay(subDays(today, 89)), end: endOfDay(today) }

    default:
      return { start: startOfMonth(today), end: endOfMonth(today) }
  }
}

export function getPreviousPeriod(range: DateRange, preset: DateRangePreset): DateRange {
  const daysDiff = differenceInDays(range.end, range.start) + 1

  switch (preset) {
    case 'today':
    case 'yesterday':
      return {
        start: subDays(range.start, 1),
        end: subDays(range.end, 1),
      }

    case 'this_week':
    case 'last_week':
      return {
        start: subWeeks(range.start, 1),
        end: subWeeks(range.end, 1),
      }

    case 'this_month':
    case 'last_month':
      return {
        start: subMonths(range.start, 1),
        end: subMonths(range.end, 1),
      }

    case 'this_quarter':
    case 'last_quarter':
      return {
        start: subQuarters(range.start, 1),
        end: subQuarters(range.end, 1),
      }

    case 'this_year':
    case 'last_year':
      return {
        start: subYears(range.start, 1),
        end: subYears(range.end, 1),
      }

    case 'last_7_days':
    case 'last_30_days':
    case 'last_90_days':
    default:
      return {
        start: subDays(range.start, daysDiff),
        end: subDays(range.end, daysDiff),
      }
  }
}

export function isValidDateRangePreset(value: unknown): value is DateRangePreset {
  if (typeof value !== 'string') return false
  return DATE_RANGE_OPTIONS.some((option) => option.value === value)
}

export function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current === 0 ? 0 : 100
  }
  return ((current - previous) / Math.abs(previous)) * 100
}

export function determineChangeDirection(current: number, previous: number): 'up' | 'down' | 'unchanged' {
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'unchanged'
}

export function getComparisonLabelKey(preset: DateRangePreset): { key: string; fallback: string } {
  switch (preset) {
    case 'today':
      return { key: 'dashboards.analytics.comparison.vsYesterday', fallback: 'vs yesterday' }
    case 'yesterday':
      return { key: 'dashboards.analytics.comparison.vsDayBefore', fallback: 'vs day before' }
    case 'this_week':
      return { key: 'dashboards.analytics.comparison.vsLastWeek', fallback: 'vs last week' }
    case 'last_week':
      return { key: 'dashboards.analytics.comparison.vsWeekBefore', fallback: 'vs week before' }
    case 'this_month':
      return { key: 'dashboards.analytics.comparison.vsLastMonth', fallback: 'vs last month' }
    case 'last_month':
      return { key: 'dashboards.analytics.comparison.vsMonthBefore', fallback: 'vs month before' }
    case 'this_quarter':
      return { key: 'dashboards.analytics.comparison.vsLastQuarter', fallback: 'vs last quarter' }
    case 'last_quarter':
      return { key: 'dashboards.analytics.comparison.vsQuarterBefore', fallback: 'vs quarter before' }
    case 'this_year':
      return { key: 'dashboards.analytics.comparison.vsLastYear', fallback: 'vs last year' }
    case 'last_year':
      return { key: 'dashboards.analytics.comparison.vsYearBefore', fallback: 'vs year before' }
    case 'last_7_days':
      return { key: 'dashboards.analytics.comparison.vsPrevious7Days', fallback: 'vs previous 7 days' }
    case 'last_30_days':
      return { key: 'dashboards.analytics.comparison.vsPrevious30Days', fallback: 'vs previous 30 days' }
    case 'last_90_days':
      return { key: 'dashboards.analytics.comparison.vsPrevious90Days', fallback: 'vs previous 90 days' }
    default:
      return { key: 'dashboards.analytics.comparison.vsPreviousPeriod', fallback: 'vs previous period' }
  }
}
