import { setTimeout as delay } from 'node:timers/promises'
import type { EntityManager } from '@mikro-orm/postgresql'
import { calculateBackoffDelayMs } from '@open-mercato/shared/lib/delivery/retry'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'

export type TillioLockRunner = <T>(run: () => Promise<T>) => Promise<T>

type LockSlots = {
  limit: number
  active: number
  waiters: Set<() => void>
}

const LOCK_BACKOFF = { baseDelayMs: 50, maxJitterMs: 25 }
const lockBusy = { acquired: false } as const
const tillioPoolSlotsKey = Symbol.for('@open-mercato/tillio/lockPoolSlots')
const tillioGlobals = globalThis as typeof globalThis & { [tillioPoolSlotsKey]?: WeakMap<object, LockSlots> }
const lockSlotsByConnection = tillioGlobals[tillioPoolSlotsKey] ??= new WeakMap<object, LockSlots>()

function getLockSlots(em: EntityManager): LockSlots {
  const connection = em.getConnection()
  const existing = lockSlotsByConnection.get(connection)
  if (existing) return existing
  const poolMax = em.config.get('pool')?.max || 2
  const slots: LockSlots = { limit: Math.max(1, Math.floor(poolMax / 2)), active: 0, waiters: new Set() }
  lockSlotsByConnection.set(connection, slots)
  return slots
}

function getLockWaitMs(em: EntityManager): number {
  const options = em.config.get('driverOptions')
  const timeouts = [options?.lock_timeout, options?.statement_timeout]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  return timeouts.length > 0 ? Math.min(...timeouts) : Number.POSITIVE_INFINITY
}

function unavailable(): Error {
  return new Error('[internal] Tillio scope lock was not acquired before the wait deadline')
}

function remainingTime(deadline: number): number {
  const remaining = deadline - performance.now()
  if (remaining <= 0) throw unavailable()
  return remaining
}

async function acquireSlot(slots: LockSlots, deadline: number): Promise<void> {
  const remaining = remainingTime(deadline)
  if (slots.active < slots.limit) {
    slots.active += 1
    return
  }

  await new Promise<void>((resolve, reject) => {
    const resume = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = Number.isFinite(remaining)
      ? setTimeout(() => {
        slots.waiters.delete(resume)
        reject(unavailable())
      }, remaining)
      : undefined
    slots.waiters.add(resume)
  })
}

function releaseSlot(slots: LockSlots): void {
  const next = slots.waiters.values().next().value
  if (next) {
    slots.waiters.delete(next)
    next()
  } else {
    slots.active -= 1
  }
}

/**
 * Share capacity across operator and pull locks. Leave one connection per admitted lock for
 * service work that uses the pool independently. With a one-connection pool, the normal
 * request EntityManager joins the lock transaction through MikroORM's transaction context.
 * The hashtext key also serializes against Tillio on older replicas. A contended key
 * releases its transaction and slot before retrying so it cannot block unrelated scopes.
 * A configured database lock or statement timeout bounds retries after the first busy response.
 */
export function createTillioLock(em: EntityManager, key: string): TillioLockRunner {
  return async <T>(run: () => Promise<T>): Promise<T> => {
    const slots = getLockSlots(em)
    const lockWaitMs = getLockWaitMs(em)
    let deadline = Number.POSITIVE_INFINITY
    for (let attempt = 1; ; attempt += 1) {
      await acquireSlot(slots, deadline)
      try {
        remainingTime(deadline)
        const outcome = await em.transactional(async (tx) => {
          const [row] = await tx.execute<Array<{ locked: boolean }>>(
            'select pg_try_advisory_xact_lock(hashtext(?::text)) as locked',
            [key],
          )
          if (!row?.locked) return lockBusy
          remainingTime(deadline)
          return { acquired: true as const, value: await run() }
        }, { clear: true })
        if (outcome.acquired) return outcome.value
      } finally {
        releaseSlot(slots)
      }
      if (attempt === 1) deadline = performance.now() + lockWaitMs
      const backoff = calculateBackoffDelayMs(Math.min(attempt, 5), LOCK_BACKOFF)
      await delay(Math.min(backoff, remainingTime(deadline)))
    }
  }
}

export function tillioOperatorLockKey(scope: IntegrationScope): string {
  return `tillio:operators:${scope.tenantId}:${scope.organizationId}`
}

export function tillioPullLockKey(scope: IntegrationScope): string {
  return `tillio:pull:${scope.tenantId}:${scope.organizationId}`
}
