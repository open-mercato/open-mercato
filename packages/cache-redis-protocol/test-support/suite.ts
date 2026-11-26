import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Redis } from 'ioredis'
import {
  createCacheProviderHostContext,
  defineCacheProviderRegistration,
  resolveCacheProvider,
} from '@open-mercato/cache/provider'
import type { CacheProviderDefinition, CacheProviderLogger, ResolvedCacheProvider } from '@open-mercato/cache/provider'
import { createCacheService, resolvePhysicalCacheValueKey } from '@open-mercato/cache/service'
import { defineCacheProviderConformance, inCacheTenant, randomNamespace, sleep } from '@open-mercato/cache/testing/conformance'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { createIoredisClientFactory } from '../src/client'
import { buildRespKeyLayout } from '../src/layout'
import { createRespCacheStrategy } from '../src/strategy'
import { DELETE_IF_UNCHANGED } from '../src/scripts'
import type { RespStandaloneSettings } from '../src/settings'
import { APP_PASSWORD, APP_USER, describeContainers, startRespEngine } from './engine'
import type { RespEngineSpec, StartedRespEngine } from './engine'
import { buildConformanceHost, spawnRespRemote } from './host'
import { CACHE_HOST_WORKSPACES } from '../../cache/fixtures/packed-workspaces'
import { createPackedInstall, packedSmokeScript } from './packed'
import type { PackedInstall } from './packed'
import { runRespQualification } from './qualify'

export type RespProviderSuiteOptions = {
  label: string
  provider: CacheProviderDefinition<RespStandaloneSettings>
  providerEntry: string
  packageName: string
  packageDirName: string
  engine: RespEngineSpec
  /** Small batch so SCAN/SSCAN/script batching crosses page boundaries in conformance. */
  batchSize?: number
  extraTests?: (context: () => RespSuiteContext) => void
}

export type RespSuiteContext = {
  engine: StartedRespEngine
  admin: Redis
  hostModule: string
  resolve(namespace: string, settings?: RespStandaloneSettings): Promise<ResolvedCacheProvider<RespStandaloneSettings>>
  openStrategy(namespace: string, settings?: RespStandaloneSettings, logger?: CacheProviderLogger): Promise<CacheStrategy>
}

const SUITE_TIMEOUT_MS = 600_000

function collectingLogger(): CacheProviderLogger & { messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    warn(message) {
      messages.push(message)
    },
    error(message) {
      messages.push(message)
    },
  }
}

async function dropNamespace(admin: Redis, namespace: string): Promise<void> {
  const layout = buildRespKeyLayout(namespace)
  let cursor = '0'
  do {
    const [next, keys] = await admin.scan(cursor, 'MATCH', `om:{${layout.namespace}}:*`, 'COUNT', 500)
    cursor = next
    if (keys.length > 0) await admin.unlink(...keys)
  } while (cursor !== '0')
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as { originalError?: unknown; cause?: unknown }).originalError ?? (error as { cause?: unknown }).cause
  return `${error.name} ${error.message} ${JSON.stringify(error)} ${cause instanceof Error ? `${cause.message} ${cause.stack ?? ''}` : ''}`
}

async function eventually<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      await sleep(200)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('[internal] operation did not succeed in time')
}

/**
 * Real-engine qualification for one RESP provider package: the shared v1
 * conformance kit (with an independent process), engine-specific checks,
 * packed installation and a latency/command-count qualification.
 */
