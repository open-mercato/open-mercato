import { type DateRangePreset, isValidDateRangePreset } from '../../../lib/dateRanges'

export type TopCustomersSettings = {
  dateRange: DateRangePreset
  limit: number
}

export const DEFAULT_SETTINGS: TopCustomersSettings = {
  dateRange: 'this_month',
  limit: 10,
}

export function hydrateSettings(raw: unknown): TopCustomersSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  const parsedLimit = Number(obj.limit)
  return {
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
    limit: Number.isFinite(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 20 ? Math.floor(parsedLimit) : DEFAULT_SETTINGS.limit,
  }
}
