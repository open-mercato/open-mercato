import { createHash, createHmac } from 'node:crypto'
import {
  AWS_ELASTICACHE_CACHE_PROVIDER_ID,
  AWS_MAX_REAUTH_INTERVAL_MS,
  createAwsElastiCacheProvider,
  createElastiCacheIamToken,
  createElastiCacheIamTokenSource,
  ELASTICACHE_IAM_TOKEN_TTL_SECONDS,
  settings,
  toElastiCacheRespSettings,
} from '../index'
import { createCacheProviderHostContext } from '@open-mercato/cache/provider'
import { createCachedCredentialsProvider } from '@open-mercato/cache-provider-managed-kit'

const provider = createAwsElastiCacheProvider()

const FAKE = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }
const FAKE_SESSION = { ...FAKE, sessionToken: 'session/token+value==' }
const SIGNING_DATE = new Date('2026-11-24T10:20:30.000Z')
const base = {
  engine: 'valkey',
  deployment: 'node-based',
  clusterMode: 'disabled',
  host: 'master.om-cache.abc123.euw1.cache.amazonaws.com',
  auth: { kind: 'iam', userId: 'om-cache', replicationGroupId: 'om-cache-rg', region: 'eu-west-1' },
} as const

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/** Independent SigV4 query-signature check (AWS SigV4 spec), not using @smithy. */
function expectedSignature(token: string, secret: string, region: string): string {
  const [host, rawQuery] = token.split('/?')
  const params = rawQuery.split('&').map((pair) => pair.split('=')).filter(([key]) => key !== 'X-Amz-Signature')
  const canonicalQuery = params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, value]) => `${key}=${value}`).join('&')
  const amzDate = decodeURIComponent(params.find(([key]) => key === 'X-Amz-Date')![1])
  const day = amzDate.slice(0, 8)
  const canonicalRequest = ['GET', '/', canonicalQuery, `host:${host}\n`, 'host', createHash('sha256').update('').digest('hex')].join('\n')
  const scope = `${day}/${region}/elasticache/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 'elasticache'), 'aws4_request')
  return hmac(signingKey, stringToSign).toString('hex')
}

function queryOf(token: string): URLSearchParams {
  return new URLSearchParams(token.split('/?')[1])
}

describe('aws elasticache settings', () => {
  it('accepts only node-based Valkey, cluster mode disabled, IAM, TLS', () => {
    const parsed = settings.parse(base)
    expect(parsed).toMatchObject({ port: 6379, auth: { credentials: 'default-chain', reauthIntervalMs: 600000 }, tls: {} })
    expect(provider.id).toBe(AWS_ELASTICACHE_CACHE_PROVIDER_ID)
  })

  it.each([
    ['Redis OSS engine', { ...base, engine: 'redis' }],
    ['Memcached engine', { ...base, engine: 'memcached' }],
    ['Serverless deployment', { ...base, deployment: 'serverless' }],
    ['cluster mode enabled', { ...base, clusterMode: 'enabled' }],
    ['ACL password auth', { ...base, auth: { kind: 'password', username: 'u', password: 'p' } }],
    ['static access keys in settings', { ...base, auth: { ...base.auth, accessKeyId: 'AKID', secretAccessKey: 's' } }],
    ['uppercase user id', { ...base, auth: { ...base.auth, userId: 'OmCache' } }],
    ['invalid region', { ...base, auth: { ...base.auth, region: 'europe' } }],
    ['TLS verification bypass', { ...base, tls: { rejectUnauthorized: false } }],
    ['missing engine', { ...base, engine: undefined }],
    ['unknown key', { ...base, db: 2 }],
  ])('rejects %s', (_label, input) => {
    expect(settings.safeParse(input).success).toBe(false)
  })

  it('maps to the writable primary endpoint with mandatory hostname verification', () => {
    expect(toElastiCacheRespSettings(settings.parse(base))).toMatchObject({
      mode: 'standalone',
      host: base.host,
      port: 6379,
      tls: { servername: base.host, rejectUnauthorized: true },
    })
  })

  it('redacts the IAM user id and CA material', () => {
    const redacted = JSON.stringify(provider.redact?.(settings.parse({ ...base, tls: { ca: 'CA-PEM-MATERIAL' } })))
    expect(redacted).not.toContain('"om-cache"')
    expect(redacted).not.toContain('CA-PEM-MATERIAL')
    expect(redacted).toContain('om-cache-rg')
  })
})

describe('ElastiCache IAM token signing', () => {
  it('produces a deterministic SigV4 presigned connect token for fake credentials and a fixed clock', async () => {
    const input = { userId: 'om-cache', replicationGroupId: 'om-cache-rg', region: 'eu-west-1', credentials: FAKE, signingDate: SIGNING_DATE }
    const token = await createElastiCacheIamToken(input)
    expect(await createElastiCacheIamToken(input)).toBe(token)
    expect(token.startsWith('om-cache-rg/?')).toBe(true)
    expect(token).not.toContain('http://')
    const query = queryOf(token)
    expect(query.get('Action')).toBe('connect')
    expect(query.get('User')).toBe('om-cache')
    expect(query.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(query.get('X-Amz-Credential')).toBe('AKIDEXAMPLE/20261124/eu-west-1/elasticache/aws4_request')
    expect(query.get('X-Amz-Date')).toBe('20261124T102030Z')
    expect(query.get('X-Amz-Expires')).toBe('900')
    expect(query.get('X-Amz-SignedHeaders')).toBe('host')
    expect(query.get('X-Amz-Signature')).toBe(expectedSignature(token, FAKE.secretAccessKey, 'eu-west-1'))
    expect(token).not.toContain(FAKE.secretAccessKey)
    expect(token).not.toContain(encodeURIComponent(FAKE.secretAccessKey))
  })

  it('includes the session token for temporary credentials and signs over it', async () => {
    const token = await createElastiCacheIamToken({ userId: 'om-cache', replicationGroupId: 'om-cache-rg', region: 'us-east-1', credentials: async () => FAKE_SESSION, signingDate: SIGNING_DATE })
    expect(queryOf(token).get('X-Amz-Security-Token')).toBe(FAKE_SESSION.sessionToken)
    expect(queryOf(token).get('X-Amz-Signature')).toBe(expectedSignature(token, FAKE.secretAccessKey, 'us-east-1'))
  })

  it('changes the signature with the signing resource, user, region and time', async () => {
    const sign = (overrides: Record<string, unknown>) => createElastiCacheIamToken({ userId: 'om-cache', replicationGroupId: 'om-cache-rg', region: 'eu-west-1', credentials: FAKE, signingDate: SIGNING_DATE, ...overrides })
    const reference = queryOf(await sign({})).get('X-Amz-Signature')
    for (const variant of [{ replicationGroupId: 'other-rg' }, { userId: 'other-user' }, { region: 'eu-central-1' }, { signingDate: new Date(SIGNING_DATE.getTime() + 1000) }]) {
      expect(queryOf(await sign(variant)).get('X-Amz-Signature')).not.toBe(reference)
    }
  })

  it('token source uses the user id as username and a 15 minute expiry; cached refresh re-signs after expiry minus skew', async () => {
    let clock = SIGNING_DATE.getTime()
    const credentials = jest.fn(async () => FAKE)
    const source = createElastiCacheIamTokenSource(settings.parse(base).auth, credentials, () => clock)
    const first = await source()
    expect(first).toMatchObject({ username: 'om-cache', expiresAt: clock + 900_000 })
    const cached = createCachedCredentialsProvider(source, { providerId: provider.id, sourceLabel: 'AWS IAM', refreshSkewMs: 5 * 60_000, now: () => clock })
    const a = await cached()
    clock += 9 * 60_000
    expect((await cached()).password).toBe(a.password)
    clock += 2 * 60_000
    const b = await cached()
    expect(b.password).not.toBe(a.password)
    expect(queryOf(b.password).get('X-Amz-Date')).toBe('20261124T103130Z')
  })
})

describe('ElastiCache re-AUTH interval', () => {
  it('caps the re-AUTH interval at 10 minutes, inside the 900 s token TTL', () => {
    expect(AWS_MAX_REAUTH_INTERVAL_MS).toBe(10 * 60_000)
    expect(AWS_MAX_REAUTH_INTERVAL_MS).toBeLessThan(ELASTICACHE_IAM_TOKEN_TTL_SECONDS * 1000)
    expect(settings.safeParse({ ...base, auth: { ...base.auth, reauthIntervalMs: AWS_MAX_REAUTH_INTERVAL_MS } }).success).toBe(true)
    expect(settings.safeParse({ ...base, auth: { ...base.auth, reauthIntervalMs: AWS_MAX_REAUTH_INTERVAL_MS + 1 } }).success).toBe(false)
    expect(settings.safeParse({ ...base, auth: { ...base.auth, reauthIntervalMs: 30 * 60_000 } }).success).toBe(false)
  })

  it('re-AUTHs a live connection before a 900 s token goes stale even with the maximum interval', () => {
    let clock = SIGNING_DATE.getTime()
    const cached = createCachedCredentialsProvider(async () => ({ username: 'om-cache', password: 't', expiresAt: clock + ELASTICACHE_IAM_TOKEN_TTL_SECONDS * 1000 }), { providerId: provider.id, sourceLabel: 'AWS IAM', refreshSkewMs: 5 * 60_000, now: () => clock })
    return cached().then(() => {
      expect(cached.nextRefreshDelayMs(AWS_MAX_REAUTH_INTERVAL_MS)).toBe(10 * 60_000)
      clock += 4 * 60_000
      expect(cached.nextRefreshDelayMs(AWS_MAX_REAUTH_INTERVAL_MS)).toBe(6 * 60_000)
    })
  })
})

const sdk = { loads: 0 }
jest.mock('@aws-sdk/credential-provider-node', () => {
  sdk.loads += 1
  return { defaultProvider: () => async () => FAKE }
})

describe('cloud SDK loading order', () => {
  it('never imports the AWS credential chain while the gate is closed', async () => {
    await expect(Promise.resolve().then(() => provider.create(settings.parse(base), createCacheProviderHostContext({ id: provider.id, namespace: 'sdk-order' })))).rejects.toMatchObject({ code: 'unavailable' })
    expect(sdk.loads).toBe(0)
  })
})
