import type { EntityExtension } from '@open-mercato/shared/modules/entities'

/**
 * Cross-module entity links declared by the push_notifications module.
 *
 * Per root AGENTS.md, modules do NOT form direct ORM relationships across
 * boundaries. `PushNotificationDelivery` carries plain UUID columns that
 * reference rows owned by other modules; the links are declared here so the
 * data engine + UI tooling can traverse them.
 */
const entityExtensions: EntityExtension[] = [
  {
    base: 'push_notifications:push_notification_delivery',
    extension: 'devices:user_device',
    join: { baseKey: 'user_device_id', extensionKey: 'id' },
    cardinality: 'many-to-one',
    description: 'Links a push delivery row to the target user device it was sent to',
  },
  {
    base: 'push_notifications:push_notification_delivery',
    extension: 'notifications:notification',
    join: { baseKey: 'notification_id', extensionKey: 'id' },
    cardinality: 'many-to-one',
    description: 'Links a push delivery row to the in-app notification that triggered it',
  },
]

export const extensions = entityExtensions
export default entityExtensions
