import { createHash } from 'node:crypto'
import { PROMOTIONS_CODE_RESERVATION_SWEEP_QUEUE } from './queues'

// Step 6.5 — the reservation sweep's schedule, registered with `@open-mercato/scheduler`.
// Shape copied from `cart/lib/scheduling.ts`'s `registerCartSweeperSchedules` (itself copied
// from `push_notifications/setup.ts`'s inline reclaim-stuck registration): `SchedulerServiceLike`,
// `stableScheduleUuid`, `scopeType: 'tenant'`. Tenant-scoped, not per-organization — the sweep
// in `services/code-reservation-sweeper.ts` filters every `CodeReservation` row by its own
// `tenantId`, so one schedule per tenant already covers every organization under it.
//
// Cadence choice (the spec names none for this sweeper, unlike `cart`'s own §12 table):
// every 30 minutes. `CodeReservation.expiresAt` is `created_at + 24h` (§Data Models rev
// C7/D-R4-8) — a much longer TTL than any of `cart`'s own sweep windows (15 min / hourly /
// 5 min / daily). This sweeper is a safety net, not the primary release path: `cart`'s own
// expiry/abandonment sweeps already call `codes/release` far sooner, within minutes of a cart
// actually lapsing. 30 minutes bounds how long a lapsed reservation's capacity can stay falsely
// held hostage if that primary path fails for some reason, while keeping the tick far enough
// below the 24h TTL that it never meaningfully competes with `cart`'s own, faster-reacting
// release triggers for the same row — closer to 15 min would just add load with no real benefit
// at this TTL scale.
type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
}

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const CODE_RESERVATION_SWEEP_SCHEDULE_VALUE = '1800s'

/**
 * Registers the code-reservation sweep schedule for one tenant. Called from both `setup.ts`'s
 * `seedDefaults` (new tenants) and the `promotions.register-code-reservation-sweep-schedule`
 * upgrade action (`configs/lib/upgrade-actions.ts`, existing tenants) — kept here, not inline
 * in either caller, so it is one function both can reach. `organizationId` is accepted (the
 * upgrade action's `UpgradeActionContext` always carries one) but unused: this schedule is
 * tenant-scoped, see the module comment above.
 *
 * Silently no-ops when the scheduler module isn't enabled, so the sweep stays optional in a
 * scheduler-less harness (mirrors `cart`/`push_notifications`/`communication_channels`).
 */
export async function registerCodeReservationSweepSchedule(
  container: import('awilix').AwilixContainer | undefined,
  scope: { tenantId: string; organizationId?: string },
): Promise<void> {
  if (!container) return
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return

  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  const { tenantId } = scope

  await schedulerService.register({
    id: stableScheduleUuid(`promotions:code-reservation-sweep:${tenantId}`),
    name: 'Promotions code-reservation sweep',
    description: 'Every 30 minutes, release CodeReservation rows past their 24h TTL, independently of cart.',
    scopeType: 'tenant',
    tenantId,
    scheduleType: 'interval',
    scheduleValue: CODE_RESERVATION_SWEEP_SCHEDULE_VALUE,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: PROMOTIONS_CODE_RESERVATION_SWEEP_QUEUE,
    targetPayload: { scope: { tenantId } },
    sourceType: 'module',
    sourceModule: 'promotions',
    isEnabled: true,
  })
}
