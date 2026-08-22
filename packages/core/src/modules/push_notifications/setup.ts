import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PUSH_STUCK_RECLAIM_QUEUE } from './lib/queue'

const logger = createLogger('push_notifications')

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue' | 'command'
    targetQueue?: string
    targetPayload?: unknown
    sourceType?: 'user' | 'module'
    sourceModule?: string
    isEnabled?: boolean
    description?: string
  }) => Promise<void>
}

/**
 * How often the stuck-delivery reclaim tick fires. Default 120s — stranded rows are rare, so a slower
 * cadence than the delivery path is fine. Tunable via OM_PUSH_RECLAIM_TICK_SECONDS (min 30s).
 */
const RECLAIM_TICK_INTERVAL_SECONDS = Math.max(
  30,
  Number.parseInt(process.env.OM_PUSH_RECLAIM_TICK_SECONDS ?? '120', 10) || 120,
)

/**
 * `scheduled_jobs.id` is a uuid column, so a module-owned schedule's stable
 * registration key must be hashed into a uuid rather than used verbatim — this
 * keeps `schedulerService.register()` an idempotent upsert across re-runs of
 * seedDefaults instead of trying to insert a raw string into the uuid PK.
 * Mirrors the communication_channels poll-tick registration.
 */
function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['push_notifications.*'],
    admin: ['push_notifications.*'],
    // The delivery log is ops/admin observability; employees are not granted it by default.
  },

  async seedDefaults({ container, tenantId }) {
    /**
     * Register the stuck-delivery reclaim tick with `@open-mercato/scheduler`. Tenant-scoped (one row
     * per tenant, keyed by a deterministic uuid so re-runs upsert) — the sweep covers org-bound and
     * tenant-level delivery rows alike. Skipped silently when the scheduler module isn't enabled so
     * the delivery rails stay usable in scheduler-less harnesses (mirrors communication_channels).
     */
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      return
    }
    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
    try {
      await schedulerService.register({
        id: stableScheduleUuid(`push_notifications:reclaim-stuck:${tenantId}`),
        name: 'Push delivery stuck-row reclaim',
        description:
          `Every ${RECLAIM_TICK_INTERVAL_SECONDS}s, recover push deliveries stranded in 'sending' by a crashed worker (re-enqueue if attempts remain, else expire) and poll async provider receipts (Expo) to soft-delete unregistered devices.`,
        scopeType: 'tenant',
        tenantId,
        scheduleType: 'interval',
        scheduleValue: `${RECLAIM_TICK_INTERVAL_SECONDS}s`,
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: PUSH_STUCK_RECLAIM_QUEUE,
        targetPayload: { scope: { tenantId } },
        sourceType: 'module',
        sourceModule: 'push_notifications',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('Failed to register reclaim-stuck schedule', { error })
    }
  },
}

export default setup
