import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import ContainersDischargedWidget from './widget.client'
import { DEFAULT_SETTINGS, hydrateDischargedSettings, type ContainersDischargedSettings } from './config'

const widget: DashboardWidgetModule<ContainersDischargedSettings> = {
    metadata: {
        id: 'shipments.dashboard.containersDiscarged',
        title: 'Discharged Containers',
        description: 'Track containers that have been discharged and are ready for pickup.',
        features: ['dashboards.view', 'shipments.widgets.containers-discharged'],
        defaultSize: 'md',
        defaultEnabled: true,
        defaultSettings: DEFAULT_SETTINGS,
        tags: ['containers', 'logistics'],
        category: 'shipments',
        icon: 'package',
        supportsRefresh: true,
    },
    Widget: ContainersDischargedWidget,
    hydrateSettings: hydrateDischargedSettings,
    dehydrateSettings: (settings) => ({
        pageSize: settings.pageSize,
    }),
}

export default widget