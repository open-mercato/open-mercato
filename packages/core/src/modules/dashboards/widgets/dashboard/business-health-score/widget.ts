import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type BusinessHealthScoreSettings } from './config'

const BusinessHealthScoreWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<BusinessHealthScoreSettings> = {
  metadata: {
    id: 'dashboards.analytics.businessHealthScore',
    title: 'Business Health Score',
    description: 'Composite business health score based on revenue, orders, AOV, and customer trends',
    features: ['analytics.view'],
    defaultSize: 'sm',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'intelligence', 'kpi', 'health'],
    category: 'analytics',
    icon: 'activity',
    supportsRefresh: true,
  },
  Widget: BusinessHealthScoreWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, showComparison: s.showComparison }),
}

export default widget
