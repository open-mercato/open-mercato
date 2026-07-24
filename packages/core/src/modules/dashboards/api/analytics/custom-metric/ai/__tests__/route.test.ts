/**
 * @jest-environment node
 */
import { customMetricAiConfigSchema, sanitizeAiConfig } from '../route'
import type { AnalyticsCatalogResponse } from '../../../catalog/route'

const catalog: AnalyticsCatalogResponse = {
  entities: [
    {
      entityType: 'sales:orders',
      label: 'Orders',
      dateField: 'placedAt',
      fields: [
        { field: 'id', label: 'ID', kind: 'uuid', aggregates: ['count'], groupable: false },
        { field: 'grandTotalGrossAmount', label: 'Total', kind: 'numeric', aggregates: ['sum', 'avg', 'count', 'min', 'max'], groupable: false },
        { field: 'status', label: 'Status', kind: 'text', aggregates: ['count'], groupable: true },
        { field: 'placedAt', label: 'Placed at', kind: 'timestamp', aggregates: ['count'], groupable: true },
      ],
    },
  ],
}

const baseConfig = {
  entityType: 'sales:orders',
  metricField: 'id',
  aggregate: 'count' as const,
  groupByField: null,
  granularity: null,
  limit: 10,
  visualization: 'kpi' as const,
  title: 'Orders',
  dateRangeMode: 'global' as const,
  dateRangePreset: null,
}

describe('custom metric AI route helpers', () => {
  test('rejects a hallucinated entity type the caller cannot query', () => {
    expect(sanitizeAiConfig({ ...baseConfig, entityType: 'evil:secrets' }, catalog)).toBeNull()
  })

  test('nulls field references that do not exist on the entity but keeps a valid config', () => {
    const result = sanitizeAiConfig(
      { ...baseConfig, metricField: 'nope', groupByField: 'ghost', visualization: 'bar', limit: 5 },
      catalog,
    )
    expect(result).not.toBeNull()
    expect(result?.entityType).toBe('sales:orders')
    expect(result?.metricField).toBeNull()
    expect(result?.groupByField).toBeNull()
  })

  test('preserves valid field references', () => {
    const result = sanitizeAiConfig(
      { ...baseConfig, metricField: 'grandTotalGrossAmount', aggregate: 'sum', groupByField: 'status', visualization: 'bar', limit: 5 },
      catalog,
    )
    expect(result?.metricField).toBe('grandTotalGrossAmount')
    expect(result?.groupByField).toBe('status')
  })

  test('repairs explicit bar-by-day prompts to use the date field instead of a categorical fallback', () => {
    const result = sanitizeAiConfig(
      {
        ...baseConfig,
        metricField: 'grandTotalGrossAmount',
        aggregate: 'sum',
        groupByField: 'status',
        visualization: 'bar',
        granularity: null,
        dateRangeMode: 'global',
        dateRangePreset: null,
        title: 'Suma kwot zamówień po dniach',
      },
      catalog,
      'potrzebuję wykres słupkowy z sumą kwot zamówień wszystkich klientów dla każdego dnia tygodnia za ostatnie 7 dni, grupowane po dniach, nie po klientach',
    )

    expect(result).toMatchObject({
      entityType: 'sales:orders',
      metricField: 'grandTotalGrossAmount',
      aggregate: 'sum',
      groupByField: 'placedAt',
      granularity: 'day',
      visualization: 'bar',
      dateRangeMode: 'custom',
      dateRangePreset: 'last_7_days',
    })
  })

  test('keeps timestamp grouping for bar charts when the model already chose it', () => {
    const result = sanitizeAiConfig(
      {
        ...baseConfig,
        metricField: 'grandTotalGrossAmount',
        aggregate: 'sum',
        groupByField: 'placedAt',
        granularity: 'week',
        visualization: 'bar',
      },
      catalog,
      'Sales by week as a bar chart',
    )

    expect(result?.groupByField).toBe('placedAt')
    expect(result?.granularity).toBe('week')
    expect(result?.visualization).toBe('bar')
  })

  test('schema rejects an out-of-range limit and an unknown visualization', () => {
    expect(customMetricAiConfigSchema.safeParse({ ...baseConfig, limit: 99 }).success).toBe(false)
    expect(customMetricAiConfigSchema.safeParse({ ...baseConfig, visualization: 'pie' }).success).toBe(false)
  })
})
