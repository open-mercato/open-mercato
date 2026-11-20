import { createHash } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'

export const MESSAGES_EMAIL_RETRY_QUEUE_NAME = 'messages-email-retry'

const EMAIL_RETRY_TICK_SCHEDULE_VALUE = '60s'

type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
}

export type SchedulerSource = { resolve: (name: string) => unknown } | null | undefined

const logger = createLogger('messages').child({ component: 'module-schedules' })
const ensuredSchedules = new Set<string>()

function resolveSchedulerService(source: SchedulerSource): SchedulerServiceLike | null {
  if (!source) return null
  try {
    const service = source.resolve('schedulerService') as SchedulerServiceLike | null | undefined
    return service && typeof service.register === 'function' ? service : null
  } catch {
    return null
  }
}

/**
 * Registers a per-organization module schedule the first time this process needs it.
 * Existing tenants otherwise get it only from an upgrade action, whose banner is off
 * unless `NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED` is set. Never throws: a failed
 * registration is logged and retried on the next call.
 */
export async function ensureMessagesModuleSchedule(
  source: SchedulerSource,
  key: string,
  build: () => Record<string, unknown>,
): Promise<void> {
  if (ensuredSchedules.has(key)) return
  const schedulerService = resolveSchedulerService(source)
  if (!schedulerService) return
  try {
    await schedulerService.register(build())
    ensuredSchedules.add(key)
  } catch (error) {
    logger.warn('Could not register a messages schedule', { key, error: error instanceof Error ? error.message : String(error) })
  }
}

export function resetEnsuredMessagesSchedulesForTests(): void {
  ensuredSchedules.clear()
}

export function stableScheduleUuid(stableKey: string): string {
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
  await schedulerService.register(buildEmailRetryTickRegistration(scope))
}

/** Lazily registers the retry tick when a delivery is left pending (see `ensureMessagesModuleSchedule`). */
export async function ensureMessagesEmailRetrySchedule(
  source: SchedulerSource,
  scope: { tenantId: string; organizationId: string | null },
): Promise<void> {
  const { tenantId, organizationId } = scope
  if (!organizationId) return
  await ensureMessagesModuleSchedule(
    source,
    `email-retry-tick:${organizationId}`,
    () => buildEmailRetryTickRegistration({ tenantId, organizationId }),
  )
}

function buildEmailRetryTickRegistration(scope: { tenantId: string; organizationId: string }): Record<string, unknown> {
  return {
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
  }
}
