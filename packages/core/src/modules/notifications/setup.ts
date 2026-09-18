import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { TYPE_REGISTRY_SYNC_EVENT } from './events'

const logger = createLogger('notifications')

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['notifications.*'],
    admin: ['notifications.*'],
    employee: ['notifications.view', 'notifications.manage_preferences'],
  },

  async seedDefaults({ container, tenantId, organizationId }) {
    // Best-effort: nudge the type catalogue into the DB at init time. The
    // `GET /api/notifications/types` lazy reconcile is the reliable fallback, so
    // a failure here must never break tenant initialization.
    try {
      const eventBus = container.resolve('eventBus') as {
        emit: (event: string, payload: unknown, options?: unknown) => Promise<void>
      }
      await eventBus.emit(
        TYPE_REGISTRY_SYNC_EVENT,
        { tenantId, organizationId },
        { tenantId, organizationId, persistent: true },
      )
    } catch (err) {
      logger.warn('type_registry.sync emit skipped during seedDefaults', { err })
    }
  },
}

export default setup
