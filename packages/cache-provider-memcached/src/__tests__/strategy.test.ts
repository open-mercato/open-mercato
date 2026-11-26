import { createCacheProviderHostContext } from '@open-mercato/cache/provider'
import type { MemcachedClient, MemcachedCommandName } from '../protocol/client'
import type { MemcachedItem } from '../protocol/commands'
import { memcachedSettingsSchema } from '../settings'
import { createMemcachedStrategy } from '../strategy'

function createMemoryClient(): MemcachedClient & { items: Map<string, MemcachedItem> } {
  const items = new Map<string, MemcachedItem>()
  let casCounter = 0
  const store = (key: string, value: Buffer) => {
    casCounter += 1
    items.set(key, { value: Buffer.from(value), cas: String(casCounter), flags: 0 })
  }
  const counts = {} as Record<MemcachedCommandName, number>
  return {
    items,
    async metaGet(key) { return items.get(key) ?? null },
    async metaGetMany(keys) {
      const found = new Map<string, MemcachedItem>()
      for (const key of keys) {
        const item = items.get(key)
        if (item) found.set(key, item)
      }
      return found
    },
    async metaSet(key, value, options) {
      const current = items.get(key)
      if (options?.mode === 'add' && current) return 'not_stored'
      if (options?.cas !== undefined && current?.cas !== options.cas) return current ? 'exists' : 'not_found'
      store(key, value)
      return 'stored'
    },
    async metaDelete(key, options) {
      const current = items.get(key)
      if (!current) return 'not_found'
      if (options?.cas !== undefined && current.cas !== options.cas) return 'exists'
      items.delete(key)
      return 'deleted'
    },
    async gets(keys) { return this.metaGetMany(keys) },
    async add() { return 'not_stored' },
    async cas() { return 'not_stored' },
    async noop() {},
    async version() { return '1.6.45' },
    async stats() { return new Map([['item_size_max', String(64 * 1024)]]) },
    commandCounts: () => counts,
    describe: () => 'memory',
    async close() {},
  }
}

describe('memcached strategy (in-memory client, logic only)', () => {
  it('drops the previous copy before refusing an oversize value', async () => {
    const client = createMemoryClient()
    const config = memcachedSettingsSchema.parse({ host: 'memory', bucketCount: 2, casBackoffMs: 0 })
    const context = createCacheProviderHostContext({ id: 'open-mercato/memcached', namespace: 'unit' })
    const strategy = createMemcachedStrategy(client, config, context, { itemSizeMax: 64 * 1024 })
    await strategy.set('k', 'small', { tags: ['t'] })
    await strategy.set('other', 'kept', { tags: ['t'] })
    expect(await strategy.get('k')).toBe('small')
    await expect(strategy.set('k', 'x'.repeat(128 * 1024), { tags: ['t'] })).rejects.toMatchObject({ code: 'item_too_large' })
    expect(await strategy.get('k')).toBeNull()
    expect(await strategy.get('other')).toBe('kept')
    expect(await strategy.deleteByTags(['t'])).toBe(1)
  })
})
