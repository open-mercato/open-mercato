import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'notifications.created',
    label: 'Notification Created',
    entity: 'notification',
    category: 'system',
  },
  {
    id: 'notifications.notification.created',
    label: 'Notification Created (SSE)',
    entity: 'notification',
    category: 'system',
    clientBroadcast: true,
  },
  {
    id: 'notifications.notification.batch_created',
    label: 'Notifications Batch Created (SSE)',
    entity: 'notification',
    category: 'system',
    clientBroadcast: true,
  },
  {
    id: 'notifications.read',
    label: 'Notification Read',
    entity: 'notification',
    category: 'system',
  },
  {
    id: 'notifications.actioned',
    label: 'Notification Actioned',
    entity: 'notification',
    category: 'system',
  },
  {
    id: 'notifications.dismissed',
    label: 'Notification Dismissed',
    entity: 'notification',
    category: 'system',
  },
  {
    id: 'notifications.restored',
    label: 'Notification Restored',
    entity: 'notification',
    category: 'system',
  },
  {
    id: 'notifications.expired',
    label: 'Notification Expired',
    entity: 'notification',
    category: 'system',
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'notifications',
  events,
})

export default eventsConfig
