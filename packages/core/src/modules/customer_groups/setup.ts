import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
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

// Release 5 Phase 4 (D-R5-27, §11): "expire-approvals | hourly". Tenant-scoped like
// `availability`'s own sweeper schedules (`availability/lib/scheduling.ts`'s
// `registerAvailabilityReservationSweeperSchedules`) — the job filters every row by its
// own `tenant_id`, so one schedule per tenant covers every organization under it; the
// stable id is keyed on `tenantId`, not `organizationId`, unlike the sibling
// credit-exposure-audit schedule above.
function stableExpireApprovalsScheduleId(tenantId: string): string {
  return stableScheduleUuid(`customer_groups:expire-approvals:${tenantId}`)
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['customer_groups.*'],
    admin: ['customer_groups.*'],
    // Release 5 Phases 3-4 (D-R5-7, least privilege): `employee` gets the view-only
    // credit AND approvals features. `credit.manage`/`credit.adjust`/`approvals.decide`
    // stay with `admin` (covered by the `customer_groups.*` wildcard above) or are
    // granted by hand. Existing tenants need `yarn mercato auth sync-role-acls` (spec
    // §8.4).
    employee: [
      'customer_groups.groups.view',
      'customer_groups.memberships.view',
      'customer_groups.terms.view',
      'customer_groups.credit.view',
      'customer_groups.approvals.view',
    ],
  },

  // Release 5 Phase 4 (Step 2.6, D-R5-7/G16, spec §9.1 grant plan). Portal grants for
  // the buyer-facing approval API (G5): `portal_admin` views and decides its own
  // company's requests; `buyer` views and withdraws its own requests (the feature only
  // gates the read/withdraw surface — "own requests only" is enforced by the route's
  // company/requester scoping, not by withholding the feature, same reasoning Step
  // 2.6's task brief states explicitly); `viewer` gets nothing. Existing tenants need
  // `yarn mercato customer_accounts sync-customer-role-acls` (spec §8.4).
  defaultCustomerRoleFeatures: {
    portal_admin: ['customer_groups.portal.approvals.view', 'customer_groups.portal.approvals.decide'],
    buyer: ['customer_groups.portal.approvals.view'],
  },

  // Release 5 Phase 3 (G21, Step 1.8): schedule the daily exposure audit per tenant/
  // organization, same pattern as `warranty_claims/setup.ts`'s SLA sweep. `isEnabled`
  // stays true so existing tenants get the schedule from the next `seedDefaults` pass
  // without an extra CLI step, unlike the ACL grant sync in spec §8.4 (which needs one
  // because role grants cannot be re-applied blindly).
  async seedDefaults({ tenantId, organizationId, container }) {
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      return
    }

    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
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
  },
}

export default setup
