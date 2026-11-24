import {
  AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID,
  AZURE_REDIS_ENTRA_SCOPE,
  createEntraTokenSource,
  decodeJwtObjectId,
  provider,
  settings,
  toAzureRespSettings,
} from '../index'
import { createCachedCredentialsProvider } from '../credentials'

const OBJECT_ID = '11111111-2222-3333-4444-555555555555'
const base = { clusteringPolicy: 'non-clustered', host: 'om.westeurope.redis.azure.net', auth: { kind: 'entra' } } as const

function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.signature-part`
}

describe('azure managed redis settings', () => {
  it('accepts only the Non-clustered + Entra + TLS profile with defaults', () => {
    const parsed = settings.parse(base)
    expect(parsed).toMatchObject({ clusteringPolicy: 'non-clustered', port: 10000, auth: { kind: 'entra', identity: 'default', reauthIntervalMs: 600000 }, tls: {} })
    expect(provider.id).toBe(AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID)
    expect(provider.apiVersion).toBe(1)
  })

  it.each([
    ['OSS clustering policy', { ...base, clusteringPolicy: 'oss-cluster' }],
    ['Enterprise proxy policy', { ...base, clusteringPolicy: 'enterprise' }],
    ['access-key auth', { ...base, auth: { kind: 'access-key', key: 'k' } }],
    ['password in settings', { ...base, password: 'p' }],
    ['TLS verification bypass', { ...base, tls: { rejectUnauthorized: false } }],
    ['TLS disabled', { ...base, tls: false }],
    ['client certificate key', { ...base, tls: { key: 'KEY' } }],
    ['unknown identity source', { ...base, auth: { kind: 'entra', identity: 'client-secret' } }],
    ['malformed object id', { ...base, auth: { kind: 'entra', objectId: 'not-a-guid' } }],
    ['re-auth interval too short', { ...base, auth: { kind: 'entra', reauthIntervalMs: 1000 } }],
    ['re-auth interval too long', { ...base, auth: { kind: 'entra', reauthIntervalMs: 3_600_000 } }],
    ['unknown key', { ...base, db: 1 }],
    ['missing host', { clusteringPolicy: 'non-clustered', auth: { kind: 'entra' } }],
  ])('rejects %s', (_label, input) => {
    expect(settings.safeParse(input).success).toBe(false)
  })

  it('maps to a standalone RESP endpoint with mandatory hostname verification and no static secret', () => {
    const resp = toAzureRespSettings(settings.parse({ ...base, tls: { ca: 'CA-PEM' } }))
    expect(resp).toMatchObject({ mode: 'standalone', host: base.host, port: 10000, db: 0, tls: { ca: 'CA-PEM', servername: base.host, rejectUnauthorized: true } })
    expect(resp.username).toBeUndefined()
    expect(resp.password).toBeUndefined()
    const custom = toAzureRespSettings(settings.parse({ ...base, host: '10.0.0.4', tls: { servername: 'om.privatelink.redis.azure.net' } }))
    expect(custom.tls).toEqual({ servername: 'om.privatelink.redis.azure.net', rejectUnauthorized: true })
  })

  it('redacts identity identifiers and CA material', () => {
    const redacted = JSON.stringify(provider.redact?.(settings.parse({
      ...base,
      auth: { kind: 'entra', identity: 'managed-identity', clientId: OBJECT_ID, objectId: OBJECT_ID },
      tls: { ca: 'CA-PEM-MATERIAL' },
    })))
    expect(redacted).not.toContain(OBJECT_ID)
    expect(redacted).not.toContain('CA-PEM-MATERIAL')
    expect(redacted).toContain(base.host)
    expect(redacted).toContain('"hostnameVerification":true')
  })
})

describe('Microsoft Entra token source', () => {
  it('requests the Redis scope and uses the token oid claim as username', async () => {
    const token = fakeJwt({ oid: OBJECT_ID })
    const getToken = jest.fn(async () => ({ token, expiresOnTimestamp: 1_700_000_000_000 }))
    const source = createEntraTokenSource({ getToken }, settings.parse(base).auth)
    await expect(source()).resolves.toEqual({ username: OBJECT_ID, password: token, expiresAt: 1_700_000_000_000 })
    expect(getToken).toHaveBeenCalledWith(AZURE_REDIS_ENTRA_SCOPE)
  })

  it('prefers the configured object id and fails safely without one', async () => {
    const configured = createEntraTokenSource({ getToken: async () => ({ token: 'opaque', expiresOnTimestamp: 1 }) }, settings.parse({ ...base, auth: { kind: 'entra', objectId: OBJECT_ID } }).auth)
    await expect(configured()).resolves.toMatchObject({ username: OBJECT_ID, password: 'opaque' })
    const missing = createEntraTokenSource({ getToken: async () => ({ token: 'opaque-secret', expiresOnTimestamp: 1 }) }, settings.parse(base).auth)
    const failure = await missing().catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'invalid_settings', fieldPaths: ['auth.objectId'] })
    expect(JSON.stringify(failure)).not.toContain('opaque-secret')
    const empty = createEntraTokenSource({ getToken: async () => null }, settings.parse(base).auth)
    await expect(empty()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('decodes oid only from well-formed payloads', () => {
    expect(decodeJwtObjectId(fakeJwt({ oid: OBJECT_ID }))).toBe(OBJECT_ID)
    expect(decodeJwtObjectId('no-dots')).toBeNull()
    expect(decodeJwtObjectId('a.%%%.c')).toBeNull()
    expect(decodeJwtObjectId(fakeJwt({ sub: 'x' }))).toBeNull()
  })
})

describe('cached credential refresh scheduling', () => {
  it('reuses a token until expiry minus skew, single-flights concurrent fetches and refetches after', async () => {
    let clock = 1_000_000
    let issued = 0
    const source = jest.fn(async () => {
      issued += 1
      return { username: OBJECT_ID, password: `token-${issued}`, expiresAt: clock + 60 * 60_000 }
    })
    const credentials = createCachedCredentialsProvider(source, { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 5 * 60_000, now: () => clock })
    const [first, second] = await Promise.all([credentials(), credentials()])
    expect(first).toEqual({ username: OBJECT_ID, password: 'token-1' })
    expect(second).toEqual(first)
    expect(source).toHaveBeenCalledTimes(1)
    clock += 54 * 60_000
    expect((await credentials()).password).toBe('token-1')
    clock += 2 * 60_000
    expect((await credentials()).password).toBe('token-2')
    credentials.invalidate()
    expect((await credentials()).password).toBe('token-3')
  })

  it('wraps identity failures in a sanitized unavailable error', async () => {
    const credentials = createCachedCredentialsProvider(async () => {
      throw new Error('AADSTS700016 client secret abc123-secret rejected')
    }, { providerId: provider.id, sourceLabel: 'Microsoft Entra (default)', refreshSkewMs: 0 })
    const failure = await credentials().catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'unavailable', providerId: provider.id })
    expect(`${(failure as Error).message} ${JSON.stringify(failure)}`).not.toContain('abc123-secret')
    expect((failure as Error).message).toContain('Microsoft Entra (default)')
  })

  it('never caches a token without expiry', async () => {
    let issued = 0
    const credentials = createCachedCredentialsProvider(async () => ({ password: `p-${++issued}`, expiresAt: null }), { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 0 })
    expect((await credentials()).password).toBe('p-1')
    expect((await credentials()).password).toBe('p-2')
    await expect(createCachedCredentialsProvider(async () => ({ password: '', expiresAt: null }), { providerId: provider.id, sourceLabel: 'test', refreshSkewMs: 0 })()).rejects.toMatchObject({ code: 'unavailable' })
  })
})

const sdk = { loads: 0, tokens: 0 }
jest.mock('@azure/identity', () => {
  sdk.loads += 1
  class FakeCredential {
    async getToken() {
      sdk.tokens += 1
      return { token: fakeJwt({ oid: OBJECT_ID }), expiresOnTimestamp: Date.now() + 3_600_000 }
    }
  }
  return { DefaultAzureCredential: FakeCredential, ManagedIdentityCredential: FakeCredential, WorkloadIdentityCredential: FakeCredential }
})

describe('cloud SDK loading order', () => {
  const keys = ['OM_ENABLE_ENTERPRISE_MODULES', 'OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS']
  afterEach(() => {
    for (const key of keys) delete process.env[key]
  })

  it('never imports @azure/identity while the gate is closed', async () => {
    const config = settings.parse(base)
    await expect(Promise.resolve().then(() => provider.create(config, {} as never))).rejects.toMatchObject({ code: 'unavailable' })
    expect(sdk).toEqual({ loads: 0, tokens: 0 })
  })

  it('imports the SDK and fetches an Entra token before connecting once the gate is open', async () => {
    for (const key of keys) process.env[key] = 'true'
    const { createCacheProviderHostContext } = await import('@open-mercato/cache/provider')
    const config = settings.parse({ ...base, host: '127.0.0.1', port: 1, tls: { servername: 'localhost' }, connectTimeoutMs: 200, maxRetriesPerRequest: 0 })
    const context = createCacheProviderHostContext({ id: provider.id, namespace: 'sdk-order' })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const strategy = await Promise.resolve(provider.create(config, context)).catch((error: unknown) => error)
    warn.mockRestore()
    expect(sdk.loads).toBe(1)
    expect(sdk.tokens).toBeGreaterThanOrEqual(1)
    if (strategy && typeof (strategy as { close?: unknown }).close === 'function') await (strategy as { close(): Promise<void> }).close()
  })
})
