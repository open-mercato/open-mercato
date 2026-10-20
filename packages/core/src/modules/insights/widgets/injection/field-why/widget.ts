import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import FieldWhyWidget, { type FieldWhyContext } from './widget.client'

const widget: InjectionWidgetModule<FieldWhyContext, unknown> = {
  metadata: {
    id: 'insights.injection.field-why',
    title: 'Why? (form field)',
    description: 'Shows a "Why?" button after an explainable CrudForm field while explain mode is on.',
    features: ['insights.explain.view'],
    requiredModules: ['customers'],
    priority: 100,
    enabled: true,
  },
  Widget: FieldWhyWidget,
}

export default widget
