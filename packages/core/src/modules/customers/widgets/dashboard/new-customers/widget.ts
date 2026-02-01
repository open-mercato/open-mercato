import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateNewCustomersSettings, type CustomerNewCustomersSettings } from './config'
const CustomerNewCustomersWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<CustomerNewCustomersSettings> = {
  metadata: {
    id: 'customers.dashboard.newCustomers',
    title: 'New Customers',
    description: 'Track the most recently added customers to follow up quickly.',
    features: ['dashboards.view', 'customers.widgets.new-customers'],
    defaultSize: 'sm',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['customers'],
    category: 'customers',
    icon: 'user-plus',
    supportsRefresh: true,
  },
  Widget: CustomerNewCustomersWidget,
  hydrateSettings: hydrateNewCustomersSettings,
  dehydrateSettings: (settings) => ({
    pageSize: settings.pageSize,
    kind: settings.kind,
  }),
}

export default widget
