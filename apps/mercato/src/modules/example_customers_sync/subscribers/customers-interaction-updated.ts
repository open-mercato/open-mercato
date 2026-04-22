import { createOutboundSubscriber } from '../lib/outbound-subscriber'

export const metadata = {
  event: 'customers.interaction.updated',
  persistent: true,
  id: 'example-customers-sync:customers-interaction-updated',
}

export default createOutboundSubscriber(metadata.event)
