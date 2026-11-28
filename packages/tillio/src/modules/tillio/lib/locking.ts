import type { EntityManager } from '@mikro-orm/postgresql'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'

export type TillioLockRunner = <T>(run: () => Promise<T>) => Promise<T>

type LockSlots = {
  limit: number
  active: number
  waiters: Array<() => void>
}

const tillioPoolSlotsKey = Symbol.for('@open-mercato/tillio/lockPoolSlots')
const tillioGlobals = globalThis as typeof globalThis & { [tillioPoolSlotsKey]?: WeakMap<object, LockSlots> }
const lockSlotsByConnection = tillioGlobals[tillioPoolSlotsKey] ??= new WeakMap<object, LockSlots>()

function getLockSlots(em: EntityManager): LockSlots {
  const connection = em.getConnection()
  const existing = lockSlotsByConnection.get(connection)
  if (existing) return existing
  const poolMax = em.config.get('pool')?.max || 2
  const slots: LockSlots = { limit: Math.max(1, Math.floor(poolMax / 2)), active: 0, waiters: [] }
  lockSlotsByConnection.set(connection, slots)
  return slots
}

/**
 * Share capacity across operator and pull locks. Leave one connection per admitted lock for
 * service work that uses the pool independently. With a one-connection pool, the normal
 * request EntityManager joins the lock transaction through MikroORM's transaction context.
 * The transaction and hashtext key also serialize against Tillio on older replicas.
 */
export function createTillioLock(em: EntityManager, key: string): TillioLockRunner {
  return async <T>(run: () => Promise<T>): Promise<T> => {
    const slots = getLockSlots(em)
    if (slots.active >= slots.limit) {
      await new Promise<void>((resume) => slots.waiters.push(resume))
    } else {
      slots.active += 1
    }

    try {
      return await em.transactional(async (tx) => {
        await tx.execute('select pg_advisory_xact_lock(hashtext(?::text))', [key])
        return run()
      })
    } finally {
      const next = slots.waiters.shift()
      if (next) next()
      else slots.active -= 1
    }
  }
}

export function tillioOperatorLockKey(scope: IntegrationScope): string {
  return `tillio:operators:${scope.tenantId}:${scope.organizationId}`
}

export function tillioPullLockKey(scope: IntegrationScope): string {
  return `tillio:pull:${scope.tenantId}:${scope.organizationId}`
}
