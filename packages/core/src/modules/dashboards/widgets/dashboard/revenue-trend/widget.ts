import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type RevenueTrendSettings } from './config'
const RevenueTrendWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<RevenueTrendSettings> = {
  metadata: {
    id: 'dashboards.analytics.revenueTrend',
    title: 'Revenue Trend',
    description: 'Revenue over time with customizable granularity',
    features: ['analytics.view', 'sales.orders.view'],
    defaultSize: 'lg',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'sales', 'chart'],
    category: 'analytics',
    icon: 'line-chart',
    supportsRefresh: true,
  },
  Widget: RevenueTrendWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, granularity: s.granularity, showArea: s.showArea }),
}

export default widget
