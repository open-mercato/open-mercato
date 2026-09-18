import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OrderComplianceWidget, { type OrderRecord } from './widget.client'

const widget: InjectionWidgetModule<unknown, OrderRecord> = {
  metadata: {
    id: 'eudr.injection.order-compliance',
    title: 'EUDR compliance',
    description: 'Due diligence statements linked to the sales order',
    features: ['eudr.statements.view'],
    priority: 210,
    enabled: true,
  },
  Widget: OrderComplianceWidget,
}

export default widget
