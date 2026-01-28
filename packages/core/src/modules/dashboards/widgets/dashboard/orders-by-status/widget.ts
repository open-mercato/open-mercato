import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import OrdersByStatusWidget from './widget.client'
import { DEFAULT_SETTINGS, hydrateSettings, type OrdersByStatusSettings } from './config'

const widget: DashboardWidgetModule<OrdersByStatusSettings> = {
  metadata: {
    id: 'dashboards.analytics.ordersByStatus',
    title: 'Orders by Status',
    description: 'Distribution of orders by status',
    features: ['analytics.view', 'sales.orders.view'],
    defaultSize: 'sm',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'sales', 'chart'],
    category: 'analytics',
    icon: 'pie-chart',
    supportsRefresh: true,
  },
  Widget: OrdersByStatusWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, variant: s.variant }),
}

export default widget
