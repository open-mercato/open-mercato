import { execFile } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import IgniteClient from 'apache-ignite-client'
import { inCacheTenant, randomNamespace, sleep, withConformanceNamespace } from '@open-mercato/cache/testing/conformance'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { igniteCacheName, IgniteCacheValueTooLargeError, type IgniteCacheProviderSettingsInput } from '../index'
import { buildConformanceChild } from './support/build-child'
import { containerTestsEnabled, IGNITE_THIN_CLIENT_PORT, startIgnite, type StartedIgnite } from './support/ignite-container'
import { createIgniteService, spawnIgniteChild } from './support/service'

const execFileAsync = promisify(execFile)
const describeContainer = containerTestsEnabled ? describe : describe.skip
const SECRET_PASSWORD = 'n0t-a-real-Secret!'

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('[internal] no port'))))
    })
  })
}

async function withRawClient<T>(endpoint: string, body: (client: IgniteClient) => Promise<T>): Promise<T> {
  const client = new IgniteClient()
  await client.connect(new IgniteClient.IgniteClientConfiguration(endpoint))
  try {
    return await body(client)
  } finally {
    client.disconnect()
  }
}

function stringCache(client: IgniteClient, name: string) {
  const stringType = IgniteClient.ObjectType.PRIMITIVE_TYPE.STRING
  return client.getCache(name).setKeyType(stringType).setValueType(stringType)
}

async function retry<T>(attempts: number, delayMs: number, body: () => Promise<T>): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await body()
    } catch (error) {
      lastError = error
      await sleep(delayMs)
    }
  }
  throw lastError
}

