import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateSalesNewQuotesSettings, type SalesNewQuotesSettings } from './config'

const SalesNewQuotesWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<SalesNewQuotesSettings> = {
  metadata: {
    id: 'sales.dashboard.newQuotes',
    title: 'New Quotes',
    description: 'Displays recently created sales quotes.',
    features: ['dashboards.view', 'sales.widgets.new-quotes'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['sales', 'quotes'],
    category: 'sales',
    icon: 'file-text',
    supportsRefresh: true,
  },
  Widget: SalesNewQuotesWidget,
  hydrateSettings: hydrateSalesNewQuotesSettings,
  dehydrateSettings: (settings) => ({
    pageSize: settings.pageSize,
    datePeriod: settings.datePeriod,
    customFrom: settings.customFrom,
    customTo: settings.customTo,
  }),
}

export default widget
