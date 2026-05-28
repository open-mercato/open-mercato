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

function stablePollTickScheduleId(organizationId: string): string {
  return `communication_channels:poll-tick:${organizationId}`
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

    // Spec C § Phase C4 — renewal crons. One per provider; both per-org so
    // multi-tenant deploys schedule independently.
    await schedulerService.register({
      id: `communication_channels:gmail-renew-watch:${organizationId}`,
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
    await schedulerService.register({
      id: `communication_channels:microsoft-renew-subscriptions:${organizationId}`,
      name: 'Microsoft Graph subscription renewal',
      description:
        'Every 2 hours. PATCH-renews Microsoft Graph subscriptions within OM_PUSH_RENEWAL_MICROSOFT_LEAD_HOURS of expiry.',
      scopeType: 'organization',
      organizationId,
      tenantId,
      scheduleType: 'cron',
      scheduleValue: '0 */2 * * *',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: COMMUNICATION_CHANNELS_QUEUES.microsoftRenewSubscriptions,
      targetPayload: { scope: { tenantId, organizationId } },
      sourceType: 'module',
      sourceModule: 'communication_channels',
      isEnabled: true,
    })
  },
}

export default setup
