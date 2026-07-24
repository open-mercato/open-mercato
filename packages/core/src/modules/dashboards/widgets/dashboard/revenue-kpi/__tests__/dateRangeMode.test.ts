/**
 * @jest-environment node
 */
import { hydrateSettings as hydrateRevenueKpi } from '../config'
import { hydrateSettings as hydrateAovKpi } from '../../aov-kpi/config'
import { hydrateSettings as hydrateNewCustomersKpi } from '../../new-customers-kpi/config'
import { hydrateSettings as hydrateOrdersByStatus } from '../../orders-by-status/config'
import { hydrateSettings as hydrateOrdersKpi } from '../../orders-kpi/config'
import { hydrateSettings as hydratePipelineSummary } from '../../pipeline-summary/config'
import { hydrateSettings as hydrateRevenueTrend } from '../../revenue-trend/config'
import { hydrateSettings as hydrateSalesByRegion } from '../../sales-by-region/config'
import { hydrateSettings as hydrateTopCustomers } from '../../top-customers/config'
import { hydrateSettings as hydrateTopProducts } from '../../top-products/config'

type DateRangeSettings = {
  dateRangeMode: 'global' | 'custom'
  dateRange: string
}

const hydrators: Array<[string, (raw: unknown) => DateRangeSettings]> = [
  ['aov-kpi', hydrateAovKpi],
  ['new-customers-kpi', hydrateNewCustomersKpi],
  ['orders-by-status', hydrateOrdersByStatus],
  ['orders-kpi', hydrateOrdersKpi],
  ['pipeline-summary', hydratePipelineSummary],
  ['revenue-kpi', hydrateRevenueKpi],
  ['revenue-trend', hydrateRevenueTrend],
  ['sales-by-region', hydrateSalesByRegion],
  ['top-customers', hydrateTopCustomers],
  ['top-products', hydrateTopProducts],
]

describe('analytics widget dateRangeMode hydration', () => {
  test.each(hydrators)('%s defaults missing dateRangeMode to global and preserves the stored preset', (_name, hydrate) => {
    expect(hydrate({ dateRange: 'last_90_days' })).toEqual(expect.objectContaining({
      dateRangeMode: 'global',
      dateRange: 'last_90_days',
    }))
  })

  test.each(hydrators)('%s preserves custom dateRangeMode', (_name, hydrate) => {
    expect(hydrate({ dateRangeMode: 'custom', dateRange: 'last_30_days' })).toEqual(expect.objectContaining({
      dateRangeMode: 'custom',
      dateRange: 'last_30_days',
    }))
  })
})
