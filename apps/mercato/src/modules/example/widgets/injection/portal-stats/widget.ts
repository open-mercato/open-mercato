import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PortalStatsWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.portal-stats',
    title: 'Account Overview',
    description: 'Key account metrics at a glance.',
    priority: 5,
    enabled: true,
  },
  Widget: PortalStatsWidget,
}

export default widget
