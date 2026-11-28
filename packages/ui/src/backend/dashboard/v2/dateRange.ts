import { format } from 'date-fns/format'
import {
  DATE_RANGE_OPTIONS,
  resolveDateRange,
  type DateRangePreset,
} from '../../date-range/dateRanges'
import type {
  DashboardDateRangeCompare,
  DashboardDateRangePreset,
  DashboardGlobalDateRange,
} from '@open-mercato/shared/modules/dashboard/widgets'

export type {
  DashboardDateRangeCompare,
  DashboardDateRangePreset,
  DashboardGlobalDateRange,
} from '@open-mercato/shared/modules/dashboard/widgets'

type ResolvedRange = { from: string; to: string }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function isValidIsoDate(value: string | undefined): value is string {
  if (!value || !DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime()) && toIsoDate(date) === value
}

function assertCustomRange(from?: string, to?: string): ResolvedRange {
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    throw new Error('Invalid custom dashboard date range')
  }
  return { from, to }
}

export function resolveGlobalDateRange(
  preset: DashboardDateRangePreset,
  from?: string,
  to?: string,
): ResolvedRange {
  if (preset === 'custom') return assertCustomRange(from, to)
  const range = resolveDateRange(preset as DateRangePreset)
  return {
    from: toIsoDate(range.start),
    to: toIsoDate(range.end),
  }
}

// Resolved at CALL time, not module load — a tab kept open past midnight must not
// keep hydrating defaults with yesterday's window.
export function defaultGlobalRange(): DashboardGlobalDateRange {
  const resolved = resolveGlobalDateRange('last_30_days')
  return {
    preset: 'last_30_days',
    from: resolved.from,
    to: resolved.to,
    compare: 'previous_period',
  }
}

export const GLOBAL_RANGE_PRESETS: DashboardDateRangePreset[] = [
  ...DATE_RANGE_OPTIONS.map((option) => option.value as DashboardDateRangePreset),
  'custom',
]

export const GLOBAL_RANGE_COMPARE_OPTIONS: DashboardDateRangeCompare[] = [
  'previous_period',
  'previous_year',
  'none',
]
