import type { CacheStrategy, CacheGetOptions, CacheSetOptions, CacheValue } from '../types'
import fs from 'node:fs'
import path from 'node:path'
import { CacheDependencyUnavailableError } from '../errors'

type SqliteStatement<TResult = unknown> = {
  get(...args: unknown[]): TResult | undefined
  all(...args: unknown[]): TResult[]
  run(...args: unknown[]): { changes: number }
}

type SqliteTransaction<TResult = unknown> = () => TResult

type SqliteDatabase = {
  prepare<TResult = unknown>(sql: string): SqliteStatement<TResult>
  exec(sql: string): unknown
  transaction<TResult>(fn: () => TResult): SqliteTransaction<TResult>
  close(): void
}

type SqliteConstructor = new (file: string) => SqliteDatabase
type SqliteModule = SqliteConstructor | { default: SqliteConstructor }

/**
 * SQLite cache strategy with tag support
 * Persistent across process restarts, stored in a SQLite database file
 * 
 * Uses two tables:
 * - cache_entries: stores cache data
 * - cache_tags: stores tag associations (many-to-many)
 */
export function createSqliteStrategy(dbPath?: string, options?: { defaultTtl?: number }): CacheStrategy {
  let db: SqliteDatabase | null = null
  const defaultTtl = options?.defaultTtl
  const filePath = dbPath || process.env.CACHE_SQLITE_PATH || '.cache.db'

  async function getDb(): Promise<SqliteDatabase> {
    if (db) return db

    try {
      const imported = await import('better-sqlite3') as SqliteModule
      const Database = typeof imported === 'function' ? imported : imported.default
      
      // Ensure directory exists
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      db = new Database(filePath)

      // Create tables
      db.exec(`
        CREATE TABLE IF NOT EXISTS cache_entries (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at INTEGER,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cache_tags (
          key TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (key, tag),
          FOREIGN KEY (key) REFERENCES cache_entries(key) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_cache_tags_tag ON cache_tags(tag);
        CREATE INDEX IF NOT EXISTS idx_cache_entries_expires_at ON cache_entries(expires_at);
      `)

      return db
    } catch (error) {
      throw new CacheDependencyUnavailableError('sqlite', 'better-sqlite3', error)
    }
  }

  function isExpired(expiresAt: number | null): boolean {
    if (expiresAt === null) return false
    return Date.now() > expiresAt
  }

  function matchPattern(key: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(key)
  }

  type EntryRow = { value: string; expires_at: number | null }
  type ExpiresRow = { expires_at: number | null }
  type CountRow = { count: number }
  type KeyRow = { key: string }

  const get = async (key: string, options?: CacheGetOptions): Promise<CacheValue | null> => {
    const database = await getDb()
    
    const stmt = database.prepare('SELECT value, expires_at FROM cache_entries WHERE key = ?')
    const row = stmt.get(key) as EntryRow | undefined

    if (!row) return null

    try {
      const value = JSON.parse(row.value) as CacheValue
      const expiresAt = row.expires_at

      if (isExpired(expiresAt)) {
        if (options?.returnExpired) {
          return value
        }
        // Clean up expired entry
        await deleteKey(key)
        return null
      }

      return value
    } catch {
      // Invalid JSON, remove it
      await deleteKey(key)
      return null
    }
  }

  const set = async (key: string, value: CacheValue, options?: CacheSetOptions): Promise<void> => {
    const database = await getDb()
    const ttl = options?.ttl ?? defaultTtl
    const tags = options?.tags || []
    const expiresAt = ttl ? Date.now() + ttl : null
    const createdAt = Date.now()

    const serialized = JSON.stringify(value)

    database.transaction(() => {
      // Delete old tags
      database.prepare('DELETE FROM cache_tags WHERE key = ?').run(key)

      // Insert or replace cache entry
      database.prepare(`
        INSERT OR REPLACE INTO cache_entries (key, value, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(key, serialized, expiresAt, createdAt)

      // Insert new tags
      if (tags.length > 0) {
        const insertTag = database.prepare('INSERT INTO cache_tags (key, tag) VALUES (?, ?)')
        for (const tag of tags) {
          insertTag.run(key, tag)
        }
      }
    })()
  }

  const has = async (key: string): Promise<boolean> => {
    const database = await getDb()
    
    const stmt = database.prepare('SELECT expires_at FROM cache_entries WHERE key = ?')
    const row = stmt.get(key) as ExpiresRow | undefined

    if (!row) return false

    if (isExpired(row.expires_at)) {
      await deleteKey(key)
      return false
    }

    return true
  }

  const deleteKey = async (key: string): Promise<boolean> => {
    const database = await getDb()
    
    const result = database.transaction(() => {
      database.prepare('DELETE FROM cache_tags WHERE key = ?').run(key)
      const info = database.prepare('DELETE FROM cache_entries WHERE key = ?').run(key)
      return info.changes > 0
    })()

    return result
  }

  const deleteByTags = async (tags: string[]): Promise<number> => {
    const database = await getDb()
    
    // Get all unique keys that have any of the specified tags
    const placeholders = tags.map(() => '?').join(',')
    const stmt = database.prepare(`
      SELECT DISTINCT key FROM cache_tags WHERE tag IN (${placeholders})
    `)
    const rows = stmt.all(...tags) as KeyRow[]

    let deleted = 0
    for (const row of rows) {
      const success = await deleteKey(row.key)
      if (success) deleted++
    }

    return deleted
  }

  const clear = async (): Promise<number> => {
    const database = await getDb()
    
    const result = database.transaction(() => {
      const countStmt = database.prepare('SELECT COUNT(*) as count FROM cache_entries')
      const count = (countStmt.get() as CountRow).count

      database.prepare('DELETE FROM cache_tags').run()
      database.prepare('DELETE FROM cache_entries').run()

      return count
    })()

    return result
  }

  const keys = async (pattern?: string): Promise<string[]> => {
    const database = await getDb()
    
    const stmt = database.prepare('SELECT key FROM cache_entries')
    const rows = stmt.all() as KeyRow[]
    
    const allKeys = rows.map((row) => row.key)
    
    if (!pattern) return allKeys
    
    return allKeys.filter((key: string) => matchPattern(key, pattern))
  }

  const stats = async (): Promise<{ size: number; expired: number }> => {
    const database = await getDb()
    
    const sizeStmt = database.prepare('SELECT COUNT(*) as count FROM cache_entries')
    const size = (sizeStmt.get() as CountRow).count

    const now = Date.now()
    const expiredStmt = database.prepare('SELECT COUNT(*) as count FROM cache_entries WHERE expires_at IS NOT NULL AND expires_at < ?')
    const expired = (expiredStmt.get(now) as CountRow).count

    return { size, expired }
  }

  const cleanup = async (): Promise<number> => {
    const database = await getDb()
    const now = Date.now()
    
    const result = database.transaction(() => {
      // Get keys to delete
      const stmt = database.prepare('SELECT key FROM cache_entries WHERE expires_at IS NOT NULL AND expires_at < ?')
      const rows = stmt.all(now) as KeyRow[]

      // Delete tags for expired keys
      for (const row of rows) {
        database.prepare('DELETE FROM cache_tags WHERE key = ?').run(row.key)
      }

      // Delete expired entries
      const info = database.prepare('DELETE FROM cache_entries WHERE expires_at IS NOT NULL AND expires_at < ?').run(now)
      return info.changes
    })()

    return result
  }

  const close = async (): Promise<void> => {
    if (db) {
      db.close()
      db = null
    }
  }

  return {
    get,
    set,
    has,
    delete: deleteKey,
    deleteByTags,
    clear,
    keys,
    stats,
    cleanup,
    close,
  }
}
