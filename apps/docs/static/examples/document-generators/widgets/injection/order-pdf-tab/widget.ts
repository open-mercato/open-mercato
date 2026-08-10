import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OrderPdfTabWidget from './widget.client'

// Injection widget that adds a "PDF" tab to the sales order detail page.
// The widget ID must be declared in injection-table.ts under the target slot.
const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.order_pdf_tab',
    title: 'PDF',
    // Gates the tab — users without document_generators.view will not see it
    features: ['document_generators.view'],
    priority: 10,
  },
  Widget: OrderPdfTabWidget,
}

export default widget
