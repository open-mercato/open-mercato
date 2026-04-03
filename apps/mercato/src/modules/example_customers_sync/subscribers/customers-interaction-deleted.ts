import { createOutboundSubscriber } from '../lib/outbound-subscriber'

export const metadata = {
  event: 'customers.interaction.deleted',
  persistent: true,
  id: 'example-customers-sync:customers-interaction-deleted',
}

export default createOutboundSubscriber(metadata.event)
