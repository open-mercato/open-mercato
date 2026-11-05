import { createInboundSubscriber } from '../lib/inbound-subscriber'

export const metadata = {
  event: 'example.todo.updated',
  persistent: true,
  id: 'example-customers-sync:example-todo-updated',
}

export default createInboundSubscriber(metadata.event)
