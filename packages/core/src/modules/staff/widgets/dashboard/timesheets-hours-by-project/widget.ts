import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type HoursByProjectSettings } from './config'

const HoursByProjectWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<HoursByProjectSettings> = {
  metadata: {
    id: 'staff.timesheets.hoursByProject',
    title: 'Hours by Project',
    description: 'Tracked hours grouped by project for a selected period',
    features: ['dashboards.view', 'analytics.view', 'staff.timesheets.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'staff', 'timesheets'],
    category: 'analytics',
    icon: 'clock',
    supportsRefresh: true,
  },
  Widget: HoursByProjectWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange }),
}

export default widget
