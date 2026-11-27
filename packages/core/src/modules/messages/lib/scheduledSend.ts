import { ensureMessagesModuleSchedule, stableScheduleUuid, type SchedulerSource } from './emailRetrySchedule'

export const MESSAGES_SCHEDULED_RELEASE_QUEUE_NAME = 'messages-scheduled-release'
export const RELEASE_SCHEDULED_COMMAND_ID = 'messages.messages.release_scheduled'
export const SCHEDULED_RELEASE_BATCH = 100
export const MAX_SCHEDULED_RELEASE_ATTEMPTS = 3
/** A `releasing` message whose worker went silent this long is claimed again. */
export const SCHEDULED_RELEASE_LEASE_MINUTES = 10

const SCHEDULED_RELEASE_SCHEDULE_VALUE = '60s'

type ContainerWithRegistration = { hasRegistration?: (name: string) => boolean }

export function isSchedulingAvailable(container: unknown): boolean {
  const cradle = container as ContainerWithRegistration | null | undefined
  return typeof cradle?.hasRegistration === 'function' && cradle.hasRegistration('schedulerService')
}

/**
 * Scheduling for a caller: needs the scheduler and an organization, because the
 * release tick runs per organization; an organization-less (tenant-wide) caller
 * would leave its messages scheduled forever.
 */
export function isSchedulingAvailableFor(container: unknown, organizationId: string | null | undefined): boolean {
  return Boolean(organizationId) && isSchedulingAvailable(container)
}

type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
}

/**
 * Registers the per-organization release tick for scheduled messages. A
 * module-owned schedule: the scheduler dispatches it because `messages` owns the
 * queue's worker, so it is not in the user-facing safe-queue allowlist. Called
 * from `setup.ts` and the `messages.register-scheduled-release` upgrade action;
 * an idempotent upsert keyed by a stable uuid. No-op without the scheduler.
 */
export async function registerMessagesScheduledReleaseSchedule(
  container: import('awilix').AwilixContainer | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!container || !isSchedulingAvailable(container)) return
  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  await schedulerService.register(buildScheduledReleaseRegistration(scope))
}

/** Lazily registers the release tick when a message is scheduled (see `ensureMessagesModuleSchedule`). */
export async function ensureMessagesScheduledReleaseSchedule(
  source: SchedulerSource,
  scope: { tenantId: string; organizationId: string | null },
): Promise<void> {
  const { tenantId, organizationId } = scope
  if (!organizationId) return
  await ensureMessagesModuleSchedule(
    source,
    `scheduled-release:${organizationId}`,
    () => buildScheduledReleaseRegistration({ tenantId, organizationId }),
  )
}

function buildScheduledReleaseRegistration(scope: { tenantId: string; organizationId: string }): Record<string, unknown> {
  return {
    id: stableScheduleUuid(`messages:scheduled-release:${scope.organizationId}`),
    name: 'Messages scheduled send release',
    description: 'Every 60s, sends the scheduled messages whose time has come.',
    scopeType: 'organization',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    scheduleType: 'interval',
    scheduleValue: SCHEDULED_RELEASE_SCHEDULE_VALUE,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: MESSAGES_SCHEDULED_RELEASE_QUEUE_NAME,
    targetPayload: { scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } },
    sourceType: 'module',
    sourceModule: 'messages',
    isEnabled: true,
  }
}
