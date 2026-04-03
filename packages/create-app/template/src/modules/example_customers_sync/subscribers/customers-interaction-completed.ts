import { createOutboundSubscriber } from '../lib/outbound-subscriber'

export const metadata = {
  event: 'customers.interaction.completed',
  persistent: true,
  id: 'example-customers-sync:customers-interaction-completed',
}

export default createOutboundSubscriber(metadata.event)
