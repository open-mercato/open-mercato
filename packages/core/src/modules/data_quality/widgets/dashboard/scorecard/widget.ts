import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateScorecardSettings, type DataQualityScorecardSettings } from './config'

const DataQualityScorecardWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<DataQualityScorecardSettings> = {
  metadata: {
    id: 'data_quality.dashboard.scorecard',
    title: 'Data Quality Score',
    description: 'Overview scorecard showing quality score, open findings, and last scan status.',
    features: ['dashboards.view', 'data_quality.view'],
    defaultSize: 'sm',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['data_quality', 'operations'],
    category: 'operations',
    icon: 'shield-check',
    supportsRefresh: true,
  },
  Widget: DataQualityScorecardWidget,
  hydrateSettings: hydrateScorecardSettings,
  dehydrateSettings: (settings) => ({
    targetEntityType: settings.targetEntityType,
    severityThreshold: settings.severityThreshold,
  }),
}

export default widget
