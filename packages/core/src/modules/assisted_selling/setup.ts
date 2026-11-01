import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('assisted_selling')

// Step 4.3's `admin: ['assisted_selling.*']` already covers every feature later Steps add via
// the wildcard. Step 5.3 (§6.9, D-R5-7/D-R5-34): "`employee` gets `assisted_selling.threads.
// view`, `.threads.participate` and `.messages.post`; `assisted_selling.proposals.author`...
// stay with `admin` or [are] granted by hand to the reps who sell — the least-privilege line."
// `messages.post` now exists (`acl.ts`, this Step's own `POST /threads/:id/messages`), so the
// employee grant gains it: a staff member can see, open and converse in threads, but
// authoring a priced proposal stays an admin-or-hand-granted capability. Existing tenants need
// `yarn mercato auth sync-role-acls` (S20) to pick up this additive grant.

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

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['assisted_selling.*'],
    employee: ['assisted_selling.threads.view', 'assisted_selling.threads.participate', 'assisted_selling.messages.post'],
  },

  // Step 6.1 (§5.10, S7 gap-fill). "Release 5 ships all of §5.10 together with the first
  // route that stores text about a buyer... the staff message route of Phase 1 and the
  // buyer routes of Phase 2 item 1 do not ship without the two sweepers." Both routes
  // already shipped (Steps 4.1/4.5) without them — this closes that gap. Organization-scoped
  // (both `AssistedSellingThread` and the `AssistedSellingStoreSettings` row each sweep joins
  // against are organization-scoped), same granularity `customer_groups`'s sibling
  // `credit-exposure-audit` schedule already uses. `isEnabled` stays true so existing
  // tenants pick up both schedules from the next `seedDefaults` pass with no extra CLI step.
  async seedDefaults({ tenantId, organizationId, container }) {
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      return
    }

    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
    try {
      await schedulerService.register({
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
    } catch (error) {
      logger.warn('[assisted_selling] Failed to register idle-close schedule', {
        error: error instanceof Error ? error.message : error,
      })
    }

    try {
      await schedulerService.register({
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
    } catch (error) {
      logger.warn('[assisted_selling] Failed to register retention schedule', {
        error: error instanceof Error ? error.message : error,
      })
    }
  },
}

export default setup
