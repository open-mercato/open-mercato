import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'

export type ChartLayout = 'horizontal' | 'vertical'

export type TopProductsSettings = {
  dateRangeMode: 'global' | 'custom'
  dateRange: DateRangePreset
  limit: number
  layout: ChartLayout
}

export const DEFAULT_SETTINGS: TopProductsSettings = {
  dateRangeMode: 'global',
  dateRange: 'this_month',
  limit: 10,
  layout: 'horizontal',
}

export function hydrateSettings(raw: unknown): TopProductsSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  const parsedLimit = Number(obj.limit)
  const layout = obj.layout === 'vertical' ? 'vertical' : 'horizontal'
  return {
    dateRangeMode: obj.dateRangeMode === 'custom' ? 'custom' : 'global',
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
    limit: Number.isFinite(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 20 ? Math.floor(parsedLimit) : DEFAULT_SETTINGS.limit,
    layout,
  }
}
