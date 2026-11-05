import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OrderApprovalWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'workflows.injection.order-approval',
    title: 'Order Approval',
    description: 'Approve or reject orders requiring authorization',
    features: ['sales.orders.approve'],
    priority: 100,
    enabled: true,
  },
  Widget: OrderApprovalWidget,
}

export default widget
