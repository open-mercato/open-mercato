import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type RevenueKpiSettings } from './config'
const RevenueKpiWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<RevenueKpiSettings> = {
  metadata: {
    id: 'dashboards.analytics.revenueKpi',
    title: 'Revenue',
    description: 'Total revenue with period comparison',
    features: ['analytics.view', 'sales.orders.view'],
    defaultSize: 'sm',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'sales', 'kpi'],
    category: 'analytics',
    icon: 'dollar-sign',
    supportsRefresh: true,
  },
  Widget: RevenueKpiWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, showComparison: s.showComparison }),
}

export default widget
