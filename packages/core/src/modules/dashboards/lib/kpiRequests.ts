import type { DashboardDateRangeCompare, DashboardGlobalDateRange } from '@open-mercato/shared/modules/dashboard/widgets'
import type { DateGranularity } from '@open-mercato/shared/modules/analytics'
import type { DateRangePreset } from '@open-mercato/ui/backend/date-range'
import type { WidgetDataRequest, WidgetDataResponse } from '../services/widgetDataService'

export type KpiKey = 'revenue' | 'orders' | 'aov' | 'new_customers'

export const KPI_KEYS: readonly KpiKey[] = ['revenue', 'orders', 'aov', 'new_customers']

export type KpiRangeInput = { from: string; to: string; compare: DashboardDateRangeCompare }
export type KpiDateRangeMode = 'global' | 'custom'
export type KpiWidgetRequestInput = {
  dateRangeMode: KpiDateRangeMode
  dateRange: DateRangePreset
  compare: DashboardDateRangeCompare
  dashboardDateRange?: DashboardGlobalDateRange
}

type KpiDefinition = {
  entityType: string
  metric: WidgetDataRequest['metric']
  dateField: string
}

const KPI_DEFINITIONS: Record<KpiKey, KpiDefinition> = {
  revenue: {
    entityType: 'sales:orders',
    metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
    dateField: 'placedAt',
  },
  orders: {
    entityType: 'sales:orders',
    metric: { field: 'id', aggregate: 'count' },
    dateField: 'placedAt',
  },
  aov: {
    entityType: 'sales:orders',
    metric: { field: 'grandTotalGrossAmount', aggregate: 'avg' },
    dateField: 'placedAt',
  },
  new_customers: {
    entityType: 'customers:entities',
    metric: { field: 'id', aggregate: 'count' },
    dateField: 'createdAt',
  },
}

function comparisonFromCompare(compare: DashboardDateRangeCompare): WidgetDataRequest['comparison'] | undefined {
  if (compare === 'none') return undefined
  return { type: compare }
}

function daysBetween(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`)
  const toTime = Date.parse(`${to}T00:00:00.000Z`)
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime < fromTime) return 1
  return Math.floor((toTime - fromTime) / 86_400_000) + 1
}

function autoGranularityForDays(days: number): DateGranularity {
  if (days <= 31) return 'day'
  if (days <= 120) return 'week'
  if (days <= 730) return 'month'
  if (days <= 1460) return 'quarter'
  return 'year'
}

export function getKpiAutoGranularity(range: KpiRangeInput): DateGranularity {
  return autoGranularityForDays(daysBetween(range.from, range.to))
}

export function getKpiPresetAutoGranularity(preset: DateRangePreset): DateGranularity {
  switch (preset) {
    case 'today':
    case 'yesterday':
    case 'this_week':
    case 'last_week':
    case 'last_7_days':
    case 'last_30_days':
      return 'day'
    case 'this_month':
    case 'last_month':
    case 'this_quarter':
    case 'last_quarter':
    case 'last_90_days':
      return 'week'
    case 'this_year':
    case 'last_year':
      return 'month'
    default:
      return 'day'
  }
}

export function buildKpiRequest(key: KpiKey, range: KpiRangeInput): WidgetDataRequest {
  const definition = KPI_DEFINITIONS[key]
  const request: WidgetDataRequest = {
    entityType: definition.entityType,
    metric: definition.metric,
    dateRange: {
      field: definition.dateField,
      from: range.from,
      to: range.to,
    },
  }
  const comparison = comparisonFromCompare(range.compare)
  if (comparison) request.comparison = comparison
  return request
}

export function buildKpiPresetRequest(
  key: KpiKey,
  preset: DateRangePreset,
  compare: DashboardDateRangeCompare,
): WidgetDataRequest {
  const definition = KPI_DEFINITIONS[key]
  const request: WidgetDataRequest = {
    entityType: definition.entityType,
    metric: definition.metric,
    dateRange: {
      field: definition.dateField,
      preset,
    },
  }
  const comparison = comparisonFromCompare(compare)
  if (comparison) request.comparison = comparison
  return request
}

export function buildKpiSeriesRequest(key: KpiKey, range: KpiRangeInput): WidgetDataRequest {
  const definition = KPI_DEFINITIONS[key]
  return {
    entityType: definition.entityType,
    metric: definition.metric,
    groupBy: {
      field: definition.dateField,
      granularity: getKpiAutoGranularity(range),
    },
    dateRange: {
      field: definition.dateField,
      from: range.from,
      to: range.to,
    },
  }
}

export function buildKpiPresetSeriesRequest(key: KpiKey, preset: DateRangePreset): WidgetDataRequest {
  const definition = KPI_DEFINITIONS[key]
  return {
    entityType: definition.entityType,
    metric: definition.metric,
    groupBy: {
      field: definition.dateField,
      granularity: getKpiPresetAutoGranularity(preset),
    },
    dateRange: {
      field: definition.dateField,
      preset,
    },
  }
}

export function buildKpiWidgetRequests(
  key: KpiKey,
  input: KpiWidgetRequestInput,
): { valueRequest: WidgetDataRequest; seriesRequest: WidgetDataRequest; compare: DashboardDateRangeCompare; usesDashboardDateRange: boolean } {
  if (input.dateRangeMode === 'global' && input.dashboardDateRange) {
    const range = {
      from: input.dashboardDateRange.from,
      to: input.dashboardDateRange.to,
      compare: input.dashboardDateRange.compare,
    }
    return {
      valueRequest: buildKpiRequest(key, range),
      seriesRequest: buildKpiSeriesRequest(key, range),
      compare: input.dashboardDateRange.compare,
      usesDashboardDateRange: true,
    }
  }

  return {
    valueRequest: buildKpiPresetRequest(key, input.dateRange, input.compare),
    seriesRequest: buildKpiPresetSeriesRequest(key, input.dateRange),
    compare: input.compare,
    usesDashboardDateRange: false,
  }
}

export function mapKpiSeriesToTrend(response: WidgetDataResponse): number[] {
  return [...response.data]
    .sort((a, b) => {
      const aTime = new Date((a.groupKey as string | null) || 0).getTime()
      const bTime = new Date((b.groupKey as string | null) || 0).getTime()
      return aTime - bTime
    })
    .map((item) => item.value ?? 0)
}
