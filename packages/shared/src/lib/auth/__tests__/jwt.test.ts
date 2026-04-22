import crypto from 'node:crypto'

import {
  deriveJwtAudienceSecret,
  signAudienceJwt,
  signJwt,
  verifyAudienceJwt,
  verifyJwt,
} from '../jwt'

function base64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function signTokenParts(header: string, payload: string, secret: string): string {
  return base64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest())
}

describe('jwt helpers', () => {
  const secret = 'test-secret'
  const now = new Date('2026-04-11T12:00:00.000Z')

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now.getTime())
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('signs and verifies payloads with issued and expiry timestamps', () => {
    const token = signJwt({ sub: 'user-1', roles: ['admin'] }, secret, 300)

    expect(verifyJwt(token, secret)).toEqual({
      sub: 'user-1',
      roles: ['admin'],
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 300,
    })
  })

  it('rejects tokens with tampered payloads', () => {
    const token = signJwt({ sub: 'user-1' }, secret, 300)
    const [header, , signature] = token.split('.')
    const tamperedPayload = base64url(
      JSON.stringify({
        sub: 'user-2',
        iat: Math.floor(now.getTime() / 1000),
        exp: Math.floor(now.getTime() / 1000) + 300,
      })
    )

    expect(verifyJwt(`${header}.${tamperedPayload}.${signature}`, secret)).toBeNull()
  })

  it('rejects expired tokens', () => {
    const token = signJwt({ sub: 'user-1' }, secret, 1)

    jest.spyOn(Date, 'now').mockReturnValue(now.getTime() + 3_000)

    expect(verifyJwt(token, secret)).toBeNull()
  })

  it('returns null for malformed signatures', () => {
    const token = signJwt({ sub: 'user-1' }, secret, 300)
    const [header, payload] = token.split('.')

    expect(verifyJwt(`${header}.${payload}.x`, secret)).toBeNull()
  })

  it('returns null for signed payloads that are not valid JSON', () => {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = base64url('not-json')
    const signature = signTokenParts(header, payload, secret)

    expect(verifyJwt(`${header}.${payload}.${signature}`, secret)).toBeNull()
  })

  it('throws when the JWT secret is missing', () => {
    expect(() => signJwt({ sub: 'user-1' }, '')).toThrow('JWT_SECRET is not set')
    expect(() => verifyJwt('header.payload.signature', '')).toThrow('JWT_SECRET is not set')
  })

  describe('audience-derived signing keys', () => {
    const baseSecret = 'test-secret'
    const originalJwtSecret = process.env.JWT_SECRET
    const originalStaffSecret = process.env.JWT_STAFF_SECRET
    const originalCustomerSecret = process.env.JWT_CUSTOMER_SECRET

    beforeEach(() => {
      process.env.JWT_SECRET = baseSecret
      delete process.env.JWT_STAFF_SECRET
      delete process.env.JWT_CUSTOMER_SECRET
    })

    afterEach(() => {
      process.env.JWT_SECRET = originalJwtSecret
      if (originalStaffSecret === undefined) delete process.env.JWT_STAFF_SECRET
      else process.env.JWT_STAFF_SECRET = originalStaffSecret
      if (originalCustomerSecret === undefined) delete process.env.JWT_CUSTOMER_SECRET
      else process.env.JWT_CUSTOMER_SECRET = originalCustomerSecret
    })

    it('derives deterministic, distinct keys per audience from the same base secret', () => {
      const staffKey = deriveJwtAudienceSecret('staff')
      const customerKey = deriveJwtAudienceSecret('customer')
      const staffKey2 = deriveJwtAudienceSecret('staff')

      expect(staffKey).toBe(staffKey2)
      expect(staffKey).not.toBe(customerKey)
      expect(staffKey).not.toBe(baseSecret)
      expect(customerKey).not.toBe(baseSecret)
    })

    it('honors per-audience env overrides ahead of the derived secret', () => {
      process.env.JWT_CUSTOMER_SECRET = 'explicit-customer-secret'
      expect(deriveJwtAudienceSecret('customer')).toBe('explicit-customer-secret')
      // Staff continues to derive from the base secret when no staff override is set.
      expect(deriveJwtAudienceSecret('staff')).not.toBe('explicit-customer-secret')
    })

    it('normalizes audience names so case and punctuation do not cause drift', () => {
      expect(deriveJwtAudienceSecret('staff')).toBe(deriveJwtAudienceSecret('STAFF'))
      expect(deriveJwtAudienceSecret('customer-portal')).toBe(deriveJwtAudienceSecret('Customer_Portal'))
    })

    it('round-trips a staff audience token and enforces iss/aud claims', () => {
      const token = signAudienceJwt('staff', { sub: 'staff-1', roles: ['admin'] }, 300)
      const payload = verifyAudienceJwt('staff', token)
      expect(payload).toMatchObject({
        sub: 'staff-1',
        roles: ['admin'],
        iss: 'open-mercato',
        aud: 'staff',
      })
    })

    it('rejects a staff token replayed against the customer audience (cross-audience confusion)', () => {
      const staffToken = signAudienceJwt('staff', { sub: 'staff-1' }, 300)
      // The verifier both uses a different HMAC key AND enforces `aud` — either layer should block.
      expect(verifyAudienceJwt('customer', staffToken)).toBeNull()
    })

    it('rejects a customer token replayed against the staff audience', () => {
      const customerToken = signAudienceJwt('customer', { sub: 'customer-1', type: 'customer' }, 300)
      expect(verifyAudienceJwt('staff', customerToken)).toBeNull()
    })

    it('rejects an unsigned payload that carries the right aud but has the wrong signing key', () => {
      // Forge a token that *says* aud=staff but was signed with the customer-derived key.
      const forgedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
      const forgedBody = Buffer.from(
        JSON.stringify({
          sub: 'attacker',
          iss: 'open-mercato',
          aud: 'staff',
          iat: Math.floor(now.getTime() / 1000),
          exp: Math.floor(now.getTime() / 1000) + 300,
        }),
      )
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
      const customerSecret = deriveJwtAudienceSecret('customer')
      const forgedSig = crypto
        .createHmac('sha256', customerSecret)
        .update(`${forgedHeader}.${forgedBody}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
      const forgedToken = `${forgedHeader}.${forgedBody}.${forgedSig}`

      expect(verifyAudienceJwt('staff', forgedToken)).toBeNull()
    })

    it('default signJwt/verifyJwt without explicit secret uses the staff audience', () => {
      const token = signJwt({ sub: 'staff-2' })
      const payload = verifyJwt(token)
      expect(payload).toMatchObject({ sub: 'staff-2', iss: 'open-mercato', aud: 'staff' })
      // The same token cannot be verified as a customer token because the HMAC key differs.
      expect(verifyAudienceJwt('customer', token)).toBeNull()
    })

    it('legacy signJwt(payload, rawSecret) path keeps iss/aud out of the token', () => {
      const token = signJwt({ sub: 'legacy-1' }, 'raw-secret', 300)
      const payload = verifyJwt(token, 'raw-secret')
      expect(payload).toMatchObject({ sub: 'legacy-1' })
      expect((payload as Record<string, unknown>).iss).toBeUndefined()
      expect((payload as Record<string, unknown>).aud).toBeUndefined()
    })

    it('rejects a staff token when no audience override is configured but verification asks for customer', () => {
      const token = signJwt({ sub: 'staff-3' })
      // A page that wrongly uses verifyJwt with default args would enforce staff aud, so a
      // customer token replayed there must be rejected.
      const customerToken = signAudienceJwt('customer', { sub: 'customer-2', type: 'customer' })
      expect(verifyJwt(customerToken)).toBeNull()
      // Sanity: the staff token still verifies with default args.
      expect(verifyJwt(token)).not.toBeNull()
    })
  })

  describe('legacy grace period fallback', () => {
    const baseSecret = 'test-secret'
    const originalJwtSecret = process.env.JWT_SECRET
    const originalGrace = process.env.JWT_LEGACY_GRACE_MINUTES

    beforeEach(() => {
      process.env.JWT_SECRET = baseSecret
      delete process.env.JWT_LEGACY_GRACE_MINUTES
    })

    afterEach(() => {
      process.env.JWT_SECRET = originalJwtSecret
      if (originalGrace === undefined) delete process.env.JWT_LEGACY_GRACE_MINUTES
      else process.env.JWT_LEGACY_GRACE_MINUTES = originalGrace
    })

    it('verifies a pre-migration token signed with raw JWT_SECRET via legacy fallback', () => {
      // Simulate a pre-migration token: signed with raw secret, no aud/iss
      const legacyToken = signJwt({ sub: 'legacy-user', roles: ['admin'] }, baseSecret, 3600)
      // Default verifyJwt (audience-derived) should fail, but legacy fallback should succeed
      const payload = verifyJwt(legacyToken)
      expect(payload).not.toBeNull()
      expect(payload).toMatchObject({ sub: 'legacy-user', roles: ['admin'] })
      expect((payload as Record<string, unknown>)._legacyToken).toBe(true)
    })

    it('does not use legacy fallback when grace period is disabled', () => {
      process.env.JWT_LEGACY_GRACE_MINUTES = '0'
      const legacyToken = signJwt({ sub: 'legacy-user' }, baseSecret, 3600)
      expect(verifyJwt(legacyToken)).toBeNull()
    })

    it('does not use legacy fallback when an explicit secret is provided', () => {
      const wrongSecret = 'wrong-secret'
      const token = signJwt({ sub: 'user-1' }, baseSecret, 3600)
      // Explicit secret that doesn't match — should fail, no fallback
      expect(verifyJwt(token, wrongSecret)).toBeNull()
    })

    it('new audience tokens still verify directly without needing fallback', () => {
      const newToken = signJwt({ sub: 'new-user' })
      const payload = verifyJwt(newToken)
      expect(payload).not.toBeNull()
      expect(payload).toMatchObject({ sub: 'new-user', aud: 'staff', iss: 'open-mercato' })
      expect((payload as Record<string, unknown>)._legacyToken).toBeUndefined()
    })
  })
})
