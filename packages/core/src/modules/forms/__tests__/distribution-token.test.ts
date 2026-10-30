import { randomUUID } from 'node:crypto'

process.env.FORMS_DISTRIBUTION_TOKEN_SECRET = 'forms-distribution-test-secret'

import {
  signAccessToken,
  verifyAccessToken,
  hashInvitationToken,
  generateRawInvitationToken,
  generatePublicSlug,
  getAccessTokenTtlSeconds,
  getInvitationTokenTtlSeconds,
} from '../services/distribution-token'

const nowSeconds = () => Math.floor(Date.now() / 1000)

describe('distribution access token', () => {
  it('round-trips sign → verify', () => {
    const submissionId = randomUUID()
    const invitationId = randomUUID()
    const token = signAccessToken({
      submissionId,
      invitationId,
      role: 'patient',
      expiresAtSeconds: nowSeconds() + 3600,
    })
    const verified = verifyAccessToken(token)
    expect(verified.ok).toBe(true)
    expect(verified.submissionId).toBe(submissionId)
    expect(verified.invitationId).toBe(invitationId)
    expect(verified.role).toBe('patient')
  })

  it('round-trips a null role', () => {
    const submissionId = randomUUID()
    const invitationId = randomUUID()
    const token = signAccessToken({
      submissionId,
      invitationId,
      role: null,
      expiresAtSeconds: nowSeconds() + 3600,
    })
    const verified = verifyAccessToken(token)
    expect(verified.ok).toBe(true)
    expect(verified.role).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const token = signAccessToken({
      submissionId: randomUUID(),
      invitationId: randomUUID(),
      role: 'patient',
      expiresAtSeconds: nowSeconds() + 3600,
    })
    const parts = token.split('.')
    const tamperedHmac = parts[4].replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a'))
    const tampered = [...parts.slice(0, 4), tamperedHmac].join('.')
    const verified = verifyAccessToken(tampered)
    expect(verified.ok).toBe(false)
    expect(verified.reason).toBe('signature')
  })

  it('rejects an expired token', () => {
    const token = signAccessToken({
      submissionId: randomUUID(),
      invitationId: randomUUID(),
      role: 'patient',
      expiresAtSeconds: nowSeconds() - 10,
    })
    const verified = verifyAccessToken(token)
    expect(verified.ok).toBe(false)
    expect(verified.reason).toBe('expired')
  })

  it('rejects a malformed token', () => {
    expect(verifyAccessToken('a.b.c').ok).toBe(false)
    expect(verifyAccessToken('not-a-token').ok).toBe(false)
  })

  it('binds scope — changing submissionId invalidates the signature', () => {
    const invitationId = randomUUID()
    const exp = nowSeconds() + 3600
    const token = signAccessToken({
      submissionId: randomUUID(),
      invitationId,
      role: 'patient',
      expiresAtSeconds: exp,
    })
    const forged = signAccessToken({
      submissionId: randomUUID(),
      invitationId,
      role: 'patient',
      expiresAtSeconds: exp,
    })
    const parts = token.split('.')
    const forgedParts = forged.split('.')
    // Swap the submission segment but keep the original hmac → must fail.
    const mismatched = [forgedParts[0], parts[1], parts[2], parts[3], parts[4]].join('.')
    expect(verifyAccessToken(mismatched).ok).toBe(false)
  })

  it('binds scope — changing invitationId invalidates the signature', () => {
    const submissionId = randomUUID()
    const exp = nowSeconds() + 3600
    const token = signAccessToken({
      submissionId,
      invitationId: randomUUID(),
      role: 'patient',
      expiresAtSeconds: exp,
    })
    const other = signAccessToken({
      submissionId,
      invitationId: randomUUID(),
      role: 'patient',
      expiresAtSeconds: exp,
    })
    const parts = token.split('.')
    const otherParts = other.split('.')
    const mismatched = [parts[0], otherParts[1], parts[2], parts[3], parts[4]].join('.')
    expect(verifyAccessToken(mismatched).ok).toBe(false)
  })

  it('binds scope — changing role invalidates the signature', () => {
    const submissionId = randomUUID()
    const invitationId = randomUUID()
    const exp = nowSeconds() + 3600
    const token = signAccessToken({ submissionId, invitationId, role: 'patient', expiresAtSeconds: exp })
    const other = signAccessToken({ submissionId, invitationId, role: 'clinician', expiresAtSeconds: exp })
    const parts = token.split('.')
    const otherParts = other.split('.')
    const mismatched = [parts[0], parts[1], otherParts[2], parts[3], parts[4]].join('.')
    expect(verifyAccessToken(mismatched).ok).toBe(false)
  })
})

describe('invitation token hashing', () => {
  it('is deterministic', () => {
    const raw = 'abc123-raw-token'
    expect(hashInvitationToken(raw)).toBe(hashInvitationToken(raw))
  })

  it('differs for different inputs', () => {
    expect(hashInvitationToken('token-a')).not.toBe(hashInvitationToken('token-b'))
  })

  it('produces a 64-char hex SHA-256 digest', () => {
    expect(hashInvitationToken('anything')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('token / slug entropy', () => {
  it('mints a URL-safe raw invitation token with ≥128 bits of entropy', () => {
    const raw = generateRawInvitationToken()
    // 32 random bytes → 256 bits; base64url has no +,/,= padding.
    const bytes = Buffer.from(raw, 'base64url').length
    expect(bytes).toBeGreaterThanOrEqual(16)
    expect(bytes).toBe(32)
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('mints a URL-safe public slug with ≥128 bits of entropy', () => {
    const slug = generatePublicSlug()
    const bytes = Buffer.from(slug, 'base64url').length
    expect(bytes).toBeGreaterThanOrEqual(16)
    expect(slug).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('mints distinct values across calls', () => {
    expect(generateRawInvitationToken()).not.toBe(generateRawInvitationToken())
    expect(generatePublicSlug()).not.toBe(generatePublicSlug())
  })
})

describe('ttl helpers', () => {
  it('default access token TTL is 24h', () => {
    expect(getAccessTokenTtlSeconds()).toBe(86_400)
  })

  it('default invitation token TTL is 14 days', () => {
    expect(getInvitationTokenTtlSeconds()).toBe(1_209_600)
  })
})
