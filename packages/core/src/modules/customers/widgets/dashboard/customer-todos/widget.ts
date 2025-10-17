import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import CustomerTodosWidget from './widget.client'
import { DEFAULT_SETTINGS, hydrateCustomerTodoSettings, type CustomerTodoWidgetSettings } from './config'

const widget: DashboardWidgetModule<CustomerTodoWidgetSettings> = {
  metadata: {
    id: 'customers.dashboard.todos',
    title: 'Customer Todos',
    description: 'Review the latest tasks linked to customers and jump directly to their records.',
    features: ['dashboards.view', 'customers.widgets.todos'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['customers', 'activities'],
    category: 'customers',
    icon: 'check-square',
  },
  Widget: CustomerTodosWidget,
  hydrateSettings: hydrateCustomerTodoSettings,
  dehydrateSettings: (settings) => ({
    pageSize: settings.pageSize,
  }),
}

export default widget
