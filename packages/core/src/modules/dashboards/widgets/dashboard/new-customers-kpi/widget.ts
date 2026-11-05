import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSettings, type NewCustomersKpiSettings } from './config'
const NewCustomersKpiWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<NewCustomersKpiSettings> = {
  metadata: {
    id: 'dashboards.analytics.newCustomersKpi',
    title: 'Customer Growth',
    description: 'New customer count with period comparison',
    features: ['analytics.view', 'customers.people.view'],
    defaultSize: 'sm',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'customers', 'kpi'],
    category: 'analytics',
    icon: 'user-plus',
    supportsRefresh: true,
  },
  Widget: NewCustomersKpiWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, showComparison: s.showComparison }),
}

export default widget
