import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'

export type OrdersByStatusSettings = {
  dateRange: DateRangePreset
  variant: 'pie' | 'donut'
}

export const DEFAULT_SETTINGS: OrdersByStatusSettings = {
  dateRange: 'this_month',
  variant: 'donut',
}

export function hydrateSettings(raw: unknown): OrdersByStatusSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
    variant: obj.variant === 'pie' || obj.variant === 'donut' ? obj.variant : DEFAULT_SETTINGS.variant,
  }
}
