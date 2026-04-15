import type { EntityManager } from '@mikro-orm/core'

/**
 * PostgreSQL advisory lock strategy for single-instance or local development
 */
export class LocalLockStrategy {
  constructor(private em: () => EntityManager) {}

  /**
   * Execute a function under a PostgreSQL advisory lock.
   *
   * IMPORTANT: Uses transaction-scoped advisory locks (`pg_try_advisory_xact_lock`)
   * to avoid connection pool/session mismatch issues. The lock is automatically
   * released when the transaction ends.
   */
  async runWithLock<T>(key: string, fn: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
    const em = this.em().fork()
    const hash = this.hashString(key)
    let lockAcquired = false

    try {
      return await em.transactional(async (txEm) => {
        const result = await txEm.getConnection().execute<{ acquired: boolean }[]>(
          `SELECT pg_try_advisory_xact_lock(?) as acquired`,
          [hash],
        )

        const acquired = result[0]?.acquired === true
        if (!acquired) return { acquired: false }
        lockAcquired = true

        const fnResult = await fn()
        return { acquired: true, result: fnResult }
      })
    } catch (error) {
      if (lockAcquired) {
        throw error
      }

      console.error('[scheduler:local] Failed to acquire lock:', error)
      return { acquired: false }
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
