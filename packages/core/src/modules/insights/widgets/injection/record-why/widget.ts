import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import RecordWhyWidget, { type RecordWhyContext } from './widget.client'

const widget: InjectionWidgetModule<RecordWhyContext, unknown> = {
  metadata: {
    id: 'insights.injection.record-why',
    title: 'Why? (record)',
    description: 'Opens the "Why?" explanation drawer for the record shown on a detail page.',
    features: ['insights.explain.view'],
    priority: 100,
    enabled: true,
  },
  Widget: RecordWhyWidget,
}

export default widget
