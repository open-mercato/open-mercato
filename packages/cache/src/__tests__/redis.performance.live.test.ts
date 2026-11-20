/** @jest-environment node */
import { createHash, randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { createCacheService } from '../service'
import { createRedisStrategy } from '../strategies/redis'
import { runWithCacheTenant } from '../tenantContext'

const redisUrl = process.env.CACHE_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

describeWithRedis('redis invalidation batching contracts against a live Redis', () => {
  const value = {
    products: Array.from({ length: 80 }, (_, index) => ({
      sku: `AGRAM-FROZEN-${index}`,
      product: 'Frozen vegetables, fruit and ready meals',
      storage: 'Keep frozen at -18°C',
    })),
  }

  it.each([
    ['strategy', 'gzip'], ['service', 'gzip'],
    ['strategy', 'off'], ['service', 'off'],
  ] as const)(
    '%s invalidates %s values across multiple batches while preserving unrelated data',
    async (layer, compression) => {
      const runId = `invalidation-live-${randomUUID()}`
      const tenant = `${runId}-selected`
      const otherTenant = `${runId}-other`
      const tags = [`${runId}:products`, `${runId}:frozen`, `${runId}:inventory`]
      const oldTag = `${runId}:previous-category`
      const controlTags = layer === 'service' ? tags : [`${runId}:unrelated`]
      const cache = layer === 'strategy'
        ? createRedisStrategy(redisUrl, { compression })
        : createCacheService({ strategy: 'redis', redisUrl, compression, defaultTtl: 60_000 })
      // A separate client is used only for fixture expiry and physical-storage assertions.
      const admin = new Redis(redisUrl!, { protocol: 2 })
      const count = 513 // More than two 256-key batches; the service stores two physical entries per key.
      const keys = Array.from({ length: count }, (_, index) => `${runId}:product:${index}`)
      const orphan = `${runId}:expired-product`
      const control = `${runId}:control`
      const inTenant = <T>(target: string, action: () => Promise<T>): Promise<T> => (
        layer === 'service' ? runWithCacheTenant(target, action) : action()
      )
      const digest = (input: string) => createHash('sha256').update(input).digest('hex')
      const physicalKeys = (key: string) => layer === 'strategy'
        ? [`cache:${key}`]
        : [`cache:tenant:${tenant}:key:k:${digest(key)}`, `cache:tenant:${tenant}:key:meta:${digest(key)}`]
      const physicalTag = (tag: string) => layer === 'strategy'
        ? `tag:${tag}`
        : `tag:tenant:${tenant}:tag:t:${digest(tag)}`

      try {
        await cache.healthcheck?.() // A fallback backend must not make this live test pass.
        for (let offset = 0; offset < keys.length; offset += 16) {
          await Promise.all(keys.slice(offset, offset + 16).map((key) => inTenant(
            tenant,
            () => cache.set(key, value, { ttl: 60_000, tags: [oldTag] }),
          )))
        }
        for (let offset = 0; offset < keys.length; offset += 16) {
          await Promise.all(keys.slice(offset, offset + 16).map((key) => inTenant(
            tenant,
            () => cache.set(key, value, { ttl: 60_000, tags }),
          )))
        }
        await inTenant(tenant, () => cache.set(orphan, value, { ttl: 60_000, tags }))
        await inTenant(otherTenant, () => cache.set(control, value, { ttl: 60_000, tags: controlTags }))

        const stored = await admin.getBuffer(physicalKeys(keys[0])[0])
        if (compression === 'gzip') expect(stored?.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]))
        else expect(JSON.parse(stored!.toString('utf8')).value).toEqual(value)
        expect(await inTenant(tenant, () => cache.get(keys[count - 1]))).toEqual(value)
        // A stale index is a candidate list: reaping it must preserve all current
        // values, including service metadata, across more than two read batches.
        expect(await admin.scard(physicalTag(oldTag))).toBe(count * (layer === 'service' ? 2 : 1))
        expect(await inTenant(tenant, () => cache.deleteByTags([oldTag]))).toBe(0)
        expect(await admin.scard(physicalTag(oldTag))).toBe(0)
        expect((await admin.mget(...keys.flatMap(physicalKeys))).every((entry) => entry !== null)).toBe(true)
        // Redis expiry removes value keys, leaving the secondary tag memberships.
        await admin.del(...physicalKeys(orphan))
        expect(await admin.scard(physicalTag(tags[0]))).toBe((count + 1) * (layer === 'service' ? 2 : 1))

        // All three tags overlap completely. Returned counts must deduplicate
        // memberships, exclude already-expired values, and normalize metadata.
        expect(await inTenant(tenant, () => cache.deleteByTags(tags))).toBe(count)
        expect(await inTenant(tenant, () => cache.deleteByTags(tags))).toBe(0)
        expect(await inTenant(otherTenant, () => cache.get(control))).toEqual(value)
        for (const tag of tags) expect(await admin.scard(physicalTag(tag))).toBe(0)

        const remaining = await admin.mget(...keys.flatMap(physicalKeys))
        expect(remaining.every((entry) => entry === null)).toBe(true)
        expect(await inTenant(otherTenant, () => cache.deleteByTags(controlTags))).toBe(1)
      } finally {
        // Clean only this run's namespace, including residual indexes after a failure.
        // Collect before deleting so cleanup itself does not perturb the cursor walk.
        let cursor = '0'
        const ownKeys = new Set<string>()
        do {
          const [next, page] = await admin.scan(cursor, 'MATCH', `*${runId}*`, 'COUNT', 256)
          cursor = next
          for (const key of page) ownKeys.add(key)
        } while (cursor !== '0')
        const cleanupKeys = [...ownKeys]
        for (let offset = 0; offset < cleanupKeys.length; offset += 256) {
          await admin.del(...cleanupKeys.slice(offset, offset + 256))
        }
        await admin.quit()
        await cache.close?.()
      }
    },
    30_000,
  )
})
