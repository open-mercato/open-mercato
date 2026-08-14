import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DocumentGeneratorsOrderTabWidget from './widget.client'

// Injection widget that adds a documents tab to the sales order detail page.
// The widget ID must be declared in injection-table.ts under the target slot.
const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.document-generators-order-tab',
    title: 'Documents',
    // Gates the tab by both document access and the owning record permission.
    features: ['document_generators.documents.view', 'sales.orders.view'],
    priority: 10,
  },
  Widget: DocumentGeneratorsOrderTabWidget,
}

export default widget
