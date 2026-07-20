import { createModuleEvents } from '@open-mercato/shared/modules/events'
import { NOTIFICATION_SSE_EVENTS } from './lib/events'

/**
 * Reconcile the code-registered notification type catalogue into the
 * `notification_types` table. Emitted at tenant init; consumed by
 * `subscribers/sync-notification-types.ts`.
 */
export const TYPE_REGISTRY_SYNC_EVENT = 'notifications.type_registry.sync'

/** Lifecycle event emitted after a user's channel preferences change (workflow-trigger / subscriber surface). */
export const PREFERENCE_UPDATED_EVENT = 'notifications.preference.updated'

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
  {
    id: TYPE_REGISTRY_SYNC_EVENT,
    label: 'Notification Type Registry Sync',
    entity: 'notification_type',
    category: 'system',
    excludeFromTriggers: true,
  },
  {
    id: PREFERENCE_UPDATED_EVENT,
    label: 'Notification Preference Updated',
    entity: 'notification_preference',
    category: 'crud',
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'notifications',
  events,
})

export const emitNotificationEvent = eventsConfig.emit

export default eventsConfig
