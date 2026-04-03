import { createInboundSubscriber } from '../lib/inbound-subscriber'

export const metadata = {
  event: 'example.todo.created',
  persistent: true,
  id: 'example-customers-sync:example-todo-created',
}

export default createInboundSubscriber(metadata.event)
