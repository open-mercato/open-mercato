import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CompanyUsersWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'customer_accounts.injection.company-users',
    title: 'Company Portal Users',
    description: 'Shows portal users associated with a CRM company',
    features: ['customer_accounts.view'],
    priority: 100,
    enabled: true,
  },
  Widget: CompanyUsersWidget,
}

export default widget
