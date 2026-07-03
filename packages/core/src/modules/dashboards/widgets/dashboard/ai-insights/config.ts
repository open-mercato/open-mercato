import { isValidDateRangePreset, type DateRangePreset } from '@open-mercato/ui/backend/date-range'

export type AiInsightsSettings = {
  dateRangeMode: 'global' | 'custom'
  dateRangePreset: string | null
}

export const DEFAULT_SETTINGS: AiInsightsSettings = {
  dateRangeMode: 'global',
  dateRangePreset: null,
}

export function hydrateSettings(raw: unknown): AiInsightsSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  const preset = typeof obj.dateRangePreset === 'string' && isValidDateRangePreset(obj.dateRangePreset)
    ? (obj.dateRangePreset as DateRangePreset)
    : null
  return {
    dateRangeMode: obj.dateRangeMode === 'custom' ? 'custom' : 'global',
    dateRangePreset: preset,
  }
}
