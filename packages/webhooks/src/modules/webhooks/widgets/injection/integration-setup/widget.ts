import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import IntegrationSetupWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'webhooks.integration-setup',
    title: 'Webhook Configuration',
    description: 'Shortcut links and status guidance for Custom Webhooks.',
    priority: 90,
  },
  Widget: IntegrationSetupWidget,
}

export default widget
