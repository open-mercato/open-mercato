import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DocumentHistoryWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'sales.injection.document-history',
    title: 'History',
    description: 'Document change history timeline',
    priority: 50,
  },
  Widget: DocumentHistoryWidget,
}

export default widget
