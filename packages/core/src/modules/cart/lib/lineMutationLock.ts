import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'
import { calculateBackoffDelayMs } from '@open-mercato/shared/lib/delivery/retry'

export async function withCartLineMutationLock(
  em: EntityManager,
  cartId: string,
  phases: Array<() => void | Promise<void>>,
  label: string,
  waitDeadlineMs = 15_000,
): Promise<void> {
  const key = `cart:lines:${cartId}`
  const deadline = Date.now() + waitDeadlineMs
  const busy = new Error('[internal] Cart line mutation lock is busy')
  const joinsTransaction = em.isInTransaction()

  for (let attempt = 1; ; attempt += 1) {
    try {
      await withAtomicFlush(em, [
        async () => {
          if (joinsTransaction) {
            await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [key])
            return
          }
          const rows = await em.execute<Array<{ locked: boolean }>>(
            'select pg_try_advisory_xact_lock(hashtextextended(?::text, 0)) as locked',
            [key],
          )
          if (!rows[0]?.locked) throw busy
        },
        ...phases,
      ], { transaction: true, label })
      return
    } catch (error) {
      if (error !== busy) throw error
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) throw new AdvisoryLockUnavailableError('deadline', key)
    const delayMs = calculateBackoffDelayMs(Math.min(attempt, 5), { baseDelayMs: 50, maxJitterMs: 25 })
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)))
    if (Date.now() >= deadline) throw new AdvisoryLockUnavailableError('deadline', key)
  }
}
