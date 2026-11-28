import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PortalRecentActivityWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.portal-recent-activity',
    title: 'example.portal.dashboard.recentActivity.title',
    description: 'example.portal.dashboard.recentActivity.description',
    priority: 10,
    enabled: true,
  },
  Widget: PortalRecentActivityWidget,
}

export default widget
