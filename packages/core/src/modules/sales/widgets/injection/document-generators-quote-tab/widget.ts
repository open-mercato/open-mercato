import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DocumentGeneratorsQuoteTabWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'sales.injection.document-generators-quote-tab',
    title: 'Documents',
    features: ['document_generators.view'],
    priority: 10,
  },
  Widget: DocumentGeneratorsQuoteTabWidget,
}

export default widget
