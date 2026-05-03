import type { EntityManager } from '@mikro-orm/postgresql'
import { MaterialPrice } from '../data/entities'

/**
 * Material price expiration worker (Phase 1 Step 11).
 *
 * Idempotent daily job:
 *  1. Find live MaterialPrice rows where validTo is set and < now() and is_active = true.
 *  2. Set is_active = false (the marker that lets the next run skip these rows).
 *  3. Emit `materials.price.expired` per row with the spec payload shape.
 *
 * Idempotency: a second run finds nothing because the first marked them inactive. No flag
 * column needed — `is_active` doubles as the "expiry handled" marker for prices.
 *
 * Scheduling: the spec asks for "daily" cadence; actual scheduling lives in the platform
 * scheduler module (or external cron) and wires `materials.price-expiry` queue jobs.
 */

export const MATERIAL_PRICE_EXPIRY_QUEUE = 'materials.price-expiry'

export const metadata = {
  queue: MATERIAL_PRICE_EXPIRY_QUEUE,
  id: 'materials:expire-prices',
  concurrency: 1,
}

type Job = { payload?: unknown }

type EventBus = {
  emitEvent: (event: string, payload: unknown, options?: { persistent?: boolean }) => Promise<void>
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

const DEBUG = process.env.MATERIALS_EXPIRY_DEBUG === 'true'

function debug(...args: unknown[]): void {
  if (DEBUG) console.log('[materials.price.expiry]', ...args)
}

export default async function handle(_job: Job, ctx: HandlerContext): Promise<{ expired: number }> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const now = new Date()

  // Single query gets all org/tenant rows; tenant scoping lives implicitly in the job's
  // worker config (each tenant has its own queue tail in async strategies). For local
  // strategy this is one global pass; the data layer doesn't span tenants.
  const expired = await em.find(MaterialPrice, {
    isActive: true,
    deletedAt: null,
    validTo: { $ne: null, $lt: now },
  } as any)
  if (expired.length === 0) {
    debug('no prices to expire')
    return { expired: 0 }
  }

  for (const price of expired) {
    price.isActive = false
  }
  await em.flush()

  const eventBus = ctx.resolve('eventBus') as EventBus | undefined
  if (eventBus) {
    for (const price of expired) {
      await eventBus
        .emitEvent(
          'materials.price.expired',
          {
            id: price.id,
            materialSupplierLinkId: price.materialSupplierLinkId,
            validTo: price.validTo,
            organizationId: price.organizationId,
            tenantId: price.tenantId,
          },
          { persistent: true },
        )
        .catch((err) => debug('emitEvent failed', price.id, err))
    }
  }

  debug(`expired ${expired.length} prices`)
  return { expired: expired.length }
}
