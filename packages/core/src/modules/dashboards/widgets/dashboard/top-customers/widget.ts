import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import TopCustomersWidget from './widget.client'
import { DEFAULT_SETTINGS, hydrateSettings, type TopCustomersSettings } from './config'

const widget: DashboardWidgetModule<TopCustomersSettings> = {
  metadata: {
    id: 'dashboards.analytics.topCustomers',
    title: 'Top Customers',
    description: 'Top customers by revenue',
    features: ['analytics.view', 'sales.orders.view', 'customers.people.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'sales', 'customers', 'table'],
    category: 'analytics',
    icon: 'users',
    supportsRefresh: true,
  },
  Widget: TopCustomersWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, limit: s.limit }),
}

export default widget
