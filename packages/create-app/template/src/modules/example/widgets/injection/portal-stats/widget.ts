import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PortalStatsWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.portal-stats',
    title: 'example.portal.dashboard.accountOverview.title',
    description: 'example.portal.dashboard.accountOverview.description',
    priority: 5,
    enabled: true,
  },
  Widget: PortalStatsWidget,
}

export default widget
