import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import AccountStatusWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'customer_accounts.injection.account-status',
    title: 'Customer Account Status',
    description: 'Shows customer portal account status on CRM person detail',
    features: ['customer_accounts.view'],
    priority: 100,
    enabled: true,
  },
  Widget: AccountStatusWidget,
}

export default widget
