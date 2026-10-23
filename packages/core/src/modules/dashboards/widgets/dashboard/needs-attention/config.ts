import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'

export type NeedsAttentionSettings = {
  dateRange: DateRangePreset
  showComparison: boolean
}

export const DEFAULT_SETTINGS: NeedsAttentionSettings = {
  dateRange: 'this_month',
  showComparison: true,
}

export function hydrateSettings(raw: unknown): NeedsAttentionSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
    showComparison: typeof obj.showComparison === 'boolean' ? obj.showComparison : DEFAULT_SETTINGS.showComparison,
  }
}
