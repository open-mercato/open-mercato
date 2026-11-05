import { createHash } from 'node:crypto'
import {
  CART_EXPIRE_QUEUE,
  CART_MARK_ABANDONED_QUEUE,
  CART_PURGE_EXPIRED_QUEUE,
  CART_RELEASE_STALE_LOCKS_QUEUE,
} from './queues'

// Step 4.8 — §12's four sweeper cadences, registered with `@open-mercato/scheduler`. Shape
// copied from `push_notifications/setup.ts`'s inline reclaim-stuck registration
// (`packages/core/src/modules/push_notifications/setup.ts`, the `seedDefaults` body:
// `SchedulerServiceLike`, `stableScheduleUuid`, `scopeType: 'tenant'`, a tenantId-only
// `targetPayload`) rather than `payment_gateways`/`communication_channels`'s
// `scopeType: 'organization'` variant — these
// sweeps are tenant-scoped, not per-organization. The bulk transitions in `./sweepers.ts`
// filter every Cart row by its own `tenantId`/`organizationId`, so one schedule per tenant
// already covers every organization under it, same as push_notifications' own reclaim tick
// ("covers org-bound and tenant-level rows alike").
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
    key: 'mark-abandoned',
    name: 'Cart mark-abandoned sweep',
    description: "Every 15 minutes, transition active baskets past the inactivity window to 'abandoned'.",
    scheduleValue: '900s',
    queue: CART_MARK_ABANDONED_QUEUE,
  },
  {
    key: 'expire',
    name: 'Cart expire sweep',
    description: "Hourly, transition baskets past their TTL (active/abandoned/locked) to 'expired'.",
    scheduleValue: '3600s',
    queue: CART_EXPIRE_QUEUE,
  },
  {
    key: 'release-stale-locks',
    name: 'Cart release-stale-locks sweep',
    description: "Every 5 minutes, return carts whose checkout lock timed out to 'active'.",
    scheduleValue: '300s',
    queue: CART_RELEASE_STALE_LOCKS_QUEUE,
  },
  {
    key: 'purge-expired',
    name: 'Cart purge-expired sweep',
    description:
      'Daily, hard-delete baskets resolved more than 90 days ago, excluding any cart a merge log still references.',
    scheduleValue: '86400s',
    queue: CART_PURGE_EXPIRED_QUEUE,
  },
]

/**
 * Registers all four §12 sweeper schedules for one tenant. Called from both `setup.ts`'s
 * `seedDefaults` (new tenants) and the `cart.register-sweeper-schedules` upgrade action
 * (`configs/lib/upgrade-actions.ts`, existing tenants) — kept here, not inline in either
 * caller, so it is one function both can reach. `organizationId` is accepted (the upgrade
 * action's `UpgradeActionContext` always carries one) but unused: these schedules are
 * tenant-scoped, see the module comment above.
 *
 * Silently no-ops when the scheduler module isn't enabled, so the sweeps stay optional in a
 * scheduler-less harness (mirrors push_notifications/communication_channels/payment_gateways).
 */
export async function registerCartSweeperSchedules(
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
      id: stableScheduleUuid(`cart:${registration.key}:${tenantId}`),
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
      sourceModule: 'cart',
      isEnabled: true,
    })
  }
}
