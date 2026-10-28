/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { createRedisStrategy } from '../strategies/redis'

const redisUrl = process.env.CACHE_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

describeWithRedis('redis strategy value compression against a live Redis', () => {
  const largeValue = {
    items: Array.from({ length: 100 }, (_, index) => ({ id: `row-${index}`, name: `Contact ${index}`, status: 'active' })),
  }
  const runId = randomUUID()

  it.each(['zstd', 'gzip'] as const)('round-trips %s frames and legacy JSON over the binary-safe path', async (compression) => {
    const legacy = createRedisStrategy(redisUrl, { compression: 'off' })
    const compressed = createRedisStrategy(redisUrl, { compression })
    const legacyKey = `compression-live:${runId}:${compression}:legacy`
    const compressedKey = `compression-live:${runId}:${compression}:compressed`
    const tag = `compression-live:${runId}:${compression}`

    try {
      await legacy.set(legacyKey, largeValue, { ttl: 60_000, tags: [tag] })
      await compressed.set(compressedKey, largeValue, { ttl: 60_000, tags: [tag] })

      expect(await compressed.get(legacyKey)).toEqual(largeValue)
      expect(await compressed.get(compressedKey)).toEqual(largeValue)
      expect(await legacy.get(compressedKey)).toEqual(largeValue)
      expect(await compressed.has(compressedKey)).toBe(true)

      await compressed.set(compressedKey, largeValue, { ttl: 60_000, tags: [`${tag}:next`] })
      expect(await compressed.deleteByTags([tag])).toBe(1)
      expect(await compressed.deleteByTags([`${tag}:next`])).toBe(1)
      expect(await compressed.get(compressedKey)).toBeNull()
    } finally {
      await legacy.delete(legacyKey)
      await compressed.delete(compressedKey)
      await legacy.close?.()
      await compressed.close?.()
    }
  })
})
