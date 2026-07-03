import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type CustomMetricSettings } from './config'

const CustomMetricWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<CustomMetricSettings> = {
  metadata: {
    id: 'dashboards.analytics.customMetric',
    title: 'Custom metric',
    description: 'Build a KPI or chart from any registered metric',
    features: ['dashboards.view', 'dashboards.catalog.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'custom', 'chart'],
    category: 'analytics',
    icon: 'bar-chart-2',
    supportsRefresh: true,
    respectsDashboardDateRange: true,
    supportsMultipleInstances: true,
  },
  Widget: CustomMetricWidget,
  hydrateSettings,
  dehydrateSettings: (settings) => ({
    entityType: settings.entityType,
    metricField: settings.metricField,
    aggregate: settings.aggregate,
    groupByField: settings.groupByField,
    granularity: settings.granularity,
    limit: settings.limit,
    visualization: settings.visualization,
    title: settings.title,
    dateRangeMode: settings.dateRangeMode,
    dateRangePreset: settings.dateRangePreset,
  }),
}

export default widget
