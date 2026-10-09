import { createHash } from 'node:crypto'

export const TPAY_RECONCILIATION_QUEUE = 'gateway-tpay-status-poller'
export const TPAY_RECONCILIATION_INTERVAL = '5m'
export const TPAY_RECONCILIATION_LIMIT = 100
export const TPAY_SCHEDULE_SOURCE_MODULE = 'gateway_tpay'

export type TpayScheduleScope = {
  tenantId: string
  organizationId: string
}

export type TpayReconciliationScheduleRegistration = {
  id: string
  name: string
  description: string
  scopeType: 'organization'
  tenantId: string
  organizationId: string
  scheduleType: 'interval'
  scheduleValue: string
  timezone: string
  targetType: 'queue'
  targetQueue: string
  targetPayload: { limit: number }
  sourceType: 'module'
  sourceModule: string
  isEnabled: boolean
}

type SchedulerServiceLike = {
  register: (registration: TpayReconciliationScheduleRegistration) => Promise<void>
}

export type ScheduleContainer = {
  hasRegistration?: (name: string) => boolean
  resolve: <T = unknown>(name: string) => T
}

export function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function tpayReconciliationScheduleId(scope: TpayScheduleScope): string {
  return stableScheduleUuid(`gateway_tpay:status-poller:${scope.tenantId}:${scope.organizationId}`)
}

export function buildTpayReconciliationSchedule(
  scope: TpayScheduleScope,
  enabled: boolean,
): TpayReconciliationScheduleRegistration {
  return {
    id: tpayReconciliationScheduleId(scope),
    name: 'Tpay payment status reconciliation',
    description: 'Poll Tpay for the status of pending payments that did not receive a notification.',
    scopeType: 'organization',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scheduleType: 'interval',
    scheduleValue: TPAY_RECONCILIATION_INTERVAL,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: TPAY_RECONCILIATION_QUEUE,
    targetPayload: { limit: TPAY_RECONCILIATION_LIMIT },
    sourceType: 'module',
    sourceModule: TPAY_SCHEDULE_SOURCE_MODULE,
    isEnabled: enabled,
  }
}

function resolveSchedulerService(container: ScheduleContainer | undefined): SchedulerServiceLike | null {
  if (!container) return null
  if (typeof container.hasRegistration === 'function') {
    return container.hasRegistration('schedulerService')
      ? container.resolve<SchedulerServiceLike>('schedulerService')
      : null
  }
  try {
    return container.resolve<SchedulerServiceLike>('schedulerService') ?? null
  } catch {
    return null
  }
}

export async function syncTpayReconciliationSchedule(params: {
  container: ScheduleContainer | undefined
  scope: TpayScheduleScope
  enabled: boolean
}): Promise<boolean> {
  const { container, scope, enabled } = params
  const schedulerService = resolveSchedulerService(container)
  if (!schedulerService) return false
  await schedulerService.register(buildTpayReconciliationSchedule(scope, enabled))
  return true
}
