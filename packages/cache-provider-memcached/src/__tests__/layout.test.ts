import { resolvePhysicalCacheValueKey } from '@open-mercato/cache/service'
import {
  allBucketItemKeys,
  bucketIndexFor,
  bucketItemKey,
  bucketItemKeyFor,
  decodeBucket,
  encodeBucket,
  fitBucket,
  routingKey,
  type BucketEntries,
  type StoredEntry,
} from '../layout'

function entry(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return { p: '{"v":1}', t: [], x: null, c: 1, ...overrides }
}

describe('memcached bucket layout', () => {
  it('addresses fixed buckets inside the deployment namespace and layout version', () => {
    expect(bucketItemKey('prod-eu', 64, 17)).toBe('prod-eu:v1:b64:17')
    const keys = allBucketItemKeys('prod-eu', 8)
    expect(keys).toHaveLength(8)
    expect(keys.every((key) => key.startsWith('prod-eu:v1:b8:'))).toBe(true)
    expect(new Set(keys).size).toBe(8)
  })

  it('routes deterministically and within range', () => {
    for (const count of [1, 7, 64, 4096]) {
      for (let index = 0; index < 50; index++) {
        const physical = `tenant:t${index}:key:k:${'a'.repeat(64)}`
        const bucket = bucketIndexFor(physical, count)
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(count)
        expect(bucketIndexFor(physical, count)).toBe(bucket)
      }
    }
  })

  it('co-locates the wrapper value and metadata records of one logical key', () => {
    const value = resolvePhysicalCacheValueKey('orders:42', 'tenant-a')
    const meta = value.replace(':key:k:', ':key:meta:')
    expect(value).not.toBe(meta)
    expect(routingKey(value)).toBe(routingKey(meta))
    expect(bucketItemKeyFor('ns', 64, value)).toBe(bucketItemKeyFor('ns', 64, meta))
    const otherTenant = resolvePhysicalCacheValueKey('orders:42', 'tenant-b')
    expect(routingKey(otherTenant)).not.toBe(routingKey(value))
    expect(routingKey('plain-key')).toBe('plain-key')
  })

  it('round-trips bucket entries and rejects foreign or corrupt items', () => {
    const entries: BucketEntries = new Map([
      ['a', entry({ t: ['x'], x: 99 })],
      ['b', entry({ p: 'AAEC', b: 1 })],
    ])
    const decoded = decodeBucket(encodeBucket(entries))
    expect(decoded).toEqual(entries)
    expect(decodeBucket(Buffer.from('not json'))).toBeNull()
    expect(decodeBucket(Buffer.from('{"v":2,"e":{}}'))).toBeNull()
    expect(decodeBucket(Buffer.from('[1,2]'))).toBeNull()
    expect(decodeBucket(Buffer.from('{"v":1,"e":{"ok":{"p":"x","t":[],"x":null,"c":1},"bad":{"p":1}}}'))?.size).toBe(1)
  })

  it('evicts the oldest unprotected value+metadata groups to fit the item limit', () => {
    const payload = 'x'.repeat(200)
    const entries: BucketEntries = new Map()
    const hash = (seed: string) => seed.repeat(64).slice(0, 64)
    entries.set(`tenant:t:key:k:${hash('1')}`, entry({ p: payload, c: 1 }))
    entries.set(`tenant:t:key:meta:${hash('1')}`, entry({ c: 1 }))
    entries.set(`tenant:t:key:k:${hash('2')}`, entry({ p: payload, c: 2 }))
    entries.set(`tenant:t:key:meta:${hash('2')}`, entry({ c: 2 }))
    entries.set(`tenant:t:key:k:${hash('3')}`, entry({ p: payload, c: 0 }))
    const protectedRoutes = new Set([routingKey(`tenant:t:key:k:${hash('3')}`)])
    const full = encodeBucket(entries).length
    const fitted = fitBucket(new Map(entries), full - 100, protectedRoutes)
    expect(fitted).not.toBeNull()
    const kept = decodeBucket(fitted!.buffer)!
    expect(fitted!.evicted).toBe(2)
    expect(kept.has(`tenant:t:key:k:${hash('1')}`)).toBe(false)
    expect(kept.has(`tenant:t:key:meta:${hash('1')}`)).toBe(false)
    expect(kept.has(`tenant:t:key:k:${hash('2')}`)).toBe(true)
    expect(kept.has(`tenant:t:key:k:${hash('3')}`)).toBe(true)
    expect(fitBucket(new Map(entries), 50, protectedRoutes)).toBeNull()
  })
})
