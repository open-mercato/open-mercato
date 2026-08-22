import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CustomerClaimsTabWidget from '../customer-claims-tab'

type CustomerClaimsContext = {
  resourceKind: string
  resourceId: string
}

const widget: InjectionWidgetModule<CustomerClaimsContext, unknown> = {
  metadata: {
    id: 'warranty_claims.injection.customer-claims-tab',
    title: 'Claims',
    description: 'Warranty and RMA claims linked to the current customer',
    features: ['warranty_claims.claim.view'],
    priority: 40,
    enabled: true,
  },
  Widget: CustomerClaimsTabWidget,
}

export default widget
