import { createOutboundSubscriber } from '../lib/outbound-subscriber'

export const metadata = {
  event: 'customers.interaction.canceled',
  persistent: true,
  id: 'example-customers-sync:customers-interaction-canceled',
}

export default createOutboundSubscriber(metadata.event)
