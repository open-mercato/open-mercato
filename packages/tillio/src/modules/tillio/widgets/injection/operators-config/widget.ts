import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OperatorsConfigWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'tillio.injection.operators',
    title: 'Operator configuration',
    description: 'Attach one Tillio operator (Ringostat) on top of the configured environment.',
    features: ['tillio.manage', 'integrations.manage'],
    priority: 100,
    enabled: true,
  },
  Widget: OperatorsConfigWidget,
}

export default widget
