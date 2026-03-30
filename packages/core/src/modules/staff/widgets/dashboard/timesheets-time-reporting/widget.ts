import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type TimeReportingSettings } from './config'

const TimeReportingWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<TimeReportingSettings> = {
  metadata: {
    id: 'staff.timesheets.timeReporting',
    title: 'Time Reporting',
    description: 'Quick start/stop timer for the current work item',
    features: ['dashboards.view', 'staff.timesheets.manage_own'],
    defaultSize: 'sm',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['staff', 'timesheets', 'timer'],
    category: 'productivity',
    icon: 'timer',
    supportsRefresh: true,
  },
  Widget: TimeReportingWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ lastProjectId: s.lastProjectId }),
}

export default widget
