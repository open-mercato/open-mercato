import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type ExecutiveBriefSettings } from './config'

const ExecutiveBriefWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<ExecutiveBriefSettings> = {
  metadata: {
    id: 'dashboards.analytics.executiveBrief',
    title: 'Executive Brief',
    description: 'Concise executive summary distilling multi-metric performance into actionable insights',
    features: ['analytics.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'intelligence', 'brief', 'executive'],
    category: 'analytics',
    icon: 'file-text',
    supportsRefresh: true,
  },
  Widget: ExecutiveBriefWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, showComparison: s.showComparison }),
}

export default widget
