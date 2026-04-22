import { createInboundSubscriber } from '../lib/inbound-subscriber'

export const metadata = {
  event: 'example.todo.deleted',
  persistent: true,
  id: 'example-customers-sync:example-todo-deleted',
}

export default createInboundSubscriber(metadata.event)
