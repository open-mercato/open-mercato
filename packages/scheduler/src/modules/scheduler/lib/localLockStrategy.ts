import type { EntityManager } from '@mikro-orm/core'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('scheduler').child({ component: 'local' })

/**
 * PostgreSQL advisory lock strategy for single-instance or local development
 */
export class LocalLockStrategy {
  private heldKeys = new Set<string>()

  constructor(private em: () => EntityManager) {}

  /**
   * Execute a function under a mutual-exclusion lock.
   *
   * In-process exclusion for the whole duration of `fn` comes from `heldKeys`
   * (this strategy is single-instance by contract). The transaction-scoped
   * advisory lock (`pg_try_advisory_xact_lock`) only guards the claim itself
   * against a concurrently claiming process and is released when the short
   * claim transaction commits, BEFORE `fn` runs.
   *
   * IMPORTANT: `fn` must NOT run inside that transaction. Holding the
   * transaction open across `fn` leaves the connection idle-in-transaction
   * while `fn` awaits non-DB work; the pool's default
   * `idle_in_transaction_session_timeout` (120s) then makes Postgres kill the
   * connection (FATAL 25P03), which crashes the scheduler process.
   */
  async runWithLock<T>(key: string, fn: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
    if (this.heldKeys.has(key)) {
      return { acquired: false }
    }
    // Reserve synchronously before the async claim so a concurrent in-process
    // caller cannot slip in between our claim transaction committing (which
    // releases the advisory xact lock) and the start of `fn`.
    this.heldKeys.add(key)

    try {
      const em = this.em().fork()
      const hash = this.hashString(key)
      let claimed = false

      try {
        claimed = await em.transactional(async (txEm) => {
          const result = await txEm.getConnection().execute<{ acquired: boolean }[]>(
            `SELECT pg_try_advisory_xact_lock(?) as acquired`,
            [hash],
          )
          return result[0]?.acquired === true
        })
      } catch (error) {
        logger.error('Failed to acquire lock', { lockKey: key, err: error })
        return { acquired: false }
      }

      if (!claimed) {
        return { acquired: false }
      }

      const fnResult = await fn()
      return { acquired: true, result: fnResult }
    } finally {
      this.heldKeys.delete(key)
    }
  }

  /**
   * Convert string to integer hash for PostgreSQL advisory locks
   * PostgreSQL advisory locks use bigint, so we need to hash the string
   */
  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash)
  }
}
