import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import InvoiceDocumentsTabWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'invoices.injection.document-generators-invoice-tab',
    title: 'Documents',
    description: 'Generate documents from this invoice and browse its generated history',
    features: ['document_generators.documents.view', 'invoices.view'],
    priority: 40,
  },
  Widget: InvoiceDocumentsTabWidget,
}

export default widget
