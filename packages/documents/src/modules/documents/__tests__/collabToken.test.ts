import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import {
  COLLAB_TOKEN_AUDIENCE,
  COLLAB_TOKEN_CLOCK_SKEW_SECONDS,
  COLLAB_TOKEN_TTL_SECONDS,
  COLLAB_TOKEN_V2_AUDIENCE,
  COLLAB_TOKEN_V2_MIN_SECRET_BYTES,
  isCollabTokenV2Ready,
  mintCollabToken,
  mintCollabTokenV2,
  resolveLegacyCollabTokenVerifier,
  verifyCollabToken,
  verifyCollabTokenV2,
  type CollabTokenClaims,
} from '../lib/collabToken'

const V2_SECRET = 'test-collab-v2-secret-def456-7890'

const claims: CollabTokenClaims = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  documentId: 'document-1',
  tier: 'editor',
}

function tamperSignature(token: string): string {
  const [header, payload, signature = ''] = token.split('.')
  const replacement = signature.startsWith('a') ? 'b' : 'a'
  return `${header}.${payload}.${replacement}${signature.slice(1)}`
}

beforeAll(() => {
  process.env.JWT_SECRET = 'test-collab-secret-abc123'
  delete process.env.DOCUMENTS_COLLAB_JWT_SECRET
  process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = V2_SECRET
})

beforeEach(() => {
  process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = V2_SECRET
})

afterEach(() => {
  jest.useRealTimers()
})

