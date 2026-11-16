/**
 * @jest-environment node
 */
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

import type { DashboardWidgetRenderContext } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS } from '../config'
import { buildRequest, normalizeSettings, type CatalogEntity } from '../lib'

const entity: CatalogEntity = {
  entityType: 'sales:orders',
  label: 'Sales orders',
  dateField: 'placedAt',
  fields: [
    { field: 'id', label: 'ID', kind: 'uuid', aggregates: ['count'], groupable: false },
    { field: 'grandTotalGrossAmount', label: 'Grand total', kind: 'numeric', aggregates: ['sum', 'avg', 'count', 'min', 'max'], groupable: false },
    { field: 'status', label: 'Status', kind: 'text', aggregates: ['count'], groupable: true },
    { field: 'placedAt', label: 'Placed at', kind: 'timestamp', aggregates: ['count'], groupable: true },
  ],
}
const context: DashboardWidgetRenderContext = { userId: 'user-1' }

describe('custom metric lib', () => {
  test('buildRequest is null until an entity and metric are chosen', () => {
    expect(buildRequest(DEFAULT_SETTINGS, null, context)).toBeNull()

    const withEntity = normalizeSettings({ ...DEFAULT_SETTINGS, entityType: 'sales:orders' }, [entity])
    expect(withEntity.metricField).not.toBeNull()

    const request = buildRequest(withEntity, entity, context)
    expect(request).not.toBeNull()
    expect(request?.entityType).toBe('sales:orders')
    expect(request?.metric.aggregate).toBe('count')
  })

  test('sum aggregate selects a numeric field', () => {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, entityType: 'sales:orders', aggregate: 'sum' }, [entity])
    expect(settings.metricField).toBe('grandTotalGrossAmount')
    expect(buildRequest(settings, entity, context)?.metric).toEqual({ field: 'grandTotalGrossAmount', aggregate: 'sum' })
  })

  test('non-kpi visualization requires a group-by and emits groupBy', () => {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, entityType: 'sales:orders', visualization: 'bar' }, [entity])
    expect(settings.groupByField).toBe('status')
    expect(buildRequest(settings, entity, context)?.groupBy).toMatchObject({ field: 'status', resolveLabels: true })

    expect(buildRequest({ ...settings, groupByField: null }, entity, context)).toBeNull()
  })

  test('bar visualization can group by a timestamp field with granularity', () => {
    const settings = normalizeSettings(
      { ...DEFAULT_SETTINGS, entityType: 'sales:orders', visualization: 'bar', groupByField: 'placedAt', granularity: 'day' },
      [entity],
    )
    expect(settings.groupByField).toBe('placedAt')
    expect(settings.granularity).toBe('day')
    expect(buildRequest(settings, entity, context)?.groupBy).toMatchObject({ field: 'placedAt', granularity: 'day' })
  })

  test('line visualization prefers the entity date field and sets granularity', () => {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, entityType: 'sales:orders', visualization: 'line' }, [entity])
    expect(settings.groupByField).toBe('placedAt')
    expect(settings.granularity).toBe('day')
    expect(buildRequest(settings, entity, context)?.groupBy).toMatchObject({ field: 'placedAt', granularity: 'day' })
  })
})
