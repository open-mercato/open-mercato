import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import ShipmentTasksActiveWidget from './widget.client'
import { DEFAULT_SETTINGS, hydrateTasksActiveSettings, type ShipmentTasksActiveSettings } from './config'

const widget: DashboardWidgetModule<ShipmentTasksActiveSettings> = {
    metadata: {
        id: 'shipments.dashboard.tasksActive',
        title: 'Active Shipment Tasks',
        description: 'Track tasks that need attention across your shipments.',
        features: ['dashboards.view', 'shipments.widgets.tasks-active'],
        defaultSize: 'md',
        defaultEnabled: true,
        defaultSettings: DEFAULT_SETTINGS,
        tags: ['shipments', 'tasks'],
        category: 'shipments',
        icon: 'clipboard-list',
        supportsRefresh: true,
    },
    Widget: ShipmentTasksActiveWidget,
    hydrateSettings: hydrateTasksActiveSettings,
    dehydrateSettings: (settings) => ({
        pageSize: settings.pageSize,
    }),
}

export default widget