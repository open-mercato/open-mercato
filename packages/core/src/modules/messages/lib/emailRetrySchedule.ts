import { createHash } from 'node:crypto'

export const MESSAGES_EMAIL_RETRY_QUEUE_NAME = 'messages-email-retry'

const EMAIL_RETRY_TICK_SCHEDULE_VALUE = '60s'

type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
}

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Registers the per-organization email retry tick (safety net for delivery jobs
 * lost after a restart). Called from `setup.ts` for new tenants/organizations and
 * from the `messages.register-email-retry-schedule` upgrade action for existing
 * ones; an idempotent upsert keyed by a stable uuid. No-op without the scheduler.
 */
export async function registerMessagesEmailRetrySchedule(
  container: import('awilix').AwilixContainer | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!container) return
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return

  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  await schedulerService.register({
    id: stableScheduleUuid(`messages:email-retry-tick:${scope.organizationId}`),
    name: 'Messages email retry tick',
    description: 'Every 60s, re-enqueues external email deliveries whose retry is due and expires those past the delivery window.',
    scopeType: 'organization',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    scheduleType: 'interval',
    scheduleValue: EMAIL_RETRY_TICK_SCHEDULE_VALUE,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: MESSAGES_EMAIL_RETRY_QUEUE_NAME,
    targetPayload: { scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } },
    sourceType: 'module',
    sourceModule: 'messages',
    isEnabled: true,
  })
}
