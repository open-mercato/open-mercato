import {
  microsoftClientCredentialsSchema,
  microsoftUserCredentialsSchema,
  microsoftChannelStateSchema,
  MICROSOFT_DEFAULT_SCOPES,
  parseScopes,
  resolveAuthority,
} from '../credentials'

describe('microsoftClientCredentialsSchema', () => {
  it('accepts a fully populated tenant config (clientId + tenantId + optional secret)', () => {
    expect(
      microsoftClientCredentialsSchema.parse({
        clientId: 'guid-abc',
        tenantId: 'common',
        clientSecret: 'secret',
      }),
    ).toMatchObject({ clientId: 'guid-abc', tenantId: 'common', clientSecret: 'secret' })
  })

  it('treats tenantId / clientSecret as optional (public PKCE client)', () => {
    expect(microsoftClientCredentialsSchema.parse({ clientId: 'guid-abc' })).toMatchObject({
      clientId: 'guid-abc',
    })
  })

  it('rejects empty clientId', () => {
    expect(() => microsoftClientCredentialsSchema.parse({ clientId: '' })).toThrow(/OAuth Client ID/i)
  })
})

describe('microsoftUserCredentialsSchema', () => {
  it('accepts tokens + optional email/oid', () => {
    expect(
      microsoftUserCredentialsSchema.parse({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-05-26T10:00:00.000Z',
        scopes: ['Mail.Read'],
        email: 'alice@outlook.com',
        oid: 'guid-user',
      }),
    ).toMatchObject({ accessToken: 'a', refreshToken: 'r', oid: 'guid-user' })
  })

  it('allows passthrough fields (e.g. internal _client during refresh)', () => {
    const parsed = microsoftUserCredentialsSchema.parse({
      accessToken: 'a',
      _client: { clientId: 'guid', tenantId: 'common' },
    })
    expect(parsed.accessToken).toBe('a')
  })

  it('requires accessToken', () => {
    expect(() => microsoftUserCredentialsSchema.parse({})).toThrow(/access token/i)
  })

  it('rejects non-email email', () => {
    expect(() => microsoftUserCredentialsSchema.parse({ accessToken: 'a', email: 'no-at' })).toThrow()
  })
})

describe('microsoftChannelStateSchema', () => {
  it('accepts a deltaLink URL', () => {
    expect(
      microsoftChannelStateSchema.parse({
        deltaLink: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
      }),
    ).toMatchObject({ deltaLink: expect.stringContaining('delta') })
  })

  it('rejects malformed deltaLink', () => {
    expect(() => microsoftChannelStateSchema.parse({ deltaLink: 'not-a-url' })).toThrow()
  })
})

describe('parseScopes', () => {
  it('falls back to MICROSOFT_DEFAULT_SCOPES when blank', () => {
    expect(parseScopes(undefined)).toEqual(MICROSOFT_DEFAULT_SCOPES)
    expect(parseScopes('')).toEqual(MICROSOFT_DEFAULT_SCOPES)
  })

  it('splits space-separated scopes', () => {
    expect(parseScopes('Mail.Read Mail.Send')).toEqual(['Mail.Read', 'Mail.Send'])
  })
})

describe('resolveAuthority', () => {
  it('defaults to "common" when blank', () => {
    expect(resolveAuthority(undefined)).toBe('common')
    expect(resolveAuthority('')).toBe('common')
    expect(resolveAuthority('   ')).toBe('common')
  })

  it('passes through a tenant guid or named authority', () => {
    expect(resolveAuthority('organizations')).toBe('organizations')
    expect(resolveAuthority('00000000-0000-0000-0000-000000000000')).toBe('00000000-0000-0000-0000-000000000000')
  })
})
