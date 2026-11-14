import { createHash } from 'node:crypto'
import { AVAILABILITY_EXPIRE_RESERVATIONS_QUEUE, AVAILABILITY_RECONCILE_RESERVATIONS_QUEUE } from './queues'

// Step 2.3 (A11/A12, §10). Shape copied from `cart/lib/scheduling.ts`'s own
// `registerCartSweeperSchedules` (itself copied from `push_notifications/setup.ts`'s inline
// reclaim-stuck registration): `SchedulerServiceLike`, `stableScheduleUuid`, `scopeType:
// 'tenant'`, a tenantId-only `targetPayload`. §10 states both jobs are "one scheduled tick
// per tenant whose payload carries the scope (`{ tenantId }`, D-R5-32)" — tenant-scoped, not
// per-organization, same reasoning cart's own comment gives: the jobs filter every row by its
// own `tenantId`/`organizationId`, so one schedule per tenant already covers every
// organization under it.
type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
}

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

type SweeperRegistration = {
  key: string
  name: string
  description: string
  scheduleValue: string
  queue: string
}

const SWEEPER_REGISTRATIONS: SweeperRegistration[] = [
  {
    key: 'expire-reservations',
    name: 'Availability expire-reservations sweep',
    description: "Every minute, expire 'active' checkout holds past their TTL and release the wms rows they own (A11).",
    scheduleValue: '60s',
    queue: AVAILABILITY_EXPIRE_RESERVATIONS_QUEUE,
  },
  {
    key: 'reconcile-reservations',
    name: 'Availability reconcile-reservations sweep',
    description: 'Hourly, detect and repair drift between hold rows and wms reservation rows (A12).',
    scheduleValue: '3600s',
    queue: AVAILABILITY_RECONCILE_RESERVATIONS_QUEUE,
  },
]

/**
 * Registers both §10 sweeper schedules for one tenant. Called from both `setup.ts`'s
 * `seedDefaults` (new tenants) and the `availability.register-reservation-sweep-schedules`
 * upgrade action (`configs/lib/upgrade-actions.ts`, existing tenants) — kept here, not inline
 * in either caller, so it is one function both can reach. `organizationId` is accepted (the
 * upgrade action's `UpgradeActionContext` always carries one) but unused: these schedules are
 * tenant-scoped, see the module comment above.
 *
 * Silently no-ops when the scheduler module isn't enabled, so the sweeps stay optional in a
 * scheduler-less harness (mirrors cart/promotions/push_notifications).
 */
export async function registerAvailabilityReservationSweeperSchedules(
  container: import('awilix').AwilixContainer | undefined,
  scope: { tenantId: string; organizationId?: string },
): Promise<void> {
  if (!container) return
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return

  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  const { tenantId } = scope

  for (const registration of SWEEPER_REGISTRATIONS) {
    await schedulerService.register({
      id: stableScheduleUuid(`availability:${registration.key}:${tenantId}`),
      name: registration.name,
      description: registration.description,
      scopeType: 'tenant',
      tenantId,
      scheduleType: 'interval',
      scheduleValue: registration.scheduleValue,
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: registration.queue,
      targetPayload: { scope: { tenantId } },
      sourceType: 'module',
      sourceModule: 'availability',
      isEnabled: true,
    })
  }
}
