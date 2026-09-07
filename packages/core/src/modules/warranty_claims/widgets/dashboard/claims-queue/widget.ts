import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateWarrantyClaimsQueueSettings, type WarrantyClaimsQueueSettings } from './config'

const WarrantyClaimsQueueWidget = lazyDashboardWidget(() => import('./widget.client'))

const widget: DashboardWidgetModule<WarrantyClaimsQueueSettings> = {
  metadata: {
    id: 'warranty_claims.dashboard.claimsQueue',
    title: 'Warranty Claims Queue',
    description: 'Shows open warranty claims and overdue counts with quick links into the claims list.',
    features: ['dashboards.view', 'warranty_claims.claim.view'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['warranty_claims', 'claims'],
    category: 'warranty_claims',
    icon: 'shield-check',
    supportsRefresh: true,
  },
  Widget: WarrantyClaimsQueueWidget,
  hydrateSettings: hydrateWarrantyClaimsQueueSettings,
  dehydrateSettings: (settings) => ({
    showStatusBreakdown: settings.showStatusBreakdown,
  }),
}

export default widget
