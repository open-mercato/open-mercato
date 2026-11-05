import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type TopProductsSettings } from './config'
const TopProductsWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<TopProductsSettings> = {
  metadata: {
    id: 'dashboards.analytics.topProducts',
    title: 'Top Products',
    description: 'Top-selling products by revenue',
    features: ['analytics.view', 'sales.orders.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'sales', 'products', 'chart'],
    category: 'analytics',
    icon: 'bar-chart-2',
    supportsRefresh: true,
  },
  Widget: TopProductsWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, limit: s.limit, layout: s.layout }),
}

export default widget
