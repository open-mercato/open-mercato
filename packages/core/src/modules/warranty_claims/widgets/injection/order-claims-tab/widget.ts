import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OrderClaimsTabWidget from '../order-claims-tab'

type OrderClaimsContext = {
  kind: 'order' | 'quote'
  record: { id: string }
}

const widget: InjectionWidgetModule<OrderClaimsContext, unknown> = {
  metadata: {
    id: 'warranty_claims.injection.order-claims-tab',
    title: 'Claims',
    description: 'Warranty and RMA claims linked to the current sales order',
    features: ['warranty_claims.claim.view'],
    priority: 40,
    enabled: true,
  },
  Widget: OrderClaimsTabWidget,
}

export default widget