describe('collab tokens', () => {
  it('roundtrips minted claims', () => {
    const token = mintCollabToken(claims)

    expect(verifyCollabToken(token)).toEqual(claims)
  })

  it('rejects a tampered signature', () => {
    const token = mintCollabToken(claims)

    expect(verifyCollabToken(tamperSignature(token))).toBeNull()
  })

  it('rejects a token minted for a different audience', () => {
    const token = signJwt(claims, { audience: 'staff', expiresInSec: 60 })

    expect(verifyCollabToken(token)).toBeNull()
  })

  it('rejects an expired token', () => {
    jest.useFakeTimers({ now: new Date('2020-01-01T00:00:00.000Z') })
    const token = mintCollabToken(claims)

    jest.setSystemTime(new Date('2020-01-01T00:02:00.000Z'))

    expect(verifyCollabToken(token)).toBeNull()
  })

  it('rejects a token missing tier', () => {
    const token = signJwt(
      {
        userId: 'u',
        tenantId: 't',
        organizationId: 'o',
        documentId: 'd',
      },
      { audience: COLLAB_TOKEN_AUDIENCE, expiresInSec: 60 },
    )

    expect(verifyCollabToken(token)).toBeNull()
  })

  it('roundtrips v2 capability claims with a hard expiration', () => {
    jest.useFakeTimers({ now: new Date('2026-07-10T10:00:00.000Z') })
    const token = mintCollabTokenV2({
      ...claims,
      tokenVersion: 2,
      readOnly: true,
    })

    expect(verifyCollabTokenV2(token)).toEqual({
      ...claims,
      tokenVersion: 2,
      readOnly: true,
      exp: Math.floor(Date.now() / 1000) + COLLAB_TOKEN_TTL_SECONDS,
    })
  })

  it('accepts v2 tokens minted within the bounded issuer clock skew', () => {
    const verifierNow = new Date('2026-07-10T10:00:00.000Z')
    jest.useFakeTimers({
      now: new Date(verifierNow.getTime() + COLLAB_TOKEN_CLOCK_SKEW_SECONDS * 1000),
    })
    const token = mintCollabTokenV2({
      ...claims,
      tokenVersion: 2,
      readOnly: false,
    })

    jest.setSystemTime(verifierNow)

    expect(verifyCollabTokenV2(token)).toMatchObject({
      ...claims,
      tokenVersion: 2,
      readOnly: false,
    })
  })

  it('rejects v2 tokens minted beyond the bounded issuer clock skew', () => {
    const verifierNow = new Date('2026-07-10T10:00:00.000Z')
    jest.useFakeTimers({
      now: new Date(verifierNow.getTime() + (COLLAB_TOKEN_CLOCK_SKEW_SECONDS + 1) * 1000),
    })
    const token = mintCollabTokenV2({
      ...claims,
      tokenVersion: 2,
      readOnly: false,
    })

    jest.setSystemTime(verifierNow)

    expect(verifyCollabTokenV2(token)).toBeNull()
  })

  it('keeps v1 and v2 audiences and secrets mutually incompatible', () => {
    const v1Token = mintCollabToken(claims)
    const v2Token = mintCollabTokenV2({
      ...claims,
      tokenVersion: 2,
      readOnly: false,
    })

    expect(verifyCollabToken(v2Token)).toBeNull()
    expect(verifyCollabTokenV2(v1Token)).toBeNull()

    const forgedWithV1Secret = signJwt(
      { ...claims, tokenVersion: 2, readOnly: false },
      {
        audience: COLLAB_TOKEN_V2_AUDIENCE,
        secret: process.env.DOCUMENTS_COLLAB_JWT_SECRET,
        expiresInSec: COLLAB_TOKEN_TTL_SECONDS,
      },
    )
    expect(verifyCollabTokenV2(forgedWithV1Secret)).toBeNull()
  })

  it('fails closed when the distinct v2 secret is missing', () => {
    const token = mintCollabTokenV2({
      ...claims,
      tokenVersion: 2,
      readOnly: false,
    })
    delete process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2

    expect(isCollabTokenV2Ready()).toBe(false)
    expect(verifyCollabTokenV2(token)).toBeNull()
    expect(() => mintCollabTokenV2({
      ...claims,
      tokenVersion: 2,
      readOnly: false,
    })).toThrow('DOCUMENTS_COLLAB_JWT_SECRET_V2')
  })

  it('rejects weak v2 secrets for readiness, minting, and verification', () => {
    const token = mintCollabTokenV2({
      ...claims,
      tokenVersion: 2,
      readOnly: false,
    })
    process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = 'fewer-than-thirty-two-bytes'

    expect(isCollabTokenV2Ready()).toBe(false)
    expect(verifyCollabTokenV2(token)).toBeNull()
    expect(() => mintCollabTokenV2({
      ...claims,
      tokenVersion: 2,
      readOnly: false,
    })).toThrow(`at least ${COLLAB_TOKEN_V2_MIN_SECRET_BYTES} UTF-8 bytes`)
  })

  it('measures the v2 secret minimum in UTF-8 bytes', () => {
    process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = `${'a'.repeat(30)}é`

    expect(new TextEncoder().encode(process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2).byteLength).toBe(
      COLLAB_TOKEN_V2_MIN_SECRET_BYTES,
    )
    expect(isCollabTokenV2Ready()).toBe(true)
    const token = mintCollabTokenV2({
      ...claims,
      tokenVersion: 2,
      readOnly: false,
    })
    expect(verifyCollabTokenV2(token)).toMatchObject({ tokenVersion: 2, readOnly: false })

    process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = `${'a'.repeat(29)}é`
    expect(isCollabTokenV2Ready()).toBe(false)
  })

  it('rejects v2 payloads without the signed capability decision', () => {
    const token = signJwt(
      { ...claims, tokenVersion: 2 },
      {
        audience: COLLAB_TOKEN_V2_AUDIENCE,
        secret: process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2,
        expiresInSec: COLLAB_TOKEN_TTL_SECONDS,
      },
    )

    expect(verifyCollabTokenV2(token)).toBeNull()
  })

  it('rejects v2 tokens whose lifetime exceeds the hard maximum', () => {
    const token = signJwt(
      { ...claims, tokenVersion: 2, readOnly: false },
      {
        audience: COLLAB_TOKEN_V2_AUDIENCE,
        secret: process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2,
        expiresInSec: COLLAB_TOKEN_TTL_SECONDS + 1,
      },
    )

    expect(verifyCollabTokenV2(token)).toBeNull()
  })
})

describe('legacy verifier gating', () => {
  it('returns no verifier when DOCUMENTS_COLLAB_JWT_SECRET is unset', () => {
    expect(resolveLegacyCollabTokenVerifier({})).toBeNull()
  })

  it('returns no verifier when the explicit legacy secret is weaker than the v2 minimum', () => {
    expect(resolveLegacyCollabTokenVerifier({
      DOCUMENTS_COLLAB_JWT_SECRET: 'fewer-than-thirty-two-bytes',
    })).toBeNull()
  })

  it('returns the verifier only for an explicitly configured strong legacy secret', () => {
    expect(resolveLegacyCollabTokenVerifier({
      DOCUMENTS_COLLAB_JWT_SECRET: 'explicit-legacy-rollout-secret-32bytes!',
    })).toBe(verifyCollabToken)
  })
})
