import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'

export type InsightsProcessHealthSettings = Record<string, never>

const InsightsProcessHealthWidget = lazyDashboardWidget<InsightsProcessHealthSettings>(() => import('./widget.client'))

const widget: DashboardWidgetModule<InsightsProcessHealthSettings> = {
  metadata: {
    id: 'insights.dashboard.processHealth',
    title: 'Process health',
    description: 'Busiest processes of the last 30 days: cases, open cases, median cycle time and the longest wait (Process X-Ray).',
    features: ['dashboards.view', 'insights.xray.view'],
    defaultSize: 'md',
    defaultEnabled: false,
    defaultSettings: {},
    tags: ['insights', 'process-xray'],
    category: 'insights',
    icon: 'git-branch',
    supportsRefresh: true,
  },
  Widget: InsightsProcessHealthWidget,
}

export default widget
