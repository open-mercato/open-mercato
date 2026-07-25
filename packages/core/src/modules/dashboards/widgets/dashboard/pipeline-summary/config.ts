import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'

export type PipelineSummarySettings = {
  dateRangeMode: 'global' | 'custom'
  dateRange: DateRangePreset
}

export const DEFAULT_SETTINGS: PipelineSummarySettings = {
  dateRangeMode: 'global',
  dateRange: 'this_month',
}

export function hydrateSettings(raw: unknown): PipelineSummarySettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    dateRangeMode: obj.dateRangeMode === 'custom' ? 'custom' : 'global',
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
  }
}
