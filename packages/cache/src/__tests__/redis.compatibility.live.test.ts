/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { createRedisStrategy } from '../strategies/redis'

const redisUrl = process.env.CACHE_REDIS_TEST_URL
const describeWithRedis = redisUrl ? describe : describe.skip

describeWithRedis('Redis batch compatibility against the real server', () => {
  async function fixture(run: (context: {
    strategy: ReturnType<typeof createRedisStrategy>
    admin: Redis
    key: string
    tag: string
  }) => Promise<void>, compression: 'off' | 'gzip' | 'zstd' = 'off') {
    const prefix = `batch-compat-${randomUUID()}`
    const key = `${prefix}:value`
    const tag = `${prefix}:tag`
    const strategy = createRedisStrategy(redisUrl, { compression, defaultTtl: 60_000 })
    const admin = new Redis(redisUrl!, { protocol: 2, maxRetriesPerRequest: 1 })
    try {
      expect(await admin.dbsize()).toBe(0)
      await strategy.healthcheck?.()
      await run({ strategy, admin, key, tag })
    } finally {
      let cursor = '0'
      const keys = new Set<string>()
      do {
        const [next, page] = await admin.scan(cursor, 'MATCH', `*${prefix}*`, 'COUNT', 256)
        cursor = next
        for (const ownKey of page) keys.add(ownKey)
      } while (cursor !== '0')
      const ownKeys = [...keys]
      for (let offset = 0; offset < ownKeys.length; offset += 256) {
        await admin.del(...ownKeys.slice(offset, offset + 256))
      }
      await admin.quit()
      await strategy.close?.()
    }
  }

  it.each(['invalidation', 'stats', 'cleanup'] as const)(
    '%s reports WRONGTYPE instead of treating a Redis set as a missing string',
    async (operation) => fixture(async ({ strategy, admin, key, tag }) => {
      await strategy.set(key, { healthy: true }, { tags: [tag] })
      await admin.del(`cache:${key}`)
      await admin.sadd(`cache:${key}`, 'wrong-value-type')
      const result = operation === 'invalidation'
        ? strategy.deleteByTags([tag])
        : operation === 'stats' ? strategy.stats() : strategy.cleanup!()
      await expect(result).rejects.toThrow('WRONGTYPE')
      expect(await admin.type(`cache:${key}`)).toBe('set')
      expect(await admin.sismember(`tag:${tag}`, key)).toBe(1)
    }),
  )

  it.each(['off', 'gzip'] as const)(
    'preserves a %s rebuild after the missing MGET reply during validation',
    async (compression) => fixture(async ({ strategy, admin, key, tag }) => {
      await admin.sadd(`tag:${tag}`, key)
      const original = Redis.prototype.mgetBuffer
      let rebuilt = false
      Redis.prototype.mgetBuffer = async function (this: Redis, ...keys: string[]) {
        const buffers = await original.apply(this, keys)
        if (!rebuilt && keys.includes(`cache:${key}`)) {
          expect(buffers[keys.indexOf(`cache:${key}`)]).toBeNull()
          rebuilt = true
          await strategy.set(key, { revision: 'fresh', padding: 'fresh-content '.repeat(256) }, { tags: [tag] })
        }
        return buffers
      } as typeof original
      try {
        expect(await strategy.deleteByTags([tag])).toBe(0)
        expect(rebuilt).toBe(true)
        expect(await strategy.get(key)).toMatchObject({ revision: 'fresh' })
        expect(await admin.sismember(`tag:${tag}`, key)).toBe(1)
        if (compression === 'gzip') {
          expect((await admin.getBuffer(`cache:${key}`))?.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]))
        }
        expect(await strategy.deleteByTags([tag])).toBe(1)
      } finally {
        Redis.prototype.mgetBuffer = original
      }
    }, compression),
  )

  it.each(['off', 'gzip', 'zstd'] as const)(
    'reconciles %s old tags without deleting a retagged or tagless value',
    async (compression) => fixture(async ({ strategy, admin, key, tag }) => {
      const nextTag = `${tag}:next`
      const payload = { revision: 'fresh', padding: 'frozen-products '.repeat(256) }
      await strategy.set(key, 'old', { tags: [tag] })
      await strategy.set(key, payload, { tags: [nextTag] })
      expect(await admin.sismember(`tag:${tag}`, key)).toBe(1)
      expect(await strategy.deleteByTags([tag])).toBe(0)
      expect(await strategy.get(key)).toEqual(payload)
      expect(await admin.scard(`tag:${tag}`)).toBe(0)
      expect(await admin.sismember(`tag:${nextTag}`, key)).toBe(1)
      const ttl = await admin.pttl(`cache:${key}`)
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(60_000)

      await strategy.set(key, payload, { tags: [tag] })
      expect(await strategy.deleteByTags([nextTag, tag, tag])).toBe(1)
      expect(await admin.scard(`tag:${nextTag}`)).toBe(0)
      expect(await admin.scard(`tag:${tag}`)).toBe(0)

      await strategy.set(key, payload, { tags: [tag] })
      await strategy.set(key, payload, { tags: [] })
      expect(await strategy.deleteByTags([tag])).toBe(0)
      expect(await strategy.get(key)).toEqual(payload)
      expect(await admin.scard(`tag:${tag}`)).toBe(0)
    }, compression),
  )

  it.each(['off', 'gzip'] as const)(
    'preserves a %s tag reintroduced before stale membership reconciliation',
    async (compression) => fixture(async ({ strategy, admin, key, tag }) => {
      await strategy.set(key, 'old', { tags: [tag] })
      await strategy.set(key, { revision: 'retagged', padding: 'content '.repeat(512) }, { tags: [`${tag}:next`] })
      const original = Redis.prototype.mgetBuffer
      let rebuilt = false
      Redis.prototype.mgetBuffer = async function (this: Redis, ...keys: string[]) {
        const buffers = await original.apply(this, keys)
        if (!rebuilt && keys.includes(`cache:${key}`)) {
          rebuilt = true
          await strategy.set(key, { revision: 'reintroduced', padding: 'new-content '.repeat(512) }, { tags: [tag] })
        }
        return buffers
      } as typeof original
      try {
        expect(await strategy.deleteByTags([tag])).toBe(0)
        expect(rebuilt).toBe(true)
        expect(await strategy.get(key)).toMatchObject({ revision: 'reintroduced' })
        expect(await admin.sismember(`tag:${tag}`, key)).toBe(1)
        expect(await strategy.deleteByTags([tag])).toBe(1)
      } finally {
        Redis.prototype.mgetBuffer = original
      }
    }, compression),
  )

  it('reaps stale membership when the observed value disappears before reconciliation', async () => fixture(
    async ({ strategy, admin, key, tag }) => {
      await strategy.set(key, 'old', { tags: [tag] })
      await strategy.set(key, 'retagged', { tags: [`${tag}:next`] })
      const original = Redis.prototype.mgetBuffer
      Redis.prototype.mgetBuffer = async function (this: Redis, ...keys: string[]) {
        const buffers = await original.apply(this, keys)
        await admin.del(`cache:${key}`)
        return buffers
      } as typeof original
      try {
        expect(await strategy.deleteByTags([tag])).toBe(0)
        expect(await admin.scard(`tag:${tag}`)).toBe(0)
      } finally {
        Redis.prototype.mgetBuffer = original
      }
    },
  ))

  it('reports transaction command errors even when the value write succeeds', async () => fixture(
    async ({ strategy, admin, key, tag }) => {
      await admin.set(`tag:${tag}`, 'wrong-tag-type')
      await expect(strategy.set(key, 'new-value', { tags: [tag] })).rejects.toThrow('WRONGTYPE')
      expect(await strategy.get(key)).toBe('new-value')
      expect(await admin.get(`tag:${tag}`)).toBe('wrong-tag-type')
    },
  ))

  it.each([[42], [null], [{}]])('deletes a JSON entry with malformed tags %j', async (invalidTag) => fixture(
    async ({ strategy, admin, key, tag }) => {
      await strategy.set(key, 'old', { tags: [tag] })
      await admin.set(`cache:${key}`, JSON.stringify({
        key, value: 'malformed', tags: [invalidTag], expiresAt: null, createdAt: Date.now(),
      }))
      expect(await strategy.deleteByTags([tag])).toBe(1)
      expect(await admin.exists(`cache:${key}`)).toBe(0)
      expect(await strategy.deleteByTags([tag])).toBe(0)
      expect(await admin.scard(`tag:${tag}`)).toBe(0)
    },
  ))

  it('can overwrite a TTL entry with a persistent tagless value', async () => fixture(
    async ({ strategy, admin, key, tag }) => {
      await strategy.set(key, 'old', { tags: [tag], ttl: 60_000 })
      await strategy.set(key, 'persistent', { tags: [], ttl: 0 })
      expect(await admin.pttl(`cache:${key}`)).toBe(-1)
      expect(await strategy.deleteByTags([tag])).toBe(0)
      expect(await strategy.get(key)).toBe('persistent')
      expect(await admin.scard(`tag:${tag}`)).toBe(0)
    },
  ))

  it('overwrites a non-string old value using Redis SET semantics', async () => fixture(
    async ({ strategy, admin, key, tag }) => {
      await admin.sadd(`cache:${key}`, 'old-non-string-value')
      await strategy.set(key, 'replacement', { tags: [tag] })
      expect(await admin.type(`cache:${key}`)).toBe('string')
      expect(await strategy.get(key)).toBe('replacement')
      expect(await strategy.deleteByTags([tag])).toBe(1)
    },
  ))

  it('reports WRONGTYPE if a value changes type before stale membership reconciliation', async () => fixture(
    async ({ strategy, admin, key, tag }) => {
      await strategy.set(key, 'old', { tags: [tag] })
      await strategy.set(key, 'retagged', { tags: [`${tag}:next`] })
      const original = Redis.prototype.mgetBuffer
      Redis.prototype.mgetBuffer = async function (this: Redis, ...keys: string[]) {
        const buffers = await original.apply(this, keys)
        await admin.del(`cache:${key}`)
        await admin.sadd(`cache:${key}`, 'changed-type')
        return buffers
      } as typeof original
      try {
        await expect(strategy.deleteByTags([tag])).rejects.toThrow('WRONGTYPE')
        expect(await admin.sismember(`tag:${tag}`, key)).toBe(1)
        expect(await admin.type(`cache:${key}`)).toBe('set')
      } finally {
        Redis.prototype.mgetBuffer = original
      }
    },
  ))
})
