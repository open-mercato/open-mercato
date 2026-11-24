import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events/types'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseModuleCliOptions } from '@open-mercato/shared/lib/cli/parseModuleCliOptions'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { legacyCommandCleanupOptionsSchema } from '../data/validators'
import { cleanupLegacyNotificationCommands } from './legacyCommandCleanup'
import { NOTIFICATION_EVENTS } from './events'
import { NOTIFICATION_RESOURCE_KIND } from './routeHelpers'

export async function runLegacyCommandCleanup(rest: string[]): Promise<void> {
  const raw = parseModuleCliOptions(rest)
  const parsed = legacyCommandCleanupOptionsSchema.safeParse({
    ...raw,
    apply: raw.apply === undefined ? false : raw.apply === true ? true : parseBooleanToken(raw.apply) ?? raw.apply,
  })
  const { translate } = await resolveTranslations()
  if (!parsed.success) {
    throw new Error(translate('notifications.upgrade.legacyCommands.usage'))
  }
  const container = await createRequestContainer()
  try {
    const em = container.resolve<EntityManager>('em').fork()
    const notifications = await cleanupLegacyNotificationCommands(em.getKysely(), parsed.data)
    if (parsed.data.apply && notifications.length > 0) {
      const organizations = new Set(notifications.map((notification) => notification.organizationId))
      for (const organizationId of organizations) {
        await invalidateCrudCache(container, NOTIFICATION_RESOURCE_KIND, {
          tenantId: parsed.data.tenant,
          organizationId,
        }, parsed.data.tenant, 'updated')
      }
      await container.resolve<EventBus>('eventBus').emit(NOTIFICATION_EVENTS.EXPIRED, {
        tenantId: parsed.data.tenant,
        notificationIds: notifications.map((notification) => notification.id),
      })
    }
    const key = parsed.data.apply
      ? 'notifications.upgrade.legacyCommands.applied'
      : 'notifications.upgrade.legacyCommands.preview'
    console.log(translate(key).replace('{count}', String(notifications.length)))
  } finally {
    await container.dispose()
  }
}
