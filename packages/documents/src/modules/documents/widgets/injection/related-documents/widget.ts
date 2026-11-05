import dynamic from 'next/dynamic'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'

const RelatedDocumentsWidget = dynamic(() => import('./widget.client'))

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'documents.injection.related-documents',
    title: 'Related documents',
    description: 'Lists and creates documents related to the current record.',
    features: ['documents.view'],
    requiredModules: ['documents'],
    priority: 80,
    enabled: true,
  },
  Widget: RelatedDocumentsWidget,
}

export default widget
