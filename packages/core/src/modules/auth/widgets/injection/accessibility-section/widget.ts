import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import AccessibilitySectionWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'auth.injection.accessibility-section',
    title: 'Accessibility settings',
    description: 'Manage accessibility preferences for the current user profile.',
    priority: 120,
    enabled: true,
  },
  Widget: AccessibilitySectionWidget,
}

export default widget
