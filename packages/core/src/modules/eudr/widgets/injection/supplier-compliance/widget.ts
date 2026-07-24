import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import SupplierComplianceWidget from './widget.client'

const widget: InjectionWidgetModule<unknown, unknown> = {
  metadata: {
    id: 'eudr.injection.supplier-compliance',
    title: 'eudr.supplierPanel.title',
    description: 'EUDR submissions and plot readiness for a supplier company',
    features: ['eudr.submissions.view'],
    priority: 220,
    enabled: true,
  },
  Widget: SupplierComplianceWidget,
}

export default widget
