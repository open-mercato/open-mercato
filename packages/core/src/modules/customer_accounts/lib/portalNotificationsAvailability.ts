import type { EntityManager } from '@mikro-orm/postgresql'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { isRegisteredModuleEntity } from './moduleEntityRegistration'

export function arePortalNotificationsAvailable(em: EntityManager): boolean {
  return isRegisteredModuleEntity(em, Notification, 'notifications.Notification')
}
