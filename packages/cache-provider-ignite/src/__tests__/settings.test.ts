import { CacheProviderError, resolveCacheProvider } from '@open-mercato/cache/provider'
import {
  DEFAULT_CACHE_NAME_PREFIX,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_MAX_VALUE_BYTES,
  IGNITE_PROVIDER_ID,
  igniteCacheProviderSettingsSchema,
  provider,
  redactIgniteCacheProviderConfig,
} from '../index'
import { igniteRegistration } from './support/service'

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
const SECRET_PASSWORD = 's3cr3t-Pa55w0rd!'

describe('Ignite provider settings schema', () => {
  it('applies bounded defaults to a minimal endpoint list', () => {
    const parsed = igniteCacheProviderSettingsSchema.parse({ endpoints: ['ignite-1:10800'] })
    expect(parsed).toEqual({
      endpoints: ['ignite-1:10800'],
      cacheNamePrefix: DEFAULT_CACHE_NAME_PREFIX,
      createCache: true,
      connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
      commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
      scanPageSize: 256,
      scanTimeoutMs: 120_000,
      mutationConcurrency: 16,
      casAttempts: 8,
      maxValueBytes: DEFAULT_MAX_VALUE_BYTES,
    })
  })

  it('accepts authentication, TLS material and IPv6 endpoints', () => {
    const parsed = igniteCacheProviderSettingsSchema.parse({
      endpoints: ['10.0.0.1:10800', '[::1]:10801', 'ignite.internal:10802'],
      username: 'om',
      password: SECRET_PASSWORD,
      tls: { ca: PEM, cert: PEM, key: PEM.replace(/CERTIFICATE/g, 'PRIVATE KEY'), servername: 'ignite.internal' },
    })
    expect(parsed.tls?.rejectUnauthorized).toBe(true)
    expect(parsed.endpoints).toHaveLength(3)
  })

  it.each([
    [{}, ['endpoints']],
    [{ endpoints: [] }, ['endpoints']],
    [{ endpoints: ['no-port'] }, ['endpoints', 0]],
    [{ endpoints: ['host:70000'] }, ['endpoints', 0]],
    [{ endpoints: ['redis://host:10800'] }, ['endpoints', 0]],
    [{ endpoints: ['h:1'], username: 'only-user' }, ['password']],
    [{ endpoints: ['h:1'], tls: { cert: PEM } }, ['tls', 'cert']],
    [{ endpoints: ['h:1'], tls: { ca: 'not a pem' } }, ['tls', 'ca']],
    [{ endpoints: ['h:1'], tls: { enabled: true } }, ['tls']],
    [{ endpoints: ['h:1'], cacheNamePrefix: 'bad prefix' }, ['cacheNamePrefix']],
    [{ endpoints: ['h:1'], scanPageSize: 0 }, ['scanPageSize']],
    [{ endpoints: ['h:1'], scanTimeoutMs: 10 }, ['scanTimeoutMs']],
    [{ endpoints: ['h:1'], commandTimeoutMs: 1 }, ['commandTimeoutMs']],
    [{ endpoints: ['h:1'], maxValueBytes: 10 }, ['maxValueBytes']],
    [{ endpoints: ['h:1'], unknown: true }, []],
  ])('rejects %j', (input, path) => {
    const result = igniteCacheProviderSettingsSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toContainEqual(path)
  })

  it('surfaces invalid settings through the host with field paths and no secret values', async () => {
    const registration = igniteRegistration(() => ({ endpoints: ['bad'], password: SECRET_PASSWORD, extra: 1 }))
    const failure = await resolveCacheProvider([registration], {
      env: { CACHE_PROVIDER: IGNITE_PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'unit-ns' },
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CacheProviderError)
    expect(failure).toMatchObject({ code: 'invalid_settings', fieldPaths: expect.arrayContaining(['endpoints.0']) })
    expect(JSON.stringify(failure)).not.toContain(SECRET_PASSWORD)
    expect((failure as Error).message).not.toContain(SECRET_PASSWORD)
  })

  it('resolves through a registration with shared placement', async () => {
    const resolved = await resolveCacheProvider([igniteRegistration(() => ({ endpoints: ['127.0.0.1:10800'] }))], {
      env: { CACHE_PROVIDER: IGNITE_PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'unit-ns' },
    })
    expect(resolved).toMatchObject({ id: IGNITE_PROVIDER_ID, placement: 'shared', namespace: 'unit-ns' })
    expect(provider.apiVersion).toBe(1)
  })
})

describe('Ignite provider redaction', () => {
  it('never returns credentials or key material', () => {
    const config = igniteCacheProviderSettingsSchema.parse({
      endpoints: ['ignite:10800'],
      username: 'om-user',
      password: SECRET_PASSWORD,
      tls: { ca: PEM, cert: PEM, key: '-----BEGIN PRIVATE KEY-----\nSECRETKEY\n-----END PRIVATE KEY-----' },
    })
    const redacted = redactIgniteCacheProviderConfig(config)
    const serialized = JSON.stringify(redacted)
    expect(serialized).not.toContain(SECRET_PASSWORD)
    expect(serialized).not.toContain('om-user')
    expect(serialized).not.toContain('SECRETKEY')
    expect(serialized).not.toContain('BEGIN')
    expect(redacted).toMatchObject({ endpoints: ['ignite:10800'], authentication: 'configured', tls: { clientCertificate: 'configured' } })
    expect(provider.redact?.(config)).toEqual(redacted)
  })

  it('reports disabled TLS and no authentication plainly', () => {
    const redacted = redactIgniteCacheProviderConfig(igniteCacheProviderSettingsSchema.parse({ endpoints: ['ignite:10800'] }))
    expect(redacted).toMatchObject({ authentication: 'none', tls: 'disabled' })
  })
})
