import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Example Module Events
 *
 * Declares all events that can be emitted by the example module.
 */
const events = [
  { id: 'example.ping', label: 'Example Ping', entity: 'example', category: 'lifecycle' },
  // Todos (clientBroadcast enables real-time UI updates via DOM Event Bridge)
  { id: 'example.todo.created', label: 'Todo Created', entity: 'todo', category: 'crud', clientBroadcast: true },
  { id: 'example.todo.updated', label: 'Todo Updated', entity: 'todo', category: 'crud', clientBroadcast: true },
  { id: 'example.todo.deleted', label: 'Todo Deleted', entity: 'todo', category: 'crud', clientBroadcast: true },
  /**
   * Portal Event Bridge (`portalBroadcast: true`) — the customer-facing twin of
   * `clientBroadcast`. The portal SSE endpoint
   * (`customer_accounts/api/portal/events/stream.ts`) forwards only events carrying
   * this flag, filtered by the connected customer's tenant/organization and, when the
   * payload names them, by `recipientUserId(s)`.
   *
   * Three deliberate choices, all copyable:
   *
   * 1. **Its own entity segment.** The internal writes are `example.todo.*`, and this
   *    module already runs a wildcard subscriber on that pattern. Naming this event
   *    `example.todo.announced` would have made every announcement re-enter that
   *    subscriber; `todo_announcement` keeps the customer-facing fan-out off the
   *    internal write path.
   * 2. **No staff-authored text on the wire.** The payload carries ids, scope and a
   *    boolean only. Titles and notes are written by staff for staff — a portal
   *    broadcast is the wrong place to discover that.
   * 3. **Not `clientBroadcast`.** The two flags are independent; this one is meant for
   *    the portal audience, and the backoffice already learns about the same write
   *    from `example.todo.updated`.
   */
  {
    id: 'example.todo_announcement.published',
    label: 'Todo Announcement Published',
    entity: 'todo_announcement',
    category: 'lifecycle',
    portalBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'example',
  events,
})

/** Type-safe event emitter for example module */
export const emitExampleEvent = eventsConfig.emit

/** Event IDs that can be emitted by the example module */
export type ExampleEventId = typeof events[number]['id']

export default eventsConfig
