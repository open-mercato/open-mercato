import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import IntegrationDeliveriesWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'webhooks.integration-deliveries',
    title: 'Webhook Deliveries',
    description: 'Aggregated delivery log across all configured webhooks.',
    priority: 90,
  },
  Widget: IntegrationDeliveriesWidget,
}

export default widget
