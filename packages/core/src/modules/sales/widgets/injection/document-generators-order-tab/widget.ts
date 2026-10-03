import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DocumentOrderGeneratorsTabWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'sales.injection.document-generators-order-tab',
    title: 'Documents',
    description: 'Generate documents from this sales order and browse its generated history',
    features: ['document_generators.documents.view', 'sales.orders.view'],
    priority: 40,
  },
  Widget: DocumentOrderGeneratorsTabWidget,
}

export default widget
