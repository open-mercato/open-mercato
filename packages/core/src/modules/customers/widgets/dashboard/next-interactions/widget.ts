import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import CustomerNextInteractionsWidget from './widget.client'
import {
  DEFAULT_SETTINGS,
  hydrateNextInteractionsSettings,
  type CustomerNextInteractionsSettings,
} from './config'

const widget: DashboardWidgetModule<CustomerNextInteractionsSettings> = {
  metadata: {
    id: 'customers.dashboard.nextInteractions',
    title: 'Next Customer Interactions',
    description: 'See the customers with the next interactions scheduled to stay proactive.',
    features: ['dashboards.view', 'customers.widgets.next-interactions'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['customers', 'activities'],
    category: 'customers',
    icon: 'calendar',
  },
  Widget: CustomerNextInteractionsWidget,
  hydrateSettings: hydrateNextInteractionsSettings,
  dehydrateSettings: (settings) => ({
    pageSize: settings.pageSize,
    includePast: settings.includePast,
  }),
}

export default widget
