import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import {
  DEFAULT_SETTINGS,
  hydrateIncidentRevenueAtRiskSettings,
  type IncidentRevenueAtRiskSettings,
} from './config'

const IncidentRevenueAtRiskWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<IncidentRevenueAtRiskSettings> = {
  metadata: {
    id: 'incidents-revenue-at-risk',
    title: 'Revenue at Risk',
    description: 'Revenue exposure across live incidents.',
    features: ['dashboards.view', 'incidents.incident.view'],
    defaultSize: 'sm',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['incidents', 'revenue', 'kpi'],
    category: 'incidents',
    icon: 'circle-dollar-sign',
    supportsRefresh: true,
  },
  Widget: IncidentRevenueAtRiskWidget,
  hydrateSettings: hydrateIncidentRevenueAtRiskSettings,
  dehydrateSettings: () => ({}),
}

export default widget
