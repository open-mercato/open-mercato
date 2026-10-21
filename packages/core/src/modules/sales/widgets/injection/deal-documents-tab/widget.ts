import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DealDocumentsTabWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'sales.injection.deal-documents-tab',
    title: 'Sales documents',
    description: 'Quotes and orders linked to the current deal',
    features: ['sales.orders.view'],
    priority: 40,
  },
  Widget: DealDocumentsTabWidget,
}

export default widget