describeContainer('Apache Ignite 2.x engine behaviour (container)', () => {
  let ignite: StartedIgnite
  let childModule = ''
  const settings = (overrides: Partial<IgniteCacheProviderSettingsInput> = {}): IgniteCacheProviderSettingsInput => ({
    endpoints: [ignite.endpoint],
    scanPageSize: 64,
    connectTimeoutMs: 5_000,
    commandTimeoutMs: 5_000,
    ...overrides,
  })
  const open = (namespace: string, overrides: Partial<IgniteCacheProviderSettingsInput> = {}) =>
    createIgniteService(namespace, settings(overrides))

  beforeAll(async () => {
    ignite = await startIgnite()
    childModule = await buildConformanceChild()
  }, 240_000)

  afterAll(async () => {
    if (childModule) rmSync(childModule, { force: true })
    await ignite?.container.stop()
  }, 60_000)

  it('creates exactly one template-backed cache per namespace and never touches foreign caches', async () => {
    const namespace = randomNamespace('fence')
    const foreignCache = `foreign-app-${namespace}`
    await withRawClient(ignite.endpoint, async (client) => {
      await client.getOrCreateCache(foreignCache)
      await stringCache(client, foreignCache).put('tenant:x:key:k:abc', 'foreign-raw')
    })
    const service = await open(namespace)
    try {
      await inCacheTenant('fence-tenant', async () => {
        await service.set('a', 1, { tags: ['t'] })
        expect(await service.deleteByTags(['t'])).toBe(1)
        await service.set('b', 2, { ttl: 1 })
        await sleep(20)
        expect(await service.cleanup!()).toBe(1)
      })
      await service.clear()
      const names = await withRawClient(ignite.endpoint, (client) => client.cacheNames())
      expect(names).toContain(igniteCacheName('om-cache-', namespace))
      expect(names.filter((name) => name.endsWith(namespace))).toEqual(expect.arrayContaining([igniteCacheName('om-cache-', namespace), foreignCache]))
      const foreignValue = await withRawClient(ignite.endpoint, (client) => stringCache(client, foreignCache).get('tenant:x:key:k:abc'))
      expect(foreignValue).toBe('foreign-raw')
    } finally {
      await service.close!()
      await withRawClient(ignite.endpoint, (client) => client.destroyCache(foreignCache))
    }
  }, 60_000)

  it('keeps the healthcheck non-mutating', async () => {
    const namespace = randomNamespace('health')
    const service = await open(namespace)
    try {
      await service.healthcheck!()
      await service.healthcheck!()
      const size = await withRawClient(ignite.endpoint, (client) => stringCache(client, igniteCacheName('om-cache-', namespace)).getSize())
      expect(size).toBe(0)
    } finally {
      await service.close!()
    }
  }, 60_000)

  it('stores large values under the limit and refuses oversize values after dropping the previous copy', async () => {
    await withConformanceNamespace((namespace) => open(namespace, { maxValueBytes: 2 * 1024 * 1024 }), async (ctx) => {
      const service = await ctx.open()
      const tenant = ctx.tenant('size')
      await inCacheTenant(tenant, async () => {
        const large = 'ż'.repeat(400_000)
        await service.set('large', large, { tags: ['size'] })
        expect(await service.get('large')).toBe(large)
        await service.set('oversize', 'small')
        expect(await service.get('oversize')).toBe('small')
        const failure = await service.set('oversize', 'x'.repeat(3 * 1024 * 1024)).then(() => null, (error: unknown) => error)
        expect(failure).toMatchObject({ name: 'CacheProviderError', code: 'unavailable' })
        expect((failure as { originalError?: unknown }).originalError).toBeInstanceOf(IgniteCacheValueTooLargeError)
        expect(await service.get('oversize')).toBeNull()
        expect(await service.deleteByTags(['size'])).toBe(1)
      })
    })
  }, 60_000)

  it('never loses a retag racing an invalidation from another process', async () => {
    await withConformanceNamespace((namespace) => open(namespace), async (ctx) => {
      const local = await ctx.open()
      const remote = ctx.track(await spawnIgniteChild(childModule, ctx.namespace, settings()))
      const tenant = ctx.tenant('race')
      const keys = Array.from({ length: 24 }, (_, index) => `race:${index}`)
      for (let round = 0; round < 12; round++) {
        await inCacheTenant(tenant, () => Promise.all(keys.map((key) => local.set(key, { by: 'parent', round }, { tags: [`old-${round}`, 'shared'] }))))
        const remoteWrites = Promise.all(keys.map((key) => remote.run({ op: 'set', tenant, key, value: { by: 'child', round }, tags: [`new-${round}`] })))
        const invalidation = inCacheTenant(tenant, () => local.deleteByTags([`old-${round}`]))
        const [, invalidated] = await Promise.all([remoteWrites, invalidation])
        expect(invalidated).toBeLessThanOrEqual(keys.length)
        await inCacheTenant(tenant, async () => {
          for (const key of keys) expect(await local.get(key)).toEqual({ by: 'child', round })
          expect(await local.deleteByTags([`old-${round}`, 'shared'])).toBe(0)
          expect(await local.deleteByTags([`new-${round}`])).toBe(keys.length)
        })
      }
    })
  }, 180_000)

  it('runs concurrent tag churn from two independent processes without stale survivors', async () => {
    await withConformanceNamespace((namespace) => open(namespace), async (ctx) => {
      const local = await ctx.open()
      const first = ctx.track(await spawnIgniteChild(childModule, ctx.namespace, settings()))
      const second = ctx.track(await spawnIgniteChild(childModule, ctx.namespace, settings()))
      const tenant = ctx.tenant('churn')
      const keys = Array.from({ length: 16 }, (_, index) => `churn:${index}`)
      for (let round = 0; round < 10; round++) {
        await Promise.all([
          Promise.all(keys.map((key) => first.run({ op: 'set', tenant, key, value: round, tags: [`round-${round}`, 'first'] }))),
          Promise.all(keys.map((key) => second.run({ op: 'set', tenant, key, value: round, tags: [`round-${round}`, 'second'] }))),
          first.run({ op: 'deleteByTags', tenant, tags: [`round-${round - 1}`] }),
          inCacheTenant(tenant, () => local.deleteByTags([`round-${round - 1}`])),
        ])
        await inCacheTenant(tenant, async () => {
          expect(await local.deleteByTags([`round-${round - 1}`])).toBe(0)
          expect((await local.keys('churn:*')).sort()).toEqual([...keys].sort())
        })
      }
      await inCacheTenant(tenant, async () => {
        expect(await local.deleteByTags(['first', 'second'])).toBe(keys.length)
        expect(await local.keys()).toEqual([])
      })
    })
  }, 180_000)

  it('keeps credentials out of connection failures', async () => {
    const port = await freePort()
    const failure = await createIgniteService(randomNamespace('creds'), {
      endpoints: [`127.0.0.1:${port}`],
      username: 'om-user',
      password: SECRET_PASSWORD,
      connectTimeoutMs: 1_000,
    }).then((service) => service.get('x').finally(() => service.close!())).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).not.toContain(SECRET_PASSWORD)
    expect(JSON.stringify(failure)).not.toContain(SECRET_PASSWORD)
  }, 30_000)

  it('times out a stalled server within the command deadline and recovers after it resumes', async () => {
    const namespace = randomNamespace('stall')
    const service = await open(namespace, { commandTimeoutMs: 1_500, connectTimeoutMs: 1_500 })
    const containerId = ignite.container.getId()
    try {
      await inCacheTenant('stall', () => service.set('k', 'v'))
      await execFileAsync('docker', ['pause', containerId])
      const started = Date.now()
      const stalled = await inCacheTenant('stall', () => service.get('k')).catch((error: unknown) => error)
      const elapsed = Date.now() - started
      expect(stalled).toBeInstanceOf(Error)
      expect(stalled).toMatchObject({ code: 'timeout' })
      expect(elapsed).toBeLessThan(5_000)
      await execFileAsync('docker', ['unpause', containerId])
      const value = await retry(20, 500, () => inCacheTenant('stall', () => service.get('k')))
      expect(value).toBe('v')
    } finally {
      await execFileAsync('docker', ['unpause', containerId]).catch(() => undefined)
      await inCacheTenant('stall', () => service.clear()).catch(() => undefined)
      await service.close!()
    }
  }, 90_000)

  it('bounds a whole namespace scan by scanTimeoutMs on a stalled node', async () => {
    const namespace = randomNamespace('scanbudget')
    const service = await open(namespace, { commandTimeoutMs: 20_000, scanTimeoutMs: 1_500, scanPageSize: 16 })
    const containerId = ignite.container.getId()
    try {
      await inCacheTenant('scanbudget', () => Promise.all(Array.from({ length: 64 }, (_, index) => service.set(`k:${index}`, index, { tags: ['budget'] }))))
      await execFileAsync('docker', ['pause', containerId])
      const started = Date.now()
      const failure = await inCacheTenant('scanbudget', () => service.deleteByTags(['absent'])).catch((error: unknown) => error)
      const elapsed = Date.now() - started
      expect(failure).toMatchObject({ name: 'CacheProviderError', code: 'timeout' })
      expect(elapsed).toBeLessThan(5_000)
      await execFileAsync('docker', ['unpause', containerId])
      expect(await retry(20, 500, () => inCacheTenant('scanbudget', () => service.deleteByTags(['budget'])))).toBe(64)
    } finally {
      await execFileAsync('docker', ['unpause', containerId]).catch(() => undefined)
      await service.close!()
    }
  }, 90_000)
})