export function defineRespProviderContainerSuite(options: RespProviderSuiteOptions): void {
  const providerId = options.provider.id
  let engine: StartedRespEngine | null = null
  let admin: Redis | null = null
  let hostModule = ''
  const batchSize = options.batchSize ?? 64

  const settingsFor = (overrides: Partial<RespStandaloneSettings> = {}) => {
    if (!engine) throw new Error('[internal] engine not started')
    return engine.appSettings({ batchSize, ...overrides })
  }

  const resolve = async (namespace: string, settings: RespStandaloneSettings = settingsFor()) => {
    const registration = defineCacheProviderRegistration<RespStandaloneSettings>({
      id: providerId,
      load: async () => options.provider,
      settings: () => settings,
    })
    const resolved = await resolveCacheProvider([registration], {
      env: { CACHE_PROVIDER: providerId, CACHE_PROVIDER_NAMESPACE: namespace },
    })
    if (!resolved) throw new Error('[internal] provider was not selected')
    return resolved as ResolvedCacheProvider<RespStandaloneSettings>
  }

  const openStrategy = async (namespace: string, settings?: RespStandaloneSettings, logger?: CacheProviderLogger) => {
    const resolved = await resolve(namespace, settings)
    const context = createCacheProviderHostContext(resolved)
    return resolved.definition.create(resolved.config, logger ? { ...context, logger } : context)
  }

  const context = (): RespSuiteContext => {
    if (!engine || !admin) throw new Error('[internal] engine not started')
    return { engine, admin, hostModule, resolve, openStrategy }
  }

  describeContainers(`${options.label} (real engine)`, () => {
    jest.setTimeout(180_000)

    beforeAll(async () => {
      engine = await startRespEngine(options.engine)
      admin = engine.admin()
      hostModule = await buildConformanceHost(options.packageDirName, options.providerEntry)
    }, SUITE_TIMEOUT_MS)

    afterAll(async () => {
      admin?.disconnect()
      await engine?.stop()
    }, SUITE_TIMEOUT_MS)

    defineCacheProviderConformance({
      name: options.label,
      createService: async (namespace, serviceOptions) => createCacheService({
        provider: await resolve(namespace),
        ...(serviceOptions?.defaultTtl !== undefined ? { defaultTtl: serviceOptions.defaultTtl } : {}),
      }),
      createIndependentProcess: (namespace) => spawnRespRemote({ hostModule, providerId, namespace, settings: settingsFor() }),
      corrupt: async ({ namespace, physicalKey }) => {
        await context().admin.set(buildRespKeyLayout(namespace).valueKey(physicalKey), '{"v":1,"value":')
      },
      supportsReturnExpired: false,
    })

    describe('engine-specific behaviour', () => {
      it('stores entries under the hash-tagged layout with native TTL on values and tag sets', async () => {
        const namespace = randomNamespace('layout')
        const service = createCacheService({ provider: await resolve(namespace) })
        try {
          await service.set('k', { a: 1 }, { tags: ['t'], ttl: 60_000 })
          const layout = buildRespKeyLayout(namespace)
          const [, keys] = await context().admin.scan('0', 'MATCH', `om:{${namespace}}:*`, 'COUNT', 1000)
          expect(keys.length).toBeGreaterThanOrEqual(4)
          for (const key of keys) expect(key.startsWith(layout.prefix)).toBe(true)
          const valueKey = layout.valueKey(resolvePhysicalCacheValueKey('k', null))
          const pttl = await context().admin.pttl(valueKey)
          expect(pttl).toBeGreaterThan(0)
          expect(pttl).toBeLessThanOrEqual(60_000)
          const stored = JSON.parse(String(await context().admin.get(valueKey)))
          expect(stored).toMatchObject({ v: 1, value: { a: 1 } })
          expect(stored.tags).toHaveLength(2)
          for (const tag of stored.tags) {
            expect(await context().admin.sismember(layout.tagKey(tag), resolvePhysicalCacheValueKey('k', null))).toBe(1)
            const tagTtl = await context().admin.pttl(layout.tagKey(tag))
            expect(tagTtl).toBeGreaterThanOrEqual(pttl - 1_000)
            expect(tagTtl).toBeLessThanOrEqual(60_000)
          }
        } finally {
          await service.clear()
          await service.close?.()
          await dropNamespace(context().admin, namespace)
        }
      })

      it('keeps a tag set alive as long as its longest-lived member and persistent for members without TTL', async () => {
        const namespace = randomNamespace('tagttl')
        const layout = buildRespKeyLayout(namespace)
        const tagKey = layout.tagKey('shared')
        const strategy = await openStrategy(namespace)
        try {
          await strategy.set('long', 1, { tags: ['shared'], ttl: 60_000 })
          await strategy.set('short', 2, { tags: ['shared'], ttl: 5_000 })
          expect(await context().admin.pttl(tagKey)).toBeGreaterThan(50_000)
          await strategy.set('long', 1, { tags: ['shared'], ttl: 120_000 })
          expect(await context().admin.pttl(tagKey)).toBeGreaterThan(110_000)
          await strategy.set('forever', 3, { tags: ['shared'] })
          expect(await context().admin.pttl(tagKey)).toBe(-1)
          await strategy.set('later', 4, { tags: ['shared'], ttl: 5_000 })
          expect(await context().admin.pttl(tagKey)).toBe(-1)
          expect(await strategy.deleteByTags(['shared'])).toBe(4)
          expect(await context().admin.exists(tagKey)).toBe(0)

          await strategy.set('brief', 5, { tags: ['brief'], ttl: 150 })
          await sleep(500)
          expect(await context().admin.exists(layout.tagKey('brief'))).toBe(0)
        } finally {
          await strategy.clear()
          await strategy.close?.()
        }
      })

      it('stays inside its namespace and ACL key fence', async () => {
        const namespace = randomNamespace('fence')
        const foreign = randomNamespace('fence-foreign')
        const { admin: adminClient } = context()
        await adminClient.set('foreign:key', 'keep')
        await adminClient.set(buildRespKeyLayout(foreign).valueKey('x'), 'keep')
        const strategy = await openStrategy(namespace)
        try {
          await strategy.set('mine', 1, { tags: ['t'] })
          expect(await strategy.clear()).toBe(1)
          expect(await adminClient.get('foreign:key')).toBe('keep')
          expect(await adminClient.get(buildRespKeyLayout(foreign).valueKey('x'))).toBe('keep')
          const restricted = context().engine.admin()
          try {
            await restricted.auth(APP_USER, APP_PASSWORD)
            await expect(restricted.get('foreign:key')).rejects.toThrow(/NOPERM/)
            await expect(restricted.flushall()).rejects.toThrow(/NOPERM/)
          } finally {
            restricted.disconnect()
          }
        } finally {
          await strategy.close?.()
          await adminClient.del('foreign:key', buildRespKeyLayout(foreign).valueKey('x'))
        }
      })

      it('rejects wrong credentials without leaking them', async () => {
        const secret = 'wrong-password-9f3e1d'
        const failure = await openStrategy(randomNamespace('auth'), settingsFor({ password: secret, connectTimeoutMs: 3_000 }))
          .then(async (strategy) => {
            await strategy.close?.()
            return null
          }, (error: unknown) => error)
        expect(failure).toBeInstanceOf(Error)
        expect(errorText(failure)).not.toContain(secret)
        const redacted = JSON.stringify(options.provider.redact?.(settingsFor({ password: secret })))
        expect(redacted).not.toContain(secret)
        expect(redacted).not.toContain(APP_PASSWORD)
      })

      if (options.engine.tls) {
        it('requires TLS and verifies the server certificate', async () => {
          const plain = settingsFor({ connectTimeoutMs: 2_000 })
          delete plain.tls
          await expect(openStrategy(randomNamespace('tls'), plain)).rejects.toBeInstanceOf(Error)
          const wrongCa = settingsFor({ connectTimeoutMs: 2_000, tls: { ca: context().engine.tls!.otherCa, servername: 'localhost', rejectUnauthorized: true } })
          await expect(openStrategy(randomNamespace('tls'), wrongCa)).rejects.toBeInstanceOf(Error)
        })
      }

      it('healthcheck does not mutate the keyspace', async () => {
        const strategy = await openStrategy(randomNamespace('health'))
        try {
          const before = await context().admin.dbsize()
          for (let attempt = 0; attempt < 3; attempt += 1) await strategy.healthcheck?.()
          expect(await context().admin.dbsize()).toBe(before)
        } finally {
          await strategy.close?.()
        }
      })

      it('cleanup reaps tag members of natively expired entries', async () => {
        const namespace = randomNamespace('reap')
        const layout = buildRespKeyLayout(namespace)
        const strategy = await openStrategy(namespace)
        try {
          await strategy.set('short', 1, { ttl: 100, tags: ['x'] })
          await strategy.set('long', 2, { tags: ['x'] })
          await sleep(400)
          expect(await context().admin.scard(layout.tagKey('x'))).toBe(2)
          expect(await strategy.get('short')).toBeNull()
          await strategy.cleanup?.()
          expect(await context().admin.smembers(layout.tagKey('x'))).toEqual(['long'])
          expect(await strategy.deleteByTags(['x'])).toBe(1)
          expect(await context().admin.exists(layout.tagKey('x'))).toBe(0)
        } finally {
          await strategy.clear()
          await strategy.close?.()
        }
      })

      it('skips oversize writes and removes the previous value', async () => {
        const logger = collectingLogger()
        const strategy = await openStrategy(randomNamespace('oversize'), settingsFor({ maxValueBytes: 1024 }), logger)
        try {
          await strategy.set('big', 'small', { tags: ['o'] })
          expect(await strategy.get('big')).toBe('small')
          await strategy.set('big', 'x'.repeat(4096), { tags: ['o'] })
          expect(await strategy.get('big')).toBeNull()
          expect(logger.messages.some((message) => message.includes('maxValueBytes'))).toBe(true)
        } finally {
          await strategy.clear()
          await strategy.close?.()
        }
      })

      it('runs scripts through EVALSHA and recovers after SCRIPT FLUSH', async () => {
        const strategy = await openStrategy(randomNamespace('script'))
        const { admin: adminClient } = context()
        try {
          await adminClient.script('FLUSH')
          await adminClient.call('CONFIG', 'RESETSTAT')
          await strategy.set('a', 1, { tags: ['s'] })
          expect(await strategy.deleteByTags(['s'])).toBe(1)
          expect(await adminClient.script('EXISTS', DELETE_IF_UNCHANGED.sha)).toEqual([1])
          await strategy.set('b', 1, { tags: ['s'] })
          expect(await strategy.deleteByTags(['s'])).toBe(1)
          const stats = String(await adminClient.call('INFO', 'commandstats'))
          const calls = (command: string) => Number(new RegExp(`cmdstat_${command}:calls=(\\d+)`).exec(stats)?.[1] ?? 0)
          expect(calls('evalsha')).toBeGreaterThanOrEqual(2)
          expect(calls('eval')).toBeGreaterThanOrEqual(1)
        } finally {
          await strategy.clear()
          await strategy.close?.()
        }
      })

      it('keeps retagged entries and their new membership under concurrent invalidation from two processes', async () => {
        const namespace = randomNamespace('race')
        const local = createCacheService({ provider: await resolve(namespace) })
        const remote = await spawnRespRemote({ hostModule, providerId, namespace, settings: settingsFor() })
        const tenant = 'race-tenant'
        let survived = 0
        let invalidated = 0
        let invalidatedBeforeRetag = 0
        try {
          for (let round = 0; round < 30; round += 1) {
            const keys = Array.from({ length: 10 }, (_, index) => `race:${round}:${index}`)
            await inCacheTenant(tenant, () => Promise.all(keys.map((key) => local.set(key, 'v0', { tags: ['old'] }))))
            await Promise.all([
              ...keys.map(async (key) => {
                await sleep(Math.random() * 6)
                await remote.run({ op: 'set', tenant, key, value: 'v1', tags: ['new'] })
              }),
              (async () => {
                await sleep(Math.random() * 6)
                invalidatedBeforeRetag += await inCacheTenant(tenant, () => local.deleteByTags(['old']))
              })(),
            ])
            await inCacheTenant(tenant, async () => {
              for (const key of keys) {
                const value = await local.get(key)
                expect(value === null || value === 'v1').toBe(true)
                if (value === 'v1') survived += 1
                else invalidated += 1
              }
              await local.deleteByTags(['new'])
              for (const key of keys) expect(await local.get(key)).toBeNull()
              expect(await local.deleteByTags(['old'])).toBe(0)
            })
          }
          expect(survived + invalidated).toBe(300)
          process.stdout.write(`\n[race] ${options.label}: ${invalidatedBeforeRetag} of 300 v0 entries invalidated before the retag landed, ${300 - invalidatedBeforeRetag} retagged first; final values v1=${survived}, missing=${invalidated}\n`)
        } finally {
          await remote.close()
          await inCacheTenant(tenant, () => local.clear())
          await local.close?.()
          await dropNamespace(context().admin, namespace)
        }
      })

      it('compare-and-delete keeps an entry retagged between the invalidation read and its delete', async () => {
        const namespace = randomNamespace('cad')
        const resolved = await resolve(namespace)
        const helpers = createCacheProviderHostContext(resolved).helpers
        const managed = await createIoredisClientFactory(resolved.config)()
        const realMget = managed.client.mgetBuffer.bind(managed.client)
        let afterRead: (() => Promise<void>) | null = null
        const interceptedMget = async (...keys: string[]) => {
          const values = await realMget(...keys)
          const hook = afterRead
          afterRead = null
          if (hook) await hook()
          return values
        }
        Object.assign(managed.client, { mgetBuffer: interceptedMget })
        const invalidator = await createRespCacheStrategy(() => managed, { namespace, helpers, batchSize: 16 })
        const writer = await openStrategy(namespace)
        try {
          await invalidator.set('k', 'v0', { tags: ['old'] })
          afterRead = () => writer.set('k', 'v1', { tags: ['new', 'old2'] })
          expect(await invalidator.deleteByTags(['old'])).toBe(0)
          expect(await writer.get('k')).toBe('v1')
          expect(await writer.deleteByTags(['new'])).toBe(1)

          await invalidator.set('s', 'v0', { tags: ['t'] })
          await writer.set('s', 'v1', { tags: ['u'] })
          afterRead = () => writer.set('s', 'v2', { tags: ['t'] })
          expect(await invalidator.deleteByTags(['t'])).toBe(0)
          expect(await writer.get('s')).toBe('v2')
          expect(await invalidator.deleteByTags(['t'])).toBe(1)
          expect(await writer.get('s')).toBeNull()
        } finally {
          await invalidator.clear()
          await invalidator.close()
          await writer.close?.()
        }
      })

      it('reconnects after the server drops its connections', async () => {
        const strategy = await openStrategy(randomNamespace('reconnect'))
        try {
          await strategy.set('k', 'v')
          await context().admin.call('CLIENT', 'KILL', 'USER', APP_USER)
          const value = await eventually(() => strategy.get('k'), 15_000)
          expect(value).toBe('v')
        } finally {
          await strategy.clear().catch(() => undefined)
          await strategy.close?.()
        }
      })

      options.extraTests?.(context)
    })

    describe('packed installation', () => {
      let packed: PackedInstall | null = null

      beforeAll(() => {
        packed = createPackedInstall(options.packageDirName)
      }, SUITE_TIMEOUT_MS)

      afterAll(() => packed?.dispose())

      it('installs the provider without sibling adapters', () => {
        expect(packed!.installedScopePackages).toEqual([...CACHE_HOST_WORKSPACES, 'cache-redis-protocol', options.packageDirName].sort())
      })

      it('type-checks an app registration against the installed types', () => {
        packed!.typecheck(`import { defineCacheProviderRegistration } from '@open-mercato/cache/provider'

export const cacheProviders = [
  defineCacheProviderRegistration({
    id: '${providerId}',
    load: () => import('${options.packageName}').then((module) => module.provider),
    settings: () => ({
      host: process.env.CACHE_HOST ?? 'localhost',
      username: process.env.CACHE_USERNAME,
      password: process.env.CACHE_PASSWORD,
      tls: { ca: process.env.CACHE_TLS_CA },
    }),
  }),
]
`)
      })

      it('resolves through a registration and serves a cache workflow', () => {
        const namespace = randomNamespace('packed')
        const output = packed!.run(packedSmokeScript(options.packageName), {
          CACHE_PROVIDER: providerId,
          CACHE_PROVIDER_NAMESPACE: namespace,
          SMOKE_SETTINGS: JSON.stringify(settingsFor()),
          SMOKE_HOST: hostModule,
        })
        const result = JSON.parse(output)
        expect(result).toMatchObject({
          id: providerId,
          placement: 'shared',
          direct: { get: { ok: 1 }, keys: ['smoke:a', 'smoke:b'], invalidated: 1, afterInvalidate: null, cleared: 1 },
          service: { get: { via: 'service' }, keys: ['tenant-key'], invalidated: 1, afterInvalidate: null },
        })
        expect(output).not.toContain(APP_PASSWORD)
      })
    })

    describe('performance qualification', () => {
      it('records latency and command counts under tag churn with two clients', async () => {
        const namespace = randomNamespace('qualify')
        const result = await runRespQualification({
          open: async () => createCacheService({ provider: await resolve(namespace, settingsFor({ batchSize: 500 })) }),
          admin: context().admin,
        })
        const file = path.join(os.tmpdir(), `om-resp-qualification-${options.packageDirName}.json`)
        writeFileSync(file, JSON.stringify({ label: options.label, image: options.engine.image, date: new Date().toISOString(), result }, null, 2))
        process.stdout.write(`\n[qualification] ${options.label}: ${JSON.stringify(result)}\n`)
        expect(result.errors).toBe(0)
        await dropNamespace(context().admin, namespace)
      }, SUITE_TIMEOUT_MS)
    })

    describe('server restart', () => {
      it('recovers the same service after the engine restarts (cache emptied)', async () => {
        const namespace = randomNamespace('restart')
        const service = createCacheService({ provider: await resolve(namespace) })
        try {
          await service.set('before', 'v', { tags: ['r'] })
          admin?.disconnect()
          await context().engine.restart()
          admin = context().engine.admin()
          await eventually(async () => {
            await service.set('after', 'w', { tags: ['r'] })
          }, 30_000)
          expect(await service.get('before')).toBeNull()
          expect(await service.get('after')).toBe('w')
          expect(await service.deleteByTags(['r'])).toBe(1)
        } finally {
          await service.clear().catch(() => undefined)
          await service.close?.()
        }
      }, SUITE_TIMEOUT_MS)
    })
  })
}
