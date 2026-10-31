import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'

export type ExecutiveBriefSettings = {
  dateRange: DateRangePreset
  showComparison: boolean
}

export const DEFAULT_SETTINGS: ExecutiveBriefSettings = {
  dateRange: 'this_month',
  showComparison: true,
}

export function hydrateSettings(raw: unknown): ExecutiveBriefSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
    showComparison: typeof obj.showComparison === 'boolean' ? obj.showComparison : DEFAULT_SETTINGS.showComparison,
  }
}
