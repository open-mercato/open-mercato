import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PortalQuickLinksWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.portal-quick-links',
    title: 'Quick Links',
    description: 'Shortcut cards for common portal actions.',
    priority: 20,
    enabled: true,
  },
  Widget: PortalQuickLinksWidget,
}

export default widget
