import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type NeedsAttentionSettings } from './config'

const NeedsAttentionWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<NeedsAttentionSettings> = {
  metadata: {
    id: 'dashboards.analytics.needsAttention',
    title: 'Needs Attention',
    description: 'Prioritized operational highlights and performance anomalies requiring attention',
    features: ['analytics.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'intelligence', 'alerts', 'attention'],
    category: 'analytics',
    icon: 'alert-triangle',
    supportsRefresh: true,
  },
  Widget: NeedsAttentionWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, showComparison: s.showComparison }),
}

export default widget
