type ConsentIntegrityModule = typeof import('@open-mercato/core/modules/auth/lib/consentIntegrity')

const sampleInput = {
  userId: '11111111-1111-4111-8111-111111111111',
  consentType: 'marketing',
  isGranted: true,
  grantedAt: new Date('2026-01-01T00:00:00.000Z'),
  withdrawnAt: null,
  ipAddress: '203.0.113.7',
  source: 'portal',
}

function loadModule(): ConsentIntegrityModule {
  let mod: ConsentIntegrityModule | undefined
  jest.isolateModules(() => {
    mod = require('@open-mercato/core/modules/auth/lib/consentIntegrity')
  })
  if (!mod) throw new Error('failed to load consentIntegrity module')
  return mod
}

describe('consentIntegrity secret resolution', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.CONSENT_INTEGRITY_SECRET
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    delete process.env.JWT_SECRET
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  it('refuses to compute a hash in production when no secret is configured', () => {
    process.env.NODE_ENV = 'production'
    const { computeConsentIntegrityHash } = loadModule()

    expect(() => computeConsentIntegrityHash(sampleInput)).toThrow(/Refusing to compute or verify/)
  })

  it('refuses to verify a hash in production when no secret is configured', () => {
    process.env.NODE_ENV = 'production'
    const { verifyConsentIntegrityHash } = loadModule()

    expect(() => verifyConsentIntegrityHash(sampleInput, 'deadbeef')).toThrow(/Refusing to compute or verify/)
  })

  it('does not fall back to a hardcoded literal key in production', () => {
    process.env.NODE_ENV = 'production'
    const { computeConsentIntegrityHash } = loadModule()

    expect(() => computeConsentIntegrityHash(sampleInput)).toThrow()
  })

  it('produces a different hash with a real secret than with the dev-only default', () => {
    process.env.NODE_ENV = 'development'
    jest.spyOn(console, 'warn').mockImplementation(() => {})

    process.env.CONSENT_INTEGRITY_SECRET = 'a-real-secret'
    const { computeConsentIntegrityHash: computeWithSecret } = loadModule()
    const withSecret = computeWithSecret(sampleInput)

    delete process.env.CONSENT_INTEGRITY_SECRET
    const { computeConsentIntegrityHash: computeDev } = loadModule()
    const devHash = computeDev(sampleInput)

    expect(withSecret).not.toEqual(devHash)
  })

  it('uses the configured CONSENT_INTEGRITY_SECRET in production without throwing', () => {
    process.env.NODE_ENV = 'production'
    process.env.CONSENT_INTEGRITY_SECRET = 'prod-secret'
    const { computeConsentIntegrityHash } = loadModule()

    expect(() => computeConsentIntegrityHash(sampleInput)).not.toThrow()
  })

  it('falls back to NEXTAUTH_SECRET in production without throwing', () => {
    process.env.NODE_ENV = 'production'
    process.env.NEXTAUTH_SECRET = 'nextauth-prod-secret'
    const { computeConsentIntegrityHash } = loadModule()

    expect(() => computeConsentIntegrityHash(sampleInput)).not.toThrow()
  })

  it('falls back to AUTH_SECRET in production without throwing', () => {
    process.env.NODE_ENV = 'production'
    process.env.AUTH_SECRET = 'auth-prod-secret'
    const { computeConsentIntegrityHash } = loadModule()

    expect(() => computeConsentIntegrityHash(sampleInput)).not.toThrow()
  })

  it('falls back to JWT_SECRET in production without throwing', () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'jwt-prod-secret'
    const { computeConsentIntegrityHash } = loadModule()

    expect(() => computeConsentIntegrityHash(sampleInput)).not.toThrow()
  })

  it('emits the missing-secret warning once outside production and still computes a hash', () => {
    process.env.NODE_ENV = 'development'
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { computeConsentIntegrityHash } = loadModule()

    const first = computeConsentIntegrityHash(sampleInput)
    const second = computeConsentIntegrityHash(sampleInput)

    expect(first).toEqual(second)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('round-trips compute and verify when a secret is configured', () => {
    process.env.CONSENT_INTEGRITY_SECRET = 'round-trip-secret'
    const { computeConsentIntegrityHash, verifyConsentIntegrityHash } = loadModule()

    const hash = computeConsentIntegrityHash(sampleInput)
    expect(verifyConsentIntegrityHash(sampleInput, hash)).toBe(true)
    expect(verifyConsentIntegrityHash({ ...sampleInput, isGranted: false }, hash)).toBe(false)
  })
})
