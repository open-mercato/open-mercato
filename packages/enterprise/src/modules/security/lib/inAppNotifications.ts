import type { EntityManager } from '@mikro-orm/postgresql'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('security').child({ component: 'in-app-notifications' })

export function inAppNotificationsAvailable(ctx: { resolve: <T = unknown>(name: string) => T }): boolean {
  if (ctx.resolve<EntityManager>('em').getMetadata().find(Notification)) return true

  logger.warn('Skipping in-app security notification because notifications metadata is unavailable')
  return false
}
