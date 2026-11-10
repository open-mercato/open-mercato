/** @jest-environment node */
import {
  OAUTH_GRANT_BLOB_VERSION,
  oauthGrantLockKey,
  oauthGrantRowId,
  parseOAuthGrantBlob,
  serializeOAuthGrantBlob,
  type OAuthGrantRecord,
} from '../grant-blob'

const OBTAINED_AT = new Date('2026-10-01T10:00:00.000Z')

function activeGrant(overrides: Partial<OAuthGrantRecord> = {}): OAuthGrantRecord {
  return {
    status: 'active',
    invalidatedReason: null,
    invalidatedAt: null,
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    expiresAt: new Date('2026-10-01T11:00:00.000Z'),
    tokenType: 'Bearer',
    clientId: 'client-1',
    grantedScopes: ['read', 'write'],
    obtainedAt: OBTAINED_AT,
    refreshedAt: null,
    refreshCount: 0,
    revisedAt: OBTAINED_AT,
    lastFailureClass: null,
    lastFailureAt: null,
    lastFailureProviderErrorCode: null,
    providerData: null,
    previousProviderData: { externalAccountId: 'acct-1' },
    ...overrides,
  }
}

describe('grant row and lock key formats', () => {
  it('pins the Grant Lock key of a tenant-level owner (A10)', () => {
    const owner = {
      integrationId: 'test_oauth_grant',
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
    }

    expect(oauthGrantLockKey(owner)).toBe(
      'oauth_grant:test_oauth_grant:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:-',
    )
    expect(oauthGrantLockKey({ ...owner, userId: null })).toBe(oauthGrantLockKey(owner))
  })

  it('pins the grant row id', () => {
    expect(oauthGrantRowId('test_oauth_grant')).toBe('test_oauth_grant__oauth_grant')
  })
})

describe('grant blob encoding', () => {
  it('round-trips an active grant with ISO-8601 UTC datetimes', () => {
    const grant = activeGrant({ refreshedAt: new Date('2026-10-01T10:30:00.000Z'), refreshCount: 2 })

    const blob = serializeOAuthGrantBlob(grant)

    expect(blob).toMatchObject({
      version: OAUTH_GRANT_BLOB_VERSION,
      status: 'active',
      expiresAt: '2026-10-01T11:00:00.000Z',
      refreshedAt: '2026-10-01T10:30:00.000Z',
    })
    expect(blob).not.toHaveProperty('invalidatedReason')
    expect(parseOAuthGrantBlob(blob)).toEqual(grant)
  })

  it('round-trips an invalidated grant and requires its reason and time', () => {
    const grant = activeGrant({
      status: 'invalidated',
      invalidatedReason: 'grant_rejected',
      invalidatedAt: new Date('2026-10-02T00:00:00.000Z'),
    })
    const blob = serializeOAuthGrantBlob(grant)

    expect(parseOAuthGrantBlob(blob)).toEqual(grant)
    const withoutReason = { ...blob }
    delete withoutReason.invalidatedReason
    expect(parseOAuthGrantBlob(withoutReason)).toBeNull()
  })

  it('round-trips the provider error code of a client_misconfigured diagnosis', () => {
    const grant = activeGrant({
      lastFailureClass: 'client_misconfigured',
      lastFailureAt: new Date('2026-10-01T10:45:00.000Z'),
      lastFailureProviderErrorCode: 'invalid_scope',
    })

    expect(parseOAuthGrantBlob(serializeOAuthGrantBlob(grant))).toEqual(grant)
  })

  it('accepts a missing refresh token and missing optional fields, and strips unknown keys', () => {
    const parsed = parseOAuthGrantBlob({
      version: 1,
      status: 'active',
      accessToken: 'access-token-value',
      expiresAt: '2026-10-01T11:00:00.000Z',
      tokenType: 'Bearer',
      clientId: 'client-1',
      obtainedAt: '2026-10-01T10:00:00.000Z',
      refreshCount: 0,
      revisedAt: '2026-10-01T10:00:00.000Z',
      unexpected: 'dropped',
    })

    expect(parsed).toMatchObject({
      refreshToken: null,
      grantedScopes: [],
      lastFailureProviderErrorCode: null,
      providerData: null,
      previousProviderData: null,
    })
    expect(parsed).not.toHaveProperty('unexpected')
  })

  it.each([
    ['an empty object', {}],
    ['a future version', { ...serializeOAuthGrantBlob(activeGrant()), version: OAUTH_GRANT_BLOB_VERSION + 1 }],
    ['a missing access token', { ...serializeOAuthGrantBlob(activeGrant()), accessToken: '' }],
    ['a non-UTC datetime', { ...serializeOAuthGrantBlob(activeGrant()), expiresAt: '2026-10-01 11:00' }],
    ['an unknown status', { ...serializeOAuthGrantBlob(activeGrant()), status: 'revoked' }],
  ])('rejects %s', (_label, value) => {
    expect(parseOAuthGrantBlob(value)).toBeNull()
  })
})
