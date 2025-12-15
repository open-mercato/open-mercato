import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import ShipmentsPreArrivalWidget from './widget.client'
import { DEFAULT_SETTINGS, hydratePreArrivalSettings, type ShipmentsPreArrivalSettings } from './config'

const widget: DashboardWidgetModule<ShipmentsPreArrivalSettings> = {
    metadata: {
        id: 'shipments.dashboard.preArrival',
        title: 'Shipments Pre-Arrival',
        description: 'Monitor shipments approaching destination ports.',
        features: ['dashboards.view'],
        defaultSize: 'md',
        defaultEnabled: true,
        defaultSettings: DEFAULT_SETTINGS,
        tags: ['shipments', 'logistics'],
        category: 'shipments',
        icon: 'anchor',
        supportsRefresh: true,
    },
    Widget: ShipmentsPreArrivalWidget,
    hydrateSettings: hydratePreArrivalSettings,
    dehydrateSettings: (settings) => ({
        pageSize: settings.pageSize,
    }),
}

export default widget