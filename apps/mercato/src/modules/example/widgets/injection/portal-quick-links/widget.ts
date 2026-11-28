import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PortalQuickLinksWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.portal-quick-links',
    title: 'example.portal.dashboard.quickLinks.title',
    description: 'example.portal.dashboard.quickLinks.description',
    priority: 20,
    enabled: true,
  },
  Widget: PortalQuickLinksWidget,
}

export default widget
