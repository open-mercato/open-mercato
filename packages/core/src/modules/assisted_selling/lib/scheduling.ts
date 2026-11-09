import { createHash } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('assisted_selling')

// Same registration shape as `customer_groups/setup.ts`'s own scheduler registration.
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

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function stableIdleCloseScheduleId(organizationId: string): string {
  return stableScheduleUuid(`assisted_selling:idle-close:${organizationId}`)
}

function stableRetentionScheduleId(organizationId: string): string {
  return stableScheduleUuid(`assisted_selling:retention:${organizationId}`)
}

type ScheduleRegistration = Parameters<SchedulerServiceLike['register']>[0]

const SCHEDULE_REGISTER_RETRY_DELAYS_MS = [250, 1000]

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retention and idle-close are privacy controls: a silently missing schedule leaves buyer
 * text stored past its retention window. Registration is retried with backoff, every final
 * failure is logged at error level and reported to telemetry, and the failure is returned so
 * the caller can surface it (re-running is safe — it re-registers by stable id).
 */
async function registerScheduleWithRetry(
  schedulerService: SchedulerServiceLike,
  registration: ScheduleRegistration,
): Promise<Error | null> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= SCHEDULE_REGISTER_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await schedulerService.register(registration)
      return null
    } catch (error) {
      lastError = error
      const delay = SCHEDULE_REGISTER_RETRY_DELAYS_MS[attempt]
      if (delay !== undefined) await wait(delay)
    }
  }
  logger.error('[assisted_selling] Failed to register schedule after retries', {
    scheduleId: registration.id,
    error: lastError instanceof Error ? lastError.message : lastError,
  })
  getTelemetryRuntime()?.reportError(lastError, { module: 'assisted_selling', code: 'assisted_selling.schedule_registration_failed' })
  return lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * Registers the hourly idle-close and daily retention sweeps for one tenant/organization.
 * Extracted out of `setup.ts`'s `seedDefaults` (#8822) so the same logic also backs the
 * `assisted_selling.register-schedules` upgrade action (`configs/lib/upgrade-actions.ts`)
 * — `seedDefaults` only runs for brand-new tenants, so an existing tenant upgrading to
 * this release never got either sweep despite the `isEnabled: true` comment's assumption
 * that it would.
 */
export async function registerAssistedSellingSchedules(
  container: import('awilix').AwilixContainer | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const { tenantId, organizationId } = scope
  const cradle = container as { hasRegistration?: (name: string) => boolean } | undefined
  if (!container || typeof cradle?.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
    const unavailable = new Error('[assisted_selling] schedulerService is not registered; retention and idle-close sweeps are NOT scheduled')
    logger.error(unavailable.message, { tenantId, organizationId })
    getTelemetryRuntime()?.reportError(unavailable, { module: 'assisted_selling', code: 'assisted_selling.scheduler_unavailable' })
    return
  }

  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  const failures: Error[] = []

  const idleClose = await registerScheduleWithRetry(schedulerService, {
    id: stableIdleCloseScheduleId(organizationId),
    name: 'Assisted selling idle-close sweep',
    description: "Hourly, per organization: close an open thread past its store's idle_close_days with no activity.",
    scopeType: 'organization',
    organizationId,
    tenantId,
    scheduleType: 'interval',
    scheduleValue: '3600s',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: 'assisted_selling.idle_close',
    targetPayload: { scope: { tenantId, organizationId } },
    sourceType: 'module',
    sourceModule: 'assisted_selling',
    isEnabled: true,
  })
  if (idleClose) failures.push(idleClose)

  const retention = await registerScheduleWithRetry(schedulerService, {
    id: stableRetentionScheduleId(organizationId),
    name: 'Assisted selling retention sweep',
    description: "Daily, per organization: erase a closed thread past its store's conversation_retention_days.",
    scopeType: 'organization',
    organizationId,
    tenantId,
    scheduleType: 'cron',
    scheduleValue: '0 4 * * *',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: 'assisted_selling.retention',
    targetPayload: { scope: { tenantId, organizationId } },
    sourceType: 'module',
    sourceModule: 'assisted_selling',
    isEnabled: true,
  })
  if (retention) failures.push(retention)

  if (failures.length > 0) {
    throw new AggregateError(failures, `[assisted_selling] ${failures.length} schedule registration(s) failed; re-run to reconcile`)
  }
}
