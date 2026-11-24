import { createCacheProviderHostContext } from '@open-mercato/cache/provider'
import type { IgniteCacheCommands, IgniteConnection } from '../connection'
import { igniteCacheProviderSettingsSchema, igniteTransportWarnings } from '../settings'
import { createIgniteStrategy, IgniteCacheValueTooLargeError } from '../strategy'

function createMemoryConnection(): IgniteConnection & { store: Map<string, string> } {
  const store = new Map<string, string>()
  const commands: IgniteCacheCommands = {
    async get(key) { return store.get(key) ?? null },
    async put(key, value) { store.set(key, value) },
    async containsKey(key) { return store.has(key) },
    async removeKey(key) { return store.delete(key) },
    async removeIfEquals(key, value) {
      if (store.get(key) !== value) return false
      return store.delete(key)
    },
  }
  return {
    store,
    cacheName: 'memory',
    run: (_operation, command) => command(commands),
    async scan(_pageSize, visit) {
      for (const [key, raw] of Array.from(store.entries())) await visit(key, raw)
    },
    async close() {},
    isClosed: () => false,
  }
}

describe('ignite strategy (in-memory connection, logic only)', () => {
  it('drops the previous copy before refusing an oversize value', async () => {
    const connection = createMemoryConnection()
    const config = igniteCacheProviderSettingsSchema.parse({ endpoints: ['ignite:10800'], maxValueBytes: 1024 })
    const strategy = createIgniteStrategy(config, createCacheProviderHostContext({ id: 'open-mercato/ignite', namespace: 'unit' }), connection)
    await strategy.set('k', 'small', { tags: ['t'] })
    expect(await strategy.get('k')).toBe('small')
    await expect(strategy.set('k', 'x'.repeat(4096), { tags: ['t'] })).rejects.toBeInstanceOf(IgniteCacheValueTooLargeError)
    expect(await strategy.get('k')).toBeNull()
    expect(connection.store.size).toBe(0)
    expect(await strategy.deleteByTags(['t'])).toBe(0)
  })
})

describe('ignite transport warnings', () => {
  it('flags disabled certificate verification and a password over plaintext', () => {
    const parse = (input: Record<string, unknown>) => igniteCacheProviderSettingsSchema.parse({ endpoints: ['ignite:10800'], ...input })
    expect(igniteTransportWarnings(parse({ tls: { rejectUnauthorized: false } }))).toEqual(['tls_verification_disabled'])
    expect(igniteTransportWarnings(parse({ username: 'u', password: 'p' }))).toEqual(['credentials_over_plaintext'])
    expect(igniteTransportWarnings(parse({ username: 'u', password: 'p', tls: {} }))).toEqual([])
    expect(igniteTransportWarnings(parse({}))).toEqual([])
  })
})
