import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import FieldExplainToggleWidget, { type FieldExplainToggleContext } from './widget.client'

const widget: InjectionWidgetModule<FieldExplainToggleContext, unknown> = {
  metadata: {
    id: 'insights.injection.field-explain-toggle',
    title: 'Explain fields switch',
    description: 'Turns the per-field "Why?" buttons of an explainable edit form on or off.',
    features: ['insights.explain.view'],
    requiredModules: ['customers'],
    priority: 100,
    enabled: true,
  },
  Widget: FieldExplainToggleWidget,
}

export default widget
