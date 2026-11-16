/**
 * @jest-environment node
 */
import { buildKpiRequest } from '../kpiRequests'

const RANGE = { from: '2026-06-01', to: '2026-06-30', compare: 'previous_period' as const }

describe('buildKpiRequest', () => {
  test('builds the revenue KPI payload', () => {
    const request = buildKpiRequest('revenue', RANGE)

    expect(request.entityType).toBe('sales:orders')
    expect(request.metric).toEqual({ field: 'grandTotalGrossAmount', aggregate: 'sum' })
    expect(request.dateRange).toEqual({ field: 'placedAt', from: RANGE.from, to: RANGE.to })
    expect(request).toMatchInlineSnapshot(`
{
  "comparison": {
    "type": "previous_period",
  },
  "dateRange": {
    "field": "placedAt",
    "from": "2026-06-01",
    "to": "2026-06-30",
  },
  "entityType": "sales:orders",
  "metric": {
    "aggregate": "sum",
    "field": "grandTotalGrossAmount",
  },
}
`)
  })

  test('builds the orders KPI payload', () => {
    const request = buildKpiRequest('orders', RANGE)

    expect(request.entityType).toBe('sales:orders')
    expect(request.metric).toEqual({ field: 'id', aggregate: 'count' })
    expect(request.dateRange).toEqual({ field: 'placedAt', from: RANGE.from, to: RANGE.to })
    expect(request).toMatchInlineSnapshot(`
{
  "comparison": {
    "type": "previous_period",
  },
  "dateRange": {
    "field": "placedAt",
    "from": "2026-06-01",
    "to": "2026-06-30",
  },
  "entityType": "sales:orders",
  "metric": {
    "aggregate": "count",
    "field": "id",
  },
}
`)
  })

  test('builds the AOV KPI payload', () => {
    const request = buildKpiRequest('aov', RANGE)

    expect(request.entityType).toBe('sales:orders')
    expect(request.metric).toEqual({ field: 'grandTotalGrossAmount', aggregate: 'avg' })
    expect(request.dateRange).toEqual({ field: 'placedAt', from: RANGE.from, to: RANGE.to })
    expect(request).toMatchInlineSnapshot(`
{
  "comparison": {
    "type": "previous_period",
  },
  "dateRange": {
    "field": "placedAt",
    "from": "2026-06-01",
    "to": "2026-06-30",
  },
  "entityType": "sales:orders",
  "metric": {
    "aggregate": "avg",
    "field": "grandTotalGrossAmount",
  },
}
`)
  })

  test('builds the new customers KPI payload', () => {
    const request = buildKpiRequest('new_customers', RANGE)

    expect(request.entityType).toBe('customers:entities')
    expect(request.metric).toEqual({ field: 'id', aggregate: 'count' })
    expect(request.dateRange).toEqual({ field: 'createdAt', from: RANGE.from, to: RANGE.to })
    expect(request).toMatchInlineSnapshot(`
{
  "comparison": {
    "type": "previous_period",
  },
  "dateRange": {
    "field": "createdAt",
    "from": "2026-06-01",
    "to": "2026-06-30",
  },
  "entityType": "customers:entities",
  "metric": {
    "aggregate": "count",
    "field": "id",
  },
}
`)
  })

  test('omits comparison when compare is none', () => {
    expect(buildKpiRequest('revenue', { ...RANGE, compare: 'none' })).not.toHaveProperty('comparison')
  })
})
