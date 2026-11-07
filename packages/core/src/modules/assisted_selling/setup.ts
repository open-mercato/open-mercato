import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('assisted_selling')

// Step 4.3's `admin: ['assisted_selling.*']` already covers every feature later Steps add via
// the wildcard. Step 5.3 (§6.9, D-R5-7/D-R5-34): "`employee` gets `assisted_selling.threads.
// view`, `.threads.participate` and `.messages.post`; `assisted_selling.proposals.author`...
// stay with `admin` or [are] granted by hand to the reps who sell — the least-privilege line."
// `messages.post` now exists (`acl.ts`, this Step's own `POST /threads/:id/messages`), so the
// employee grant gains it: a staff member can see, open and converse in threads, but
// authoring a priced proposal stays an admin-or-hand-granted capability. The thread-detail
// route/page additionally gates on `cart.proposals.view` (priced proposal data rendered
// alongside the thread) — the list route doesn't, so without this grant `employee` could see
// rows in the thread list but got refused opening any of them (#8405). Existing tenants need
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

type ScheduleRegistration = Parameters<SchedulerServiceLike['register']>[0]

const SCHEDULE_REGISTER_RETRY_DELAYS_MS = [250, 1000]

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retention and idle-close are privacy controls: a silently missing schedule leaves buyer
 * text stored past its retention window. Registration is retried with backoff, every final
 * failure is logged at error level and reported to telemetry, and the failure is returned so
 * `seedDefaults` can surface it (re-running `seedDefaults` re-registers by stable id).
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

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['assisted_selling.*'],
    employee: ['assisted_selling.threads.view', 'assisted_selling.threads.participate', 'assisted_selling.messages.post', 'cart.proposals.view'],
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
      throw new AggregateError(failures, `[assisted_selling] ${failures.length} schedule registration(s) failed; re-run seedDefaults to reconcile`)
    }
  },
}

export default setup
