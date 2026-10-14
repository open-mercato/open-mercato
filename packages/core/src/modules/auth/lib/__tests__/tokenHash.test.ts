import { createHmac } from 'node:crypto'

const SECRET_ENV_KEYS = ['AUTH_TOKEN_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET', 'JWT_SECRET'] as const
const MANAGED_ENV_KEYS = [...SECRET_ENV_KEYS, 'NODE_ENV', 'OM_ALLOW_DEV_AUTH_SECRET'] as const
const DEV_ONLY_SECRET = 'om-auth-token-dev-only-secret'

type EnvOverrides = Partial<Record<(typeof MANAGED_ENV_KEYS)[number], string | undefined>>

function loadHashAuthToken(overrides: EnvOverrides): (rawToken: string) => string {
  for (const key of MANAGED_ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value
  }
  let hashAuthToken: ((rawToken: string) => string) | undefined
  jest.isolateModules(() => {
    hashAuthToken = require('../tokenHash').hashAuthToken
  })
  if (!hashAuthToken) throw new Error('[internal] tokenHash module failed to load')
  return hashAuthToken
}

function hmac(secret: string, rawToken: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex')
}

describe('hashAuthToken secret resolution', () => {
  const originalEnv: Record<string, string | undefined> = {}

  beforeAll(() => {
    for (const key of MANAGED_ENV_KEYS) originalEnv[key] = process.env[key]
  })

  afterEach(() => {
    for (const key of MANAGED_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
  })

  it('uses the configured secret in any environment', () => {
    const hashAuthToken = loadHashAuthToken({ NODE_ENV: 'staging', AUTH_TOKEN_SECRET: 'configured-secret' })
    expect(hashAuthToken('raw-token')).toBe(hmac('configured-secret', 'raw-token'))
  })

  it.each(SECRET_ENV_KEYS)('accepts %s as the token hashing secret', (key) => {
    const hashAuthToken = loadHashAuthToken({ NODE_ENV: 'preview', [key]: `secret-from-${key}` })
    expect(hashAuthToken('raw-token')).toBe(hmac(`secret-from-${key}`, 'raw-token'))
  })

  it('throws in production without a secret', () => {
    const hashAuthToken = loadHashAuthToken({ NODE_ENV: 'production', OM_ALLOW_DEV_AUTH_SECRET: 'true' })
    expect(() => hashAuthToken('raw-token')).toThrow(/Refusing to start in production/)
  })

  it.each(['staging', 'preview', 'qa'])('fails closed for NODE_ENV=%s without a secret or opt-in', (nodeEnv) => {
    const hashAuthToken = loadHashAuthToken({ NODE_ENV: nodeEnv })
    expect(() => hashAuthToken('raw-token')).toThrow(/OM_ALLOW_DEV_AUTH_SECRET/)
  })

  it('fails closed for a non-dev NODE_ENV when the opt-in is explicitly false', () => {
    const hashAuthToken = loadHashAuthToken({ NODE_ENV: 'staging', OM_ALLOW_DEV_AUTH_SECRET: 'false' })
    expect(() => hashAuthToken('raw-token')).toThrow(/OM_ALLOW_DEV_AUTH_SECRET/)
  })

  it('uses the dev-only secret for a non-dev NODE_ENV only with the explicit opt-in', () => {
    const hashAuthToken = loadHashAuthToken({ NODE_ENV: 'staging', OM_ALLOW_DEV_AUTH_SECRET: 'true' })
    expect(hashAuthToken('raw-token')).toBe(hmac(DEV_ONLY_SECRET, 'raw-token'))
  })

  it.each(['development', 'test', undefined])('keeps the dev-only fallback for NODE_ENV=%s', (nodeEnv) => {
    const hashAuthToken = loadHashAuthToken({ NODE_ENV: nodeEnv })
    expect(hashAuthToken('raw-token')).toBe(hmac(DEV_ONLY_SECRET, 'raw-token'))
  })
})
