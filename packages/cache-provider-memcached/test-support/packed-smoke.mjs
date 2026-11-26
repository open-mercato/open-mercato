// Runs inside a fresh app that installed the packed provider and the packed
// @open-mercato/cache. Resolves the provider through an app registration and
// runs a basic cache workflow. The cache service host comes from a source
// bundle (SMOKE_HOST_BUNDLE) because @open-mercato/cache's service entry also
// needs @open-mercato/shared, which a real app always has installed.
import { pathToFileURL } from 'node:url'
import { defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import { createMemcachedClient, createTcpTransport } from '@open-mercato/cache-provider-memcached/protocol'

const { SMOKE_HOST_BUNDLE, SMOKE_HOST, SMOKE_PORT, SMOKE_NAMESPACE } = process.env
const host = await import(pathToFileURL(SMOKE_HOST_BUNDLE).href)
const settings = { host: SMOKE_HOST, port: Number(SMOKE_PORT), bucketCount: 16 }

const registration = defineCacheProviderRegistration({
  id: 'open-mercato/memcached',
  load: () => import('@open-mercato/cache-provider-memcached').then((module) => module.provider),
  settings: () => settings,
})
const resolved = await resolveCacheProvider([registration], {
  env: { CACHE_PROVIDER: 'open-mercato/memcached', CACHE_PROVIDER_NAMESPACE: SMOKE_NAMESPACE },
})
const service = host.createCacheService({ provider: resolved })
await service.healthcheck()

const workflow = await host.runWithCacheTenant('packed-tenant', async () => {
  await service.set('product:1', { name: 'Packed' }, { tags: ['products', 'product:1'] })
  await service.set('product:2', { name: 'Second' }, { tags: ['products'] })
  await service.set('order:1', { total: 10 }, { tags: ['orders'], ttl: 60_000 })
  const hit = await service.get('product:1')
  const keys = (await service.keys('product:*')).sort()
  const statsBefore = await service.stats()
  const invalidated = await service.deleteByTags(['products'])
  const afterInvalidation = await service.get('product:1')
  const remaining = await service.keys()
  const cleared = await service.clear()
  return { hit, keys, statsBefore, invalidated, afterInvalidation, remaining, cleared }
})
await service.close()
await service.close()

const client = createMemcachedClient({ transport: createTcpTransport({ host: SMOKE_HOST, port: Number(SMOKE_PORT) }) })
const version = await client.version()
await client.close()

process.stdout.write(`${JSON.stringify({
  id: resolved.id,
  placement: resolved.placement,
  namespace: resolved.namespace,
  redacted: resolved.definition.redact(resolved.config),
  providerEntry: import.meta.resolve('@open-mercato/cache-provider-memcached'),
  protocolEntry: import.meta.resolve('@open-mercato/cache-provider-memcached/protocol'),
  cacheEntry: import.meta.resolve('@open-mercato/cache/provider'),
  version,
  workflow,
})}\n`)
