import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createQueue } from '@open-mercato/queue'
import type { CleanupExpiredJob } from './workers/create-notification.worker'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events/types'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseModuleCliOptions } from '@open-mercato/shared/lib/cli/parseModuleCliOptions'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { legacyCommandCleanupOptionsSchema } from './data/validators'
import { cleanupLegacyNotificationCommands } from './lib/legacyCommandCleanup'
import { NOTIFICATION_EVENTS } from './lib/events'

const cleanupExpiredCommand: ModuleCli = {
  command: 'cleanup-expired',
  async run() {
    const queue = createQueue('notifications', 'async')

    await queue.enqueue({
      type: 'cleanup-expired',
    } satisfies CleanupExpiredJob)

    console.log('✓ Cleanup job enqueued')
  },
}

const cleanupLegacyCommands: ModuleCli = {
  command: 'cleanup-legacy-commands',
  async run(rest) {
    const { translate } = await resolveTranslations()
    const raw = parseModuleCliOptions(rest)
    const parsed = legacyCommandCleanupOptionsSchema.safeParse({
      ...raw,
      apply: raw.apply === undefined ? false : raw.apply === true ? true : parseBooleanToken(raw.apply) ?? raw.apply,
    })
    if (!parsed.success) {
      throw new Error(translate('notifications.cli.legacyCommands.usage'))
    }
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em').fork()
    const notifications = await cleanupLegacyNotificationCommands(em.getKysely(), parsed.data)
    if (parsed.data.apply && notifications.length > 0) {
      const organizations = new Set(notifications.map((notification) => notification.organizationId))
      for (const organizationId of organizations) {
        await invalidateCrudCache(container, 'notifications.notification', {
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
      ? 'notifications.cli.legacyCommands.applied'
      : 'notifications.cli.legacyCommands.preview'
    console.log(translate(key).replace('{count}', String(notifications.length)))
  },
}

const commands = [cleanupExpiredCommand, cleanupLegacyCommands]

export default commands
