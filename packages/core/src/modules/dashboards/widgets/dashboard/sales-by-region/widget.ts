import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type SalesByRegionSettings } from './config'
const SalesByRegionWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<SalesByRegionSettings> = {
  metadata: {
    id: 'dashboards.analytics.salesByRegion',
    title: 'Sales by Region',
    description: 'Revenue distribution by shipping region',
    features: ['analytics.view', 'sales.orders.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'sales', 'geography', 'chart'],
    category: 'analytics',
    icon: 'map-pin',
    supportsRefresh: true,
  },
  Widget: SalesByRegionWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, limit: s.limit }),
}

export default widget
