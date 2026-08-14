import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DocumentGeneratorsOrderTabWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'sales.injection.document-generators-order-tab',
    title: 'Documents',
    features: ['document_generators.documents.view', 'sales.orders.view'],
    priority: 10,
  },
  Widget: DocumentGeneratorsOrderTabWidget,
}

export default widget
