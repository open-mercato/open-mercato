import { z } from 'zod'
import { createCacheProviderHostContext } from '@open-mercato/cache/provider'
import type { RespCacheProviderOptions, RespClientFactoryOptions, RespSettings } from '@open-mercato/cache-redis-protocol'
import type { ManagedAccessToken } from '../credentials'
import { createManagedRespProvider, managedHostSchema, managedTuningShape, toRespTls } from '../managed'

const captured: { options: RespClientFactoryOptions | null } = { options: null }

jest.mock('@open-mercato/cache-redis-protocol', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/cache-redis-protocol')>('@open-mercato/cache-redis-protocol')
  return {
    ...actual,
    createRespCacheProvider: (options: RespCacheProviderOptions<RespSettings>) => ({
      ...actual.createRespCacheProvider(options),
      create: async (config: RespSettings, context: Parameters<NonNullable<RespCacheProviderOptions<RespSettings>['clientOptions']>>[1]) => {
        captured.options = options.clientOptions ? options.clientOptions(config, context) : null
        return { get: async () => null }
      },
    }),
  }
})

const settings = z.object({ host: managedHostSchema, ...managedTuningShape }).strict()
type Fixture = z.infer<typeof settings>

const MINUTE = 60_000
const GATE = { OM_ENABLE_ENTERPRISE_MODULES: 'true', OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS: 'true' }

function providerWith(source: () => Promise<ManagedAccessToken>, plan: { refreshSkewMs: number; reauthIntervalMs: number }) {
  return createManagedRespProvider<Fixture>({
    id: 'open-mercato/aws-elasticache',
    settings,
    env: GATE,
    toRespSettings: (config) => ({
      mode: 'standalone',
      host: config.host,
      port: 6379,
      db: 0,
      tls: toRespTls(config.host, undefined),
      connectTimeoutMs: config.connectTimeoutMs,
      commandTimeoutMs: config.commandTimeoutMs,
      maxRetriesPerRequest: config.maxRetriesPerRequest,
      batchSize: config.batchSize,
      maxValueBytes: config.maxValueBytes,
    }),
    credentials: () => ({ source, sourceLabel: 'fake identity', ...plan }),
    redact: () => ({}),
  })
}

async function wire(provider: ReturnType<typeof providerWith>): Promise<{ credentials: () => Promise<{ password: string }>; nextDelay: () => number }> {
  captured.options = null
  await provider.create(settings.parse({ host: 'cache.example.internal' }), createCacheProviderHostContext({ id: provider.id, namespace: 'reauth' }))
  const options = captured.options as RespClientFactoryOptions | null
  if (!options?.credentialsProvider || typeof options.refreshIntervalMs !== 'function') throw new Error('[internal] managed provider did not wire a token-aware schedule')
  const schedule = options.refreshIntervalMs
  return { credentials: options.credentialsProvider, nextDelay: () => schedule() }
}

describe('managed re-AUTH schedule', () => {
  it('re-AUTHs by the time the token goes stale and never presents an expired token', async () => {
    let clock = 0
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      const issued: ManagedAccessToken[] = []
      const source = jest.fn(async () => {
        const token = { password: `token-${issued.length + 1}`, expiresAt: clock + 15 * MINUTE }
        issued.push(token)
        return token
      })
      const { credentials, nextDelay } = await wire(providerWith(source, { refreshSkewMs: 5 * MINUTE, reauthIntervalMs: 30 * MINUTE }))
      expect(source).toHaveBeenCalledTimes(0)
      await credentials()
      for (let round = 0; round < 6; round += 1) {
        const delay = nextDelay()
        expect(delay).toBeLessThanOrEqual(10 * MINUTE)
        clock += delay
        const presented = await credentials()
        const token = issued.find((candidate) => candidate.password === presented.password)!
        expect(token.expiresAt! - clock).toBeGreaterThanOrEqual(5 * MINUTE)
      }
      expect(source.mock.calls.length).toBeGreaterThanOrEqual(6)
    } finally {
      jest.restoreAllMocks()
    }
  })

  it('a token close to expiry is refreshed before the re-AUTH uses it', async () => {
    let clock = 0
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      let issued = 0
      const source = jest.fn(async () => {
        issued += 1
        return { password: `token-${issued}`, expiresAt: clock + (issued === 1 ? 6 * MINUTE : 60 * MINUTE) }
      })
      const { credentials, nextDelay } = await wire(providerWith(source, { refreshSkewMs: 5 * MINUTE, reauthIntervalMs: 10 * MINUTE }))
      expect((await credentials()).password).toBe('token-1')
      const delay = nextDelay()
      expect(delay).toBe(60_000)
      clock += delay
      expect((await credentials()).password).toBe('token-2')
      expect(nextDelay()).toBe(10 * MINUTE)
    } finally {
      jest.restoreAllMocks()
    }
  })
})
