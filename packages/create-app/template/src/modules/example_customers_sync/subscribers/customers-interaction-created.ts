import { createOutboundSubscriber } from '../lib/outbound-subscriber'

export const metadata = {
  event: 'customers.interaction.created',
  persistent: true,
  id: 'example-customers-sync:customers-interaction-created',
}

export default createOutboundSubscriber(metadata.event)
