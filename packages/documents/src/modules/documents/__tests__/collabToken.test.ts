import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import {
  COLLAB_TOKEN_AUDIENCE,
  mintCollabToken,
  verifyCollabToken,
  type CollabTokenClaims,
} from '../lib/collabToken'

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
})
