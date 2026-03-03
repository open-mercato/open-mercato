import { createModuleEvents } from '@open-mercato/shared/modules/events'
import { NOTIFICATION_SSE_EVENTS } from './lib/events'

const events = [
  {
    id: NOTIFICATION_SSE_EVENTS.CREATED,
    label: 'Notification Created',
    entity: 'notification',
    category: 'system',
    clientBroadcast: true,
  },
  {
    id: NOTIFICATION_SSE_EVENTS.BATCH_CREATED,
    label: 'Notification Batch Created',
    entity: 'notification',
    category: 'system',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'notifications',
  events,
})

export const emitNotificationEvent = eventsConfig.emit

export default eventsConfig
