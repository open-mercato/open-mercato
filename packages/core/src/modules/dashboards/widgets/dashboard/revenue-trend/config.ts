import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'
import { type DateGranularity, isValidGranularity } from '../../../lib/aggregations'

export type RevenueTrendSettings = {
  dateRangeMode: 'global' | 'custom'
  dateRange: DateRangePreset
  granularity: DateGranularity
  showArea: boolean
}

export const DEFAULT_SETTINGS: RevenueTrendSettings = {
  dateRangeMode: 'global',
  dateRange: 'last_30_days',
  granularity: 'day',
  showArea: true,
}

export function hydrateSettings(raw: unknown): RevenueTrendSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    dateRangeMode: obj.dateRangeMode === 'custom' ? 'custom' : 'global',
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
    granularity: isValidGranularity(obj.granularity) ? obj.granularity : DEFAULT_SETTINGS.granularity,
    showArea: typeof obj.showArea === 'boolean' ? obj.showArea : DEFAULT_SETTINGS.showArea,
  }
}
