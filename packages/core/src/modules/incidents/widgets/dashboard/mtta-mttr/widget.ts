import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateIncidentMttaMttrSettings, type IncidentMttaMttrSettings } from './config'

const IncidentMttaMttrWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<IncidentMttaMttrSettings> = {
  metadata: {
    id: 'incidents-mtta-mttr',
    title: 'MTTA / MTTR',
    description: 'Average acknowledgement and resolution time for recent incidents.',
    features: ['dashboards.view', 'incidents.incident.view'],
    defaultSize: 'sm',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['incidents', 'operations', 'kpi'],
    category: 'incidents',
    icon: 'timer',
    supportsRefresh: true,
  },
  Widget: IncidentMttaMttrWidget,
  hydrateSettings: hydrateIncidentMttaMttrSettings,
  dehydrateSettings: () => ({}),
}

export default widget
