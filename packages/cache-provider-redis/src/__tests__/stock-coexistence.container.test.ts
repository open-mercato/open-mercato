import { createCacheProviderHostContext, defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import type { ResolvedCacheProvider } from '@open-mercato/cache/provider'
import { createCacheService } from '@open-mercato/cache/service'
import { randomNamespace } from '@open-mercato/cache/testing/conformance'
import { buildRespKeyLayout } from '@open-mercato/cache-redis-protocol'
import type { RespStandaloneSettings } from '@open-mercato/cache-redis-protocol'
import { ADMIN_PASSWORD, ADMIN_USER, describeContainers, startRespEngine } from '@open-mercato/cache-redis-protocol/test-support/engine'
import type { StartedRespEngine } from '@open-mercato/cache-redis-protocol/test-support/engine'
import { provider } from '../index'

let engine: StartedRespEngine | null = null

async function resolveProvider(namespace: string): Promise<ResolvedCacheProvider<RespStandaloneSettings>> {
  const settings = engine!.appSettings()
  const resolved = await resolveCacheProvider([defineCacheProviderRegistration<RespStandaloneSettings>({
    id: provider.id,
    load: async () => provider,
    settings: () => settings,
  })], { env: { CACHE_PROVIDER: provider.id, CACHE_PROVIDER_NAMESPACE: namespace } })
  return resolved as ResolvedCacheProvider<RespStandaloneSettings>
}

async function allKeys(): Promise<string[]> {
  const admin = engine!.admin()
  try {
    const found: string[] = []
    let cursor = '0'
    do {
      const [next, keys] = await admin.scan(cursor, 'COUNT', 500)
      cursor = next
      found.push(...keys)
    } while (cursor !== '0')
    return found.sort()
  } finally {
    admin.disconnect()
  }
}

describeContainers('redis:7.2 · stock CACHE_STRATEGY=redis next to open-mercato/redis', () => {
  jest.setTimeout(180_000)

  beforeAll(async () => {
    engine = await startRespEngine({ image: 'redis:7.2', serverBinary: 'redis-server', tls: false })
  }, 300_000)

  afterAll(async () => {
    await engine?.stop()
  }, 120_000)

  it('keeps the stock wire format and both caches isolated on one database', async () => {
    const stockUrl = `redis://${ADMIN_USER}:${ADMIN_PASSWORD}@${engine!.host}:${engine!.port}`
    const stock = createCacheService({ strategy: 'redis', redisUrl: stockUrl })
    const namespace = randomNamespace('coexist')
    const resolved = await resolveProvider(namespace)
    const opted = createCacheService({ provider: resolved })
    try {
      await stock.set('shared:key', { from: 'stock' }, { tags: ['shared-tag'] })
      await opted.set('shared:key', { from: 'provider' }, { tags: ['shared-tag'] })
      expect(await stock.get('shared:key')).toEqual({ from: 'stock' })
      expect(await opted.get('shared:key')).toEqual({ from: 'provider' })

      const keys = await allKeys()
      const providerKeys = keys.filter((key) => key.startsWith(buildRespKeyLayout(namespace).prefix))
      const stockKeys = keys.filter((key) => !key.startsWith('om:{'))
      expect(providerKeys.length).toBeGreaterThan(0)
      expect(stockKeys.length).toBeGreaterThan(0)
      for (const key of stockKeys) expect(key.startsWith('cache:') || key.startsWith('tag:')).toBe(true)
      expect(keys.every((key) => providerKeys.includes(key) || stockKeys.includes(key))).toBe(true)

      const admin = engine!.admin()
      try {
        const stockValueKey = stockKeys.find((key) => key.startsWith('cache:') && !key.includes(':meta:'))!
        const stockEntry = JSON.parse(String(await admin.get(stockValueKey)))
        expect(Object.keys(stockEntry).sort()).toEqual(['createdAt', 'expiresAt', 'key', 'tags', 'value'])
      } finally {
        admin.disconnect()
      }

      expect(await opted.deleteByTags(['shared-tag'])).toBe(1)
      expect(await stock.get('shared:key')).toEqual({ from: 'stock' })
      await opted.set('only-provider', 1)
      expect(await stock.clear()).toBe(1)
      expect(await opted.get('only-provider')).toBe(1)

      const direct = await resolved.definition.create(resolved.config, createCacheProviderHostContext(resolved))
      try {
        await stock.set('stock-again', 'x')
        await direct.clear()
        expect(await stock.get('stock-again')).toBe('x')
      } finally {
        await direct.close?.()
      }
    } finally {
      await stock.clear().catch(() => undefined)
      await opted.clear().catch(() => undefined)
      await stock.close?.()
      await opted.close?.()
    }
  })
})
