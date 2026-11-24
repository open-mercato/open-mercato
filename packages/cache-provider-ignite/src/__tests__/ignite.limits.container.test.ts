import IgniteClient from 'apache-ignite-client'
import { inCacheTenant, randomNamespace, sleep } from '@open-mercato/cache/testing/conformance'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { igniteCacheName } from '../index'
import { containerTestsEnabled, startIgnite, type StartedIgnite } from './support/ignite-container'
import { createIgniteService } from './support/service'

const describeContainer = containerTestsEnabled ? describe : describe.skip
const SERVER_MAX_TTL_SECONDS = 3
const REGION_MB = 64

async function rawSize(endpoint: string, cacheName: string): Promise<number> {
  const client = new IgniteClient()
  await client.connect(new IgniteClient.IgniteClientConfiguration(endpoint))
  try {
    return await client.getCache(cacheName).getSize()
  } finally {
    client.disconnect()
  }
}

describeContainer(`Apache Ignite 2.x server limits (container: ${SERVER_MAX_TTL_SECONDS}s template TTL, ${REGION_MB} MiB region)`, () => {
  let ignite: StartedIgnite

  beforeAll(async () => {
    ignite = await startIgnite({ maxTtlSeconds: SERVER_MAX_TTL_SECONDS, regionMb: REGION_MB })
  }, 240_000)

  afterAll(async () => {
    await ignite?.container.stop()
  }, 60_000)

  const open = (namespace: string): Promise<CacheStrategy> => createIgniteService(namespace, {
    endpoints: [ignite.endpoint],
    commandTimeoutMs: 15_000,
    scanPageSize: 64,
  })

  it('bounds the physical lifetime of entries without a TTL through the CreatedExpiryPolicy template', async () => {
    const namespace = randomNamespace('maxttl')
    const service = await open(namespace)
    try {
      await inCacheTenant('maxttl', async () => {
        await service.set('no-ttl', 'value', { tags: ['bounded'] })
        await service.set('logical', 'value', { ttl: 500 })
        expect(await service.get('no-ttl')).toBe('value')
        expect(await rawSize(ignite.endpoint, igniteCacheName('om-cache-', namespace))).toBe(4)
        await sleep(800)
        expect(await service.get('logical')).toBeNull()
        expect(await service.get('logical', { returnExpired: true })).toBe('value')
        await sleep(SERVER_MAX_TTL_SECONDS * 1000 + 1_500)
        expect(await service.get('no-ttl')).toBeNull()
        expect(await service.get('logical', { returnExpired: true })).toBeNull()
        expect(await service.keys()).toEqual([])
        expect(await service.deleteByTags(['bounded'])).toBe(0)
      })
      expect(await rawSize(ignite.endpoint, igniteCacheName('om-cache-', namespace))).toBe(0)
    } finally {
      await service.close!()
    }
  }, 60_000)

  it('evicts whole entries under capacity pressure without failing writes or leaving stale tag members', async () => {
    const namespace = randomNamespace('evict')
    const service = await open(namespace)
    const payload = 'x'.repeat(200 * 1024)
    const total = Math.ceil((REGION_MB * 2 * 1024) / 200)
    let written = 0
    try {
      await inCacheTenant('evict', async () => {
        for (let start = 0; start < total; start += 16) {
          await Promise.all(Array.from({ length: Math.min(16, total - start) }, async (_, offset) => {
            await service.set(`big:${start + offset}`, payload, { tags: ['pressure'] })
            written += 1
          }))
        }
        expect(written).toBe(total)
        const surviving = (await service.keys('big:*')).length
        expect(surviving).toBeGreaterThan(0)
        expect(surviving).toBeLessThan(total)
        const sample = await service.get(`big:${total - 1}`)
        expect(sample === null || sample === payload).toBe(true)
        await service.healthcheck!()
        await service.deleteByTags(['pressure'])
        expect(await service.keys('big:*')).toEqual([])
        process.stderr.write(`[ignite-limits] wrote ${total} x 200 KiB into a ${REGION_MB} MiB region; ${surviving} logical entries survived eviction\n`)
      })
    } finally {
      await service.close!()
    }
  }, 240_000)
})
