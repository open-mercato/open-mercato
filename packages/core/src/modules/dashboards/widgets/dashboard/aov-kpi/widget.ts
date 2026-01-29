import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type AovKpiSettings } from './config'
const AovKpiWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<AovKpiSettings> = {
  metadata: {
    id: 'dashboards.analytics.aovKpi',
    title: 'Average Order Value',
    description: 'Average order value with period comparison',
    features: ['analytics.view', 'sales.orders.view'],
    defaultSize: 'sm',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'sales', 'kpi'],
    category: 'analytics',
    icon: 'trending-up',
    supportsRefresh: true,
  },
  Widget: AovKpiWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, showComparison: s.showComparison }),
}

export default widget
