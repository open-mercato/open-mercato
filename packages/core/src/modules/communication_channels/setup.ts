import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { COMMUNICATION_CHANNELS_QUEUES } from './lib/queue'

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
 * Tick interval in seconds. Default 60s per email integration spec
 * § Hub Deltas → Delta 6 (scheduler mechanism).
 */
const POLL_TICK_INTERVAL_SECONDS = Math.max(
  10,
  Number.parseInt(process.env.OM_HUB_POLL_SCHEDULER_TICK_SECONDS ?? '60', 10) || 60,
)

/**
 * `scheduled_jobs.id` is a uuid column, so a module-owned schedule's stable
 * registration key must be hashed into a uuid rather than used verbatim — this
 * keeps `schedulerService.register()` an idempotent upsert across re-runs of
 * seedDefaults instead of trying to insert a raw string into the uuid PK.
 */
function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function stablePollTickScheduleId(organizationId: string): string {
  return stableScheduleUuid(`communication_channels:poll-tick:${organizationId}`)
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: [
      'communication_channels.view',
      'communication_channels.manage',
      'communication_channels.react',
      'communication_channels.assign',
      'communication_channels.connect_user_channel',
      'communication_channels.admin',
      'communication_channels.channel.import_history',
      'communication_channels.channel.push.manage',
    ],
    admin: [
      'communication_channels.view',
      'communication_channels.manage',
      'communication_channels.react',
      'communication_channels.assign',
      'communication_channels.connect_user_channel',
      'communication_channels.admin',
      'communication_channels.channel.import_history',
      'communication_channels.channel.push.manage',
    ],
    manager: [
      'communication_channels.view',
      'communication_channels.manage',
      'communication_channels.react',
      'communication_channels.assign',
      'communication_channels.connect_user_channel',
    ],
    employee: [
      'communication_channels.view',
      'communication_channels.react',
      'communication_channels.connect_user_channel',
    ],
  },

  async seedDefaults({ container, organizationId, tenantId }) {
    /**
     * Register the per-channel polling tick with `@open-mercato/scheduler`.
     *
     * Per email integration spec § Hub Deltas → Delta 6: every
     * `POLL_TICK_INTERVAL_SECONDS` (default 60s), enqueue a single
     * `communication-channels-poll-tick` job that enumerates due channels and
     * fans out to the `communication-channels-poll` queue.
     *
     * The registration is per-organization (one tick row per org/tenant pair)
     * so multi-tenant deploys schedule independently. Skipped silently when the
     * scheduler module isn't enabled — keeps the hub usable in scheduler-less
     * test harnesses.
     */
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      return
    }
    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
    // Best-effort: a scheduler failure must not abort tenant initialization for
    // every other module (mirrors the ai_assistant setup pattern). The schedule
    // ids are deterministic uuids so re-runs upsert idempotently.
    try {
      await schedulerService.register({
        id: stablePollTickScheduleId(organizationId),
        name: 'Communication channels poll tick',
        description:
          `Enumerates active polling channels every ${POLL_TICK_INTERVAL_SECONDS}s and enqueues per-channel poll jobs.`,
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'interval',
        scheduleValue: `${POLL_TICK_INTERVAL_SECONDS}s`,
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: COMMUNICATION_CHANNELS_QUEUES.pollTick,
        targetPayload: {
          scope: { tenantId, organizationId },
        },
        sourceType: 'module',
        sourceModule: 'communication_channels',
        isEnabled: true,
      })

      // Spec C § Phase C4 — Gmail watch renewal cron, per-org so multi-tenant
      // deploys schedule independently.
      await schedulerService.register({
        id: stableScheduleUuid(`communication_channels:gmail-renew-watch:${organizationId}`),
        name: 'Gmail watch renewal',
        description:
          'Daily 04:00 UTC. Re-issues gmail.users.watch for channels within OM_PUSH_RENEWAL_GMAIL_LEAD_HOURS of expiry.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'cron',
        scheduleValue: '0 4 * * *',
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: COMMUNICATION_CHANNELS_QUEUES.gmailRenewWatch,
        targetPayload: { scope: { tenantId, organizationId } },
        sourceType: 'module',
        sourceModule: 'communication_channels',
        isEnabled: true,
      })
    } catch (error) {
      console.warn(
        '[communication_channels] Failed to register module schedules:',
        error instanceof Error ? error.message : error,
      )
    }
  },
}

export default setup
