import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSqliteStrategy } from '../strategies/sqlite'

type CacheEntry = { value: string; expires_at: number | null; created_at: number }

class MockSqliteDatabase {
  static instances: MockSqliteDatabase[] = []

  execCalls: string[] = []
  entries = new Map<string, CacheEntry>()
  tags = new Map<string, Set<string>>()
  closed = false

  constructor(public readonly file: string) {
    MockSqliteDatabase.instances.push(this)
  }

  exec(sql: string): void {
    this.execCalls.push(sql)
  }

  transaction<TResult>(fn: () => TResult): () => TResult {
    return fn
  }

  close(): void {
    this.closed = true
  }

  prepare<TResult = unknown>(sql: string): {
    get(...args: unknown[]): TResult | undefined
    all(...args: unknown[]): TResult[]
    run(...args: unknown[]): { changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    return {
      get: (...args: unknown[]) => this.get(normalized, args) as TResult | undefined,
      all: (...args: unknown[]) => this.all(normalized, args) as TResult[],
      run: (...args: unknown[]) => this.run(normalized, args),
    }
  }

  private get(sql: string, args: unknown[]) {
    if (sql === 'SELECT value, expires_at FROM cache_entries WHERE key = ?') {
      const entry = this.entries.get(String(args[0]))
      return entry ? { value: entry.value, expires_at: entry.expires_at } : undefined
    }

    if (sql === 'SELECT expires_at FROM cache_entries WHERE key = ?') {
      const entry = this.entries.get(String(args[0]))
      return entry ? { expires_at: entry.expires_at } : undefined
    }

    if (sql === 'SELECT COUNT(*) as count FROM cache_entries') {
      return { count: this.entries.size }
    }

    throw new Error(`Unhandled sqlite get statement: ${sql}`)
  }

  private all(sql: string, args: unknown[]) {
    if (sql.startsWith('SELECT DISTINCT key FROM cache_tags WHERE tag IN')) {
      const matching = new Set<string>()

      for (const [key, tags] of this.tags) {
        if (args.some((tag) => tags.has(String(tag)))) {
          matching.add(key)
        }
      }

      return Array.from(matching).map((key) => ({ key }))
    }

    if (sql === 'SELECT key FROM cache_entries') {
      return Array.from(this.entries.keys()).map((key) => ({ key }))
    }

    throw new Error(`Unhandled sqlite all statement: ${sql}`)
  }

  private run(sql: string, args: unknown[]) {
    if (sql === 'DELETE FROM cache_tags WHERE key = ?') {
      this.tags.delete(String(args[0]))
      return { changes: 1 }
    }

    if (sql.startsWith('INSERT OR REPLACE INTO cache_entries')) {
      const [key, value, expiresAt, createdAt] = args
      this.entries.set(String(key), {
        value: String(value),
        expires_at: expiresAt === null ? null : Number(expiresAt),
        created_at: Number(createdAt),
      })
      return { changes: 1 }
    }

    if (sql === 'INSERT INTO cache_tags (key, tag) VALUES (?, ?)') {
      const key = String(args[0])
      const tag = String(args[1])
      const tags = this.tags.get(key) ?? new Set<string>()
      tags.add(tag)
      this.tags.set(key, tags)
      return { changes: 1 }
    }

    if (sql === 'DELETE FROM cache_entries WHERE key = ?') {
      const key = String(args[0])
      const existed = this.entries.delete(key)
      this.tags.delete(key)
      return { changes: existed ? 1 : 0 }
    }

    throw new Error(`Unhandled sqlite run statement: ${sql}`)
  }
}

describe('SQLite Cache Strategy', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    MockSqliteDatabase.instances = []
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-mercato-cache-'))
    dbPath = path.join(tempDir, 'cache.db')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('configures cache-appropriate SQLite pragmas on open', async () => {
    const cache = createSqliteStrategy(dbPath, { databaseConstructor: MockSqliteDatabase })

    await cache.set('list:page:1', { rows: [{ id: '1', name: 'Ada' }] }, { tags: ['customers', 'org:1'] })

    const database = MockSqliteDatabase.instances[0]
    expect(database.execCalls[0]).toContain('PRAGMA journal_mode = WAL;')
    expect(database.execCalls[0]).toContain('PRAGMA synchronous = NORMAL;')
    expect(database.execCalls[0]).toContain('PRAGMA busy_timeout = 5000;')
    expect(database.execCalls[0]).toContain('PRAGMA foreign_keys = ON;')

    await cache.close?.()
    expect(database.closed).toBe(true)
  })

  it('preserves tag replacement and invalidation behavior', async () => {
    const cache = createSqliteStrategy(dbPath, { databaseConstructor: MockSqliteDatabase })

    await cache.set('user:1', { name: 'Ada' }, { tags: ['users', 'org:1'] })
    await cache.set('user:1', { name: 'Ada Lovelace' }, { tags: ['users', 'org:2'] })

    expect(await cache.deleteByTags(['org:1'])).toBe(0)
    expect(await cache.get('user:1')).toEqual({ name: 'Ada Lovelace' })

    expect(await cache.deleteByTags(['org:2'])).toBe(1)
    expect(await cache.get('user:1')).toBeNull()

    await cache.close?.()
  })
})
