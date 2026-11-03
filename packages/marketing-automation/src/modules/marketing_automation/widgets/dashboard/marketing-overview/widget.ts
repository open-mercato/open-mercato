import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateMarketingOverviewSettings, type MarketingOverviewSettings } from './config'

/**
 * Marketing on the dashboard: what went out this week, who engaged, and what it earned.
 *
 * The morning-after question, on the screen people open first. Everything it shows already existed behind the
 * results screen of one campaign at a time — the widget's contribution is the ORGANISATION-wide answer, which
 * nothing else in the module gave.
 *
 * `lazyDashboardWidget` with a DYNAMIC import is load-bearing, not style: the CLI bundler stubs local
 * `*.client` dynamic imports only, so a static import would pull the browser subgraph into every CLI entry
 * point and break `yarn dev` for the whole monorepo.
 */
const MarketingOverviewWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<MarketingOverviewSettings> = {
  metadata: {
    id: 'marketing_automation.dashboard.overview',
    title: 'Marketing this week',
    description: 'Sends, engagement and attributed revenue across every campaign.',
    /**
     * Both gates. `dashboards.view` is having a dashboard at all; `runs.view` is being allowed to see
     * engagement counts — the same feature the run list and the results screen are gated on, because these
     * are the same facts.
     */
    features: ['dashboards.view', 'marketing_automation.runs.view'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['marketing', 'campaigns'],
    category: 'marketing',
    icon: 'megaphone',
    supportsRefresh: true,
  },
  Widget: MarketingOverviewWidget,
  hydrateSettings: hydrateMarketingOverviewSettings,
  dehydrateSettings: (settings) => ({ windowDays: settings.windowDays }),
}

export default widget
