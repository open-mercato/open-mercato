import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateIncidentActiveSettings, type IncidentActiveSettings } from './config'

const IncidentActiveWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<IncidentActiveSettings> = {
  metadata: {
    id: 'incidents-active',
    title: 'Active Incidents',
    description: 'Live incident count with severity breakdown.',
    features: ['dashboards.view', 'incidents.incident.view'],
    defaultSize: 'sm',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['incidents', 'kpi'],
    category: 'incidents',
    icon: 'alert-triangle',
    supportsRefresh: true,
  },
  Widget: IncidentActiveWidget,
  hydrateSettings: hydrateIncidentActiveSettings,
  dehydrateSettings: () => ({}),
}

export default widget