describeContainer('Apache Ignite 2.x restart and reconnect (container)', () => {
  let ignite: StartedIgnite | null = null

  afterAll(async () => {
    await ignite?.container.stop()
  }, 60_000)

  it('reconnects and recreates the namespace cache after a node restart', async () => {
    const hostPort = await freePort()
    const { GenericContainer, Wait } = await import('testcontainers')
    const { IGNITE_IMAGE, DOCKER_DIR } = await import('./support/ignite-container')
    const container = await new GenericContainer(IGNITE_IMAGE)
      .withExposedPorts({ container: IGNITE_THIN_CLIENT_PORT, host: hostPort })
      .withEnvironment({ JVM_OPTS: '-Xms256m -Xmx512m', CONFIG_URI: '/opt/om/ignite-config.xml' })
      .withCopyFilesToContainer([{ source: `${DOCKER_DIR}/ignite-config.xml`, target: '/opt/om/ignite-config.xml' }])
      .withWaitStrategy(Wait.forLogMessage(/Topology snapshot \[ver=1, .*state=ACTIVE/))
      .withStartupTimeout(180_000)
      .start()
    ignite = { container, host: '127.0.0.1', port: hostPort, endpoint: `127.0.0.1:${hostPort}` }
    const namespace = randomNamespace('restart')
    const service: CacheStrategy = await createIgniteService(namespace, {
      endpoints: [ignite.endpoint],
      connectTimeoutMs: 2_000,
      commandTimeoutMs: 2_000,
    })
    try {
      await inCacheTenant('restart', () => service.set('before', 'v1', { tags: ['r'] }))
      await container.restart()
      const outcomes: string[] = []
      const value = await retry(60, 1_000, async () => {
        try {
          return await inCacheTenant('restart', () => service.get('before'))
        } catch (error) {
          outcomes.push(error instanceof Error ? error.constructor.name : typeof error)
          throw error
        }
      })
      expect(value).toBeNull()
      await service.healthcheck!()
      await inCacheTenant('restart', async () => {
        await service.set('after', 'v2', { tags: ['r'] })
        expect(await service.get('after')).toBe('v2')
        expect(await service.deleteByTags(['r'])).toBe(1)
      })
      expect(outcomes.every((name) => name === 'CacheProviderError')).toBe(true)
    } finally {
      await service.close!()
    }
  }, 300_000)
})
