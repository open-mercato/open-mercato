import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CreditPanelWidget from '../credit-panel'

type CreditPanelContext = {
  resourceKind: string
  resourceId: string
}

const widget: InjectionWidgetModule<CreditPanelContext, unknown> = {
  metadata: {
    id: 'customer_groups.injection.credit-panel',
    title: 'Credit',
    description: 'Credit account for the current customer (limit, exposure, hold state)',
    features: ['customer_groups.credit.view'],
    priority: 46,
    enabled: true,
  },
  Widget: CreditPanelWidget,
}

export default widget
