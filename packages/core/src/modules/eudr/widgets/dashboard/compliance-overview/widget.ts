import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'

export type EudrComplianceOverviewSettings = Record<string, never>

const EudrComplianceOverviewWidget = lazyDashboardWidget<EudrComplianceOverviewSettings>(() => import('./widget.client'))

const widget: DashboardWidgetModule<EudrComplianceOverviewSettings> = {
  metadata: {
    id: 'eudr.dashboard.complianceOverview',
    title: 'EUDR compliance',
    description: 'Track due diligence readiness, evidence completeness, and upcoming EUDR review work.',
    features: ['dashboards.view', 'eudr.statements.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: {},
    tags: ['eudr', 'compliance'],
    category: 'compliance',
    icon: 'leaf',
    supportsRefresh: true,
  },
  Widget: EudrComplianceOverviewWidget,
}

export default widget
