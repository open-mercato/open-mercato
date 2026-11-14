import { createHash } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customer_groups')

// Same registration shape as `warranty_claims/setup.ts`'s SLA sweep schedule.
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

function stableCreditExposureAuditScheduleId(organizationId: string): string {
  return stableScheduleUuid(`customer_groups:credit-exposure-audit:${organizationId}`)
}

function stableExpireApprovalsScheduleId(tenantId: string): string {
  return stableScheduleUuid(`customer_groups:expire-approvals:${tenantId}`)
}

/**
 * Registers the daily credit-exposure-audit and hourly expire-approvals schedules for one
 * tenant/organization. Extracted out of `setup.ts`'s `seedDefaults` (#8822) so the same
 * logic also backs the `customer_groups.register-schedules` upgrade action
 * (`configs/lib/upgrade-actions.ts`) — `seedDefaults` only runs for brand-new tenants, so an
 * existing tenant upgrading to this release never got either schedule despite the
 * `isEnabled: true` comment's assumption that it would.
 */
export async function registerCustomerGroupsSchedules(
  container: import('awilix').AwilixContainer | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!container) return
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return

  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  const { tenantId, organizationId } = scope

  try {
    await schedulerService.register({
      id: stableCreditExposureAuditScheduleId(organizationId),
      name: 'Customer credit exposure audit',
      description: 'Daily per-tenant audit comparing recomputed credit exposure against the ledger\'s recorded balance.',
      scopeType: 'organization',
      organizationId,
      tenantId,
      scheduleType: 'cron',
      scheduleValue: '0 3 * * *',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'customer_groups.credit_exposure_audit',
      targetPayload: {
        scope: { tenantId, organizationId },
      },
      sourceType: 'module',
      sourceModule: 'customer_groups',
      isEnabled: true,
    })
  } catch (error) {
    logger.warn('[customer_groups] Failed to register credit exposure audit schedule', {
      error: error instanceof Error ? error.message : error,
    })
  }

  try {
    await schedulerService.register({
      id: stableExpireApprovalsScheduleId(tenantId),
      name: 'Customer purchase approval expiry sweep',
      description: 'Hourly, per-tenant: CAS every pending purchase approval past its expires_at to expired (D-R5-27).',
      scopeType: 'tenant',
      tenantId,
      scheduleType: 'interval',
      scheduleValue: '3600s',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'customer_groups.expire_approvals',
      targetPayload: { scope: { tenantId } },
      sourceType: 'module',
      sourceModule: 'customer_groups',
      isEnabled: true,
    })
  } catch (error) {
    logger.warn('[customer_groups] Failed to register expire-approvals schedule', {
      error: error instanceof Error ? error.message : error,
    })
  }
}
