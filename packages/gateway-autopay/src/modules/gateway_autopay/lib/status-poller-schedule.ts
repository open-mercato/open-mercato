import { createHash } from 'node:crypto'
import type { AwilixContainer } from 'awilix'

export const AUTOPAY_STATUS_POLLER_QUEUE = 'gateway-autopay-status-poller'
export const AUTOPAY_STATUS_POLLER_INTERVAL = '5m'
export const AUTOPAY_STATUS_POLLER_BATCH_LIMIT = 100

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    description?: string
    scopeType: 'organization'
    organizationId: string
    tenantId: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload?: Record<string, unknown>
    sourceType: 'module'
    sourceModule: string
    isEnabled?: boolean
  }) => Promise<void>
}

export type StatusPollerScheduleScope = {
  tenantId: string
  organizationId: string
}

/**
 * Deterministic UUID for one tenant/organization scope, so repeated setup
 * runs update the same schedule row instead of registering a duplicate.
 */
export function buildStatusPollerScheduleId(scope: StatusPollerScheduleScope): string {
  const bytes = createHash('sha256')
    .update(`gateway_autopay:status-poller:${scope.tenantId}:${scope.organizationId}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Registers the organization-scoped reconciliation schedule with the optional
 * scheduler module. Returns false when no scheduler service is available, so
 * callers can log that reconciliation is off without failing tenant setup.
 *
 * The schedule targets this module's own queue rather than the core
 * `payment-gateways-status-poller` queue on purpose: the scheduler only
 * dispatches a module-authored schedule onto a queue the same module owns,
 * and it strips any `scope` from the stored payload, so the provider filter
 * has to live in this module's worker, not in the payload.
 */
export async function registerAutopayStatusPollerSchedule(
  container: AwilixContainer | undefined,
  scope: StatusPollerScheduleScope,
): Promise<boolean> {
  if (!container) return false
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
    return false
  }

  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  await schedulerService.register({
    id: buildStatusPollerScheduleId(scope),
    name: 'Autopay payment status reconciliation',
    description: 'Reads the current status of pending Autopay payments from Autopay so payments settled after the payer left the return page are not stuck as pending.',
    scopeType: 'organization',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    scheduleType: 'interval',
    scheduleValue: AUTOPAY_STATUS_POLLER_INTERVAL,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: AUTOPAY_STATUS_POLLER_QUEUE,
    targetPayload: { limit: AUTOPAY_STATUS_POLLER_BATCH_LIMIT },
    sourceType: 'module',
    sourceModule: 'gateway_autopay',
    isEnabled: true,
  })
  return true
}
