import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSalesNewOrdersSettings, type SalesNewOrdersSettings } from './config'

const SalesNewOrdersWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<SalesNewOrdersSettings> = {
  metadata: {
    id: 'sales.dashboard.newOrders',
    title: 'New Orders',
    description: 'Displays recently created sales orders.',
    features: ['dashboards.view', 'sales.widgets.new-orders'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['sales', 'orders'],
    category: 'sales',
    icon: 'shopping-cart',
    supportsRefresh: true,
  },
  Widget: SalesNewOrdersWidget,
  hydrateSettings: hydrateSalesNewOrdersSettings,
  dehydrateSettings: (settings) => ({
    pageSize: settings.pageSize,
    datePeriod: settings.datePeriod,
    customFrom: settings.customFrom,
    customTo: settings.customTo,
  }),
}

export default widget
