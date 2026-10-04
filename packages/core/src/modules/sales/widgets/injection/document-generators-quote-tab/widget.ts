import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DocumentQuoteGeneratorsTabWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'sales.injection.document-generators-quote-tab',
    title: 'Documents',
    description: 'Generate documents from this sales quote and browse its generated history',
    features: ['document_generators.documents.view', 'sales.quotes.view'],
    priority: 40,
    requiredModules: ['document_generators'],
  },
  Widget: DocumentQuoteGeneratorsTabWidget,
}

export default widget
