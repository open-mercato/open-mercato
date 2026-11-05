import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateNewDealsSettings, type CustomerNewDealsSettings } from './config'
const CustomerNewDealsWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<CustomerNewDealsSettings> = {
  metadata: {
    id: 'customers.dashboard.newDeals',
    title: 'New Deals',
    description: 'Track the most recently created customer deals to follow up quickly.',
    features: ['dashboards.view', 'customers.widgets.new-deals'],
    defaultSize: 'sm',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['customers', 'deals'],
    category: 'customers',
    icon: 'handshake',
    supportsRefresh: true,
  },
  Widget: CustomerNewDealsWidget,
  hydrateSettings: hydrateNewDealsSettings,
  dehydrateSettings: (settings) => ({
    pageSize: settings.pageSize,
  }),
}

export default widget
