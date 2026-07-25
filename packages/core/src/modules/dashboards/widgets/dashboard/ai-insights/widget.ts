import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type AiInsightsSettings } from './config'

const AiInsightsWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<AiInsightsSettings> = {
  metadata: {
    id: 'dashboards.analytics.aiInsights',
    title: 'AI insights',
    description: 'What changed and why, generated from your KPIs',
    features: ['dashboards.view', 'dashboards.insights.view'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'ai'],
    category: 'analytics',
    icon: 'sparkles',
    supportsRefresh: true,
    respectsDashboardDateRange: true,
  },
  Widget: AiInsightsWidget,
  hydrateSettings,
  dehydrateSettings: (settings) => ({
    dateRangeMode: settings.dateRangeMode,
    dateRangePreset: settings.dateRangePreset,
  }),
}

export default widget
