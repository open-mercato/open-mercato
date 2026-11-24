import { defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import {
  MEMCACHED_PROVIDER_ID,
  MEMCACHED_SETTINGS_DEFAULTS,
  memcachedSettingsSchema,
  provider,
  redactMemcachedSettings,
  type MemcachedProviderConfig,
} from '../index'

function registration(settings: unknown) {
  return defineCacheProviderRegistration<MemcachedProviderConfig>({
    id: MEMCACHED_PROVIDER_ID,
    load: async () => provider,
    settings: () => settings,
  })
}

const env = { CACHE_PROVIDER: MEMCACHED_PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'unit-ns' }

describe('memcached settings schema', () => {
  it('applies documented defaults for the single-server profile', () => {
    const parsed = memcachedSettingsSchema.parse({ host: 'cache.internal' })
    expect(parsed).toEqual({ host: 'cache.internal', ...MEMCACHED_SETTINGS_DEFAULTS })
  })

  it('rejects unknown keys, including transport and auth options of unqualified profiles', () => {
    for (const extra of [{ tls: true }, { password: 'secret' }, { username: 'u' }, { servers: ['a:1'] }]) {
      const result = memcachedSettingsSchema.safeParse({ host: 'cache.internal', ...extra })
      expect(result.success).toBe(false)
    }
  })

  it('bounds item, bucket, retry, batching and timeout limits', () => {
    const invalid = [
      { bucketCount: 0 },
      { bucketCount: 4097 },
      { maxItemBytes: 1024 },
      { casRetries: 0 },
      { casRetries: 101 },
      { maxCommandBytes: 16 * 1024 + 1 },
      { enumerationBatchSize: 0 },
      { commandTimeoutMs: 10 },
      { port: 70000 },
    ]
    for (const override of invalid) {
      expect(memcachedSettingsSchema.safeParse({ host: 'h', ...override }).success).toBe(false)
    }
    expect(memcachedSettingsSchema.safeParse({ host: 'bad host' }).success).toBe(false)
  })

  it('resolves through a registration with shared placement', async () => {
    const resolved = await resolveCacheProvider([registration({ host: '127.0.0.1', port: 11212, bucketCount: 8 })], { env })
    expect(resolved).not.toBeNull()
    expect(resolved?.id).toBe(MEMCACHED_PROVIDER_ID)
    expect(resolved?.placement).toBe('shared')
    expect(resolved?.config).toMatchObject({ host: '127.0.0.1', port: 11212, bucketCount: 8 })
  })

  it('reports invalid settings with field paths and without echoing values', async () => {
    const promise = resolveCacheProvider([registration({ host: 'h', casRetries: -1, secretToken: 'do-not-leak' })], { env })
    await expect(promise).rejects.toMatchObject({
      code: 'invalid_settings',
      fieldPaths: expect.arrayContaining(['casRetries']),
    })
    await promise.catch((error: Error) => {
      expect(error.message).not.toContain('do-not-leak')
      expect(JSON.stringify(error)).not.toContain('do-not-leak')
    })
  })

  it('redacts to non-sensitive operational settings only', () => {
    const config = memcachedSettingsSchema.parse({ host: 'cache.internal', port: 11222 })
    const redacted = redactMemcachedSettings(config)
    expect(redacted).toEqual({
      host: 'cache.internal',
      port: 11222,
      transport: 'tcp',
      bucketCount: MEMCACHED_SETTINGS_DEFAULTS.bucketCount,
      maxItemBytes: MEMCACHED_SETTINGS_DEFAULTS.maxItemBytes,
      casRetries: MEMCACHED_SETTINGS_DEFAULTS.casRetries,
      poolSize: MEMCACHED_SETTINGS_DEFAULTS.poolSize,
      connectTimeoutMs: MEMCACHED_SETTINGS_DEFAULTS.connectTimeoutMs,
      commandTimeoutMs: MEMCACHED_SETTINGS_DEFAULTS.commandTimeoutMs,
    })
    expect(provider.redact?.(config)).toEqual(redacted)
  })

  it('declares the v1 provider contract', () => {
    expect(provider.apiVersion).toBe(1)
    expect(provider.id).toBe('open-mercato/memcached')
    expect(provider.capability(memcachedSettingsSchema.parse({ host: 'h' }))).toEqual({ placement: 'shared' })
  })
})
