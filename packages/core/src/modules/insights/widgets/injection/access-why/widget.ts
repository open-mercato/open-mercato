import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import AccessWhyWidget, { type AccessWhyContext } from './widget.client'

const widget: InjectionWidgetModule<AccessWhyContext, unknown> = {
  metadata: {
    id: 'insights.injection.access-why',
    title: 'Why? (access denied)',
    description: 'Explains on demand why the signed-in user cannot open a backend page.',
    priority: 100,
    enabled: true,
  },
  Widget: AccessWhyWidget,
}

export default widget
