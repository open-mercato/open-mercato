import type { EntityManager } from '@mikro-orm/core'

/**
 * PostgreSQL advisory lock strategy for single-instance or local development
 */
export class LocalLockStrategy {
  constructor(private em: () => EntityManager) {}

  /**
   * Try to acquire a lock using PostgreSQL advisory locks
   */
  async tryLock(key: string): Promise<boolean> {
    const em = this.em()
    const hash = this.hashString(key)
    
    try {
      const result = await em.getConnection().execute(
        'SELECT pg_try_advisory_lock($1) as acquired',
        [hash]
      )
      return result[0]?.acquired === true
    } catch (error) {
      console.error('[scheduler:local] Failed to acquire lock:', error)
      return false
    }
  }

  /**
   * Release a lock
   */
  async unlock(key: string): Promise<void> {
    const em = this.em()
    const hash = this.hashString(key)
    
    try {
      await em.getConnection().execute(
        'SELECT pg_advisory_unlock($1)',
        [hash]
      )
    } catch (error) {
      console.error('[scheduler:local] Failed to release lock:', error)
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
