import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TransactionCreateActionWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'payment_link_pages.injection.transaction-create-action',
    title: 'Create transaction action',
    features: ['payment_gateways.manage'],
    priority: 100,
  },
  Widget: TransactionCreateActionWidget,
}

export default widget
