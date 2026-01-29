import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type PipelineSummarySettings } from './config'
const PipelineSummaryWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<PipelineSummarySettings> = {
  metadata: {
    id: 'dashboards.analytics.pipelineSummary',
    title: 'Pipeline Summary',
    description: 'Deal value by pipeline stage',
    features: ['analytics.view', 'customers.deals.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'customers', 'deals', 'chart'],
    category: 'analytics',
    icon: 'git-branch',
    supportsRefresh: true,
  },
  Widget: PipelineSummaryWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange }),
}

export default widget
