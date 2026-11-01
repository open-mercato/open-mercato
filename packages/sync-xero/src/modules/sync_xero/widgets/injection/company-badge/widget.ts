import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import XeroCompanyBadgeWidget, { type XeroCompanyBadgeContext } from './widget.client'

const widget: InjectionWidgetModule<XeroCompanyBadgeContext> = {
  metadata: {
    id: 'sync_xero.injection.company-badge',
    title: 'sync_xero.badge.title',
    features: ['customers.companies.view'],
    priority: 100,
  },
  Widget: XeroCompanyBadgeWidget,
}

export default widget
