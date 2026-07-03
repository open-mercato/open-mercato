import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'

export type OrdersByStatusSettings = {
  dateRangeMode: 'global' | 'custom'
  dateRange: DateRangePreset
  variant: 'pie' | 'donut'
}

export const DEFAULT_SETTINGS: OrdersByStatusSettings = {
  dateRangeMode: 'global',
  dateRange: 'this_month',
  variant: 'donut',
}

export function hydrateSettings(raw: unknown): OrdersByStatusSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    dateRangeMode: obj.dateRangeMode === 'custom' ? 'custom' : 'global',
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
    variant: obj.variant === 'pie' || obj.variant === 'donut' ? obj.variant : DEFAULT_SETTINGS.variant,
  }
}
