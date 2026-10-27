import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PortalSupportTicketsWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'staff.injection.portal-support-tickets',
    title: 'staff.portal.support.widget.title',
    description: 'Your open support tickets at a glance.',
    features: ['portal.support_tickets.view'],
    priority: 20,
    enabled: true,
  },
  Widget: PortalSupportTicketsWidget,
}

export default widget
