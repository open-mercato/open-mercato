import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import OrdersKpiWidget from './widget.client'
import { DEFAULT_SETTINGS, hydrateSettings, type OrdersKpiSettings } from './config'

const widget: DashboardWidgetModule<OrdersKpiSettings> = {
  metadata: {
    id: 'dashboards.analytics.ordersKpi',
    title: 'Orders',
    description: 'Total order count with period comparison',
    features: ['analytics.view', 'sales.orders.view'],
    defaultSize: 'sm',
    defaultEnabled: false,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['analytics', 'sales', 'kpi'],
    category: 'analytics',
    icon: 'shopping-cart',
    supportsRefresh: true,
  },
  Widget: OrdersKpiWidget,
  hydrateSettings,
  dehydrateSettings: (s) => ({ dateRange: s.dateRange, showComparison: s.showComparison }),
}

export default widget
