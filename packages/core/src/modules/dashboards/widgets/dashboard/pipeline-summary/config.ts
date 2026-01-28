import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'

export type PipelineSummarySettings = {
  dateRange: DateRangePreset
}

export const DEFAULT_SETTINGS: PipelineSummarySettings = {
  dateRange: 'this_month',
}

export function hydrateSettings(raw: unknown): PipelineSummarySettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
  }
}
