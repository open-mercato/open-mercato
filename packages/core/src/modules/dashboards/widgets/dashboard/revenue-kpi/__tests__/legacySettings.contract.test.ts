import * as aov from '../../aov-kpi/config'
import * as customers from '../../new-customers-kpi/config'
import * as statuses from '../../orders-by-status/config'
import * as orders from '../../orders-kpi/config'
import * as revenue from '../config'
import * as trend from '../../revenue-trend/config'
import * as regions from '../../sales-by-region/config'
import * as topCustomers from '../../top-customers/config'
import * as products from '../../top-products/config'

function legacySettings<Settings extends { dateRangeMode?: 'global' | 'custom' }>(settings: Settings): Omit<Settings, 'dateRangeMode'> {
  const { dateRangeMode: _mode, ...legacy } = settings
  return legacy
}

const legacyInputs = [
  legacySettings(aov.DEFAULT_SETTINGS) satisfies aov.AovKpiSettings,
  legacySettings(customers.DEFAULT_SETTINGS) satisfies customers.NewCustomersKpiSettings,
  legacySettings(statuses.DEFAULT_SETTINGS) satisfies statuses.OrdersByStatusSettings,
  legacySettings(orders.DEFAULT_SETTINGS) satisfies orders.OrdersKpiSettings,
  legacySettings(revenue.DEFAULT_SETTINGS) satisfies revenue.RevenueKpiSettings,
  legacySettings(trend.DEFAULT_SETTINGS) satisfies trend.RevenueTrendSettings,
  legacySettings(regions.DEFAULT_SETTINGS) satisfies regions.SalesByRegionSettings,
  legacySettings(topCustomers.DEFAULT_SETTINGS) satisfies topCustomers.TopCustomersSettings,
  legacySettings(products.DEFAULT_SETTINGS) satisfies products.TopProductsSettings,
]

describe('legacy analytics settings input contract', () => {
  test.each(legacyInputs)('accepts settings without the new date-range mode', (settings) => {
    expect(settings).not.toHaveProperty('dateRangeMode')
    expect(settings).toHaveProperty('dateRange')
  })
})
