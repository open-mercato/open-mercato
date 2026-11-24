import {
  createGoogleIamTokenSource,
  GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID,
  provider,
  settings,
  toMemorystoreRespSettings,
} from '../index'
import { createCachedCredentialsProvider } from '@open-mercato/cache-provider-managed-kit'

const CA = '-----BEGIN CERTIFICATE-----\nSERVER-CA-MATERIAL\n-----END CERTIFICATE-----\n'
const base = {
  product: 'valkey',
  clusterMode: 'enabled',
  discoveryEndpoint: { host: '10.128.0.7' },
  auth: { kind: 'iam' },
  tls: { ca: CA },
} as const

describe('google memorystore settings', () => {
  it('accepts only Memorystore for Valkey, cluster mode enabled, IAM, TLS with server CA', () => {
    const parsed = settings.parse(base)
    expect(parsed).toMatchObject({ discoveryEndpoint: { port: 6379 }, auth: { credentials: 'application-default', reauthIntervalMs: 600000 }, maxRetriesPerRequest: 3 })
    expect(provider.id).toBe(GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID)
  })

  it.each([
    ['Valkey cluster mode disabled', { ...base, clusterMode: 'disabled' }],
    ['Memorystore for Redis', { ...base, product: 'redis' }],
    ['Memorystore for Redis Cluster', { ...base, product: 'redis-cluster' }],
    ['Redis AUTH string', { ...base, auth: { kind: 'auth-string', password: 'p' } }],
    ['service account key in settings', { ...base, auth: { kind: 'iam', keyFile: '/tmp/key.json' } }],
    ['TLS without server CA', { ...base, tls: {} }],
    ['TLS verification bypass', { ...base, tls: { ca: CA, rejectUnauthorized: false } }],
    ['explicit shard list', { ...base, nodes: [{ host: 'a' }] }],
    ['unknown key', { ...base, db: 0 }],
  ])('rejects %s', (_label, input) => {
    expect(settings.safeParse(input).success).toBe(false)
  })

  it('maps the discovery endpoint to a cluster seed with CA verification on every shard connection', () => {
    const resp = toMemorystoreRespSettings(settings.parse({ ...base, tls: { ca: CA, servername: 'memorystore.internal' } }))
    expect(resp).toMatchObject({ mode: 'cluster', nodes: [{ host: '10.128.0.7', port: 6379 }], tls: { ca: CA, servername: 'memorystore.internal', rejectUnauthorized: true } })
    expect(toMemorystoreRespSettings(settings.parse(base)).tls).toEqual({ ca: CA, rejectUnauthorized: true })
  })

  it('redacts CA material', () => {
    const redacted = JSON.stringify(provider.redact?.(settings.parse(base)))
    expect(redacted).not.toContain('SERVER-CA-MATERIAL')
    expect(redacted).toContain('10.128.0.7:6379')
    expect(redacted).toContain('"ca":"configured"')
  })
})

describe('Google IAM token source', () => {
  it('uses the access token as a password-only AUTH credential and accepts both client result shapes', async () => {
    const clock = 5_000_000
    await expect(createGoogleIamTokenSource({ getAccessToken: async () => 'ya29.token-a' }, () => clock)()).resolves.toEqual({ password: 'ya29.token-a', expiresAt: clock + 15 * 60_000 })
    await expect(createGoogleIamTokenSource({ getAccessToken: async () => ({ token: 'ya29.token-b' }) })()).resolves.toMatchObject({ password: 'ya29.token-b' })
    await expect(createGoogleIamTokenSource({ getAccessToken: async () => ({ token: null }) })()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('refreshes through the cache once the assumed lifetime approaches expiry', async () => {
    let clock = 0
    let issued = 0
    const source = createGoogleIamTokenSource({ getAccessToken: async () => `ya29.token-${++issued}` }, () => clock)
    const cached = createCachedCredentialsProvider(source, { providerId: provider.id, sourceLabel: 'ADC', refreshSkewMs: 5 * 60_000, now: () => clock })
    expect(await cached()).toEqual({ password: 'ya29.token-1' })
    clock += 9 * 60_000
    expect((await cached()).password).toBe('ya29.token-1')
    clock += 2 * 60_000
    expect((await cached()).password).toBe('ya29.token-2')
  })
})

const sdk = { loads: 0 }
jest.mock('google-auth-library', () => {
  sdk.loads += 1
  return { GoogleAuth: class { async getAccessToken() { return 'ya29.fake' } } }
})

describe('cloud SDK loading order', () => {
  it('never imports google-auth-library while the gate is closed', async () => {
    await expect(Promise.resolve().then(() => provider.create(settings.parse(base), {} as never))).rejects.toMatchObject({ code: 'unavailable' })
    expect(sdk.loads).toBe(0)
  })
})
