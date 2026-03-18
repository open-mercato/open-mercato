import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TransactionDetailCustomerDataWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, unknown> = {
  metadata: {
    id: 'payment_link_pages.injection.transaction-detail-customer-data',
    title: 'Payment Link Data',
    features: ['payment_gateways.manage'],
    priority: 100,
  },
  Widget: TransactionDetailCustomerDataWidget,
}

export default widget
