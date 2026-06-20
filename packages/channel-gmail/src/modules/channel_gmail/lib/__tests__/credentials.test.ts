import {
  gmailClientCredentialsSchema,
  gmailUserCredentialsSchema,
  gmailChannelStateSchema,
  GMAIL_DEFAULT_SCOPES,
  parseScopes,
} from '../credentials'

describe('gmailClientCredentialsSchema', () => {
  it('accepts a fully populated tenant OAuth client config', () => {
    expect(
      gmailClientCredentialsSchema.parse({
        clientId: '1234.apps.googleusercontent.com',
        clientSecret: 'secret',
        scopes: 'https://www.googleapis.com/auth/gmail.modify',
      }),
    ).toMatchObject({ clientId: '1234.apps.googleusercontent.com', clientSecret: 'secret' })
  })

  it('rejects missing required fields', () => {
    expect(() => gmailClientCredentialsSchema.parse({ clientId: '', clientSecret: 'x' })).toThrow(/OAuth Client ID/i)
    expect(() => gmailClientCredentialsSchema.parse({ clientId: 'a', clientSecret: '' })).toThrow(/OAuth Client Secret/i)
  })
})

describe('gmailUserCredentialsSchema', () => {
  it('accepts an access+refresh token pair', () => {
    expect(
      gmailUserCredentialsSchema.parse({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-05-26T10:00:00.000Z',
        scopes: ['https://www.googleapis.com/auth/gmail.modify'],
        email: 'alice@gmail.com',
      }),
    ).toMatchObject({ accessToken: 'a', refreshToken: 'r', email: 'alice@gmail.com' })
  })

  it('treats refresh token as optional but access token as required', () => {
    expect(gmailUserCredentialsSchema.parse({ accessToken: 'a' })).toMatchObject({ accessToken: 'a' })
    expect(() => gmailUserCredentialsSchema.parse({ refreshToken: 'r' })).toThrow(/Access token/i)
  })

  it('rejects invalid expiresAt format', () => {
    expect(() => gmailUserCredentialsSchema.parse({ accessToken: 'a', expiresAt: 'soon' })).toThrow()
  })

  it('rejects non-email email', () => {
    expect(() => gmailUserCredentialsSchema.parse({ accessToken: 'a', email: 'not-an-email' })).toThrow()
  })
})

describe('gmailChannelStateSchema', () => {
  it('accepts a numeric or string historyId', () => {
    expect(gmailChannelStateSchema.parse({ historyId: 12345 })).toMatchObject({ historyId: 12345 })
    expect(gmailChannelStateSchema.parse({ historyId: '12345' })).toMatchObject({ historyId: '12345' })
  })

  it('accepts an empty state', () => {
    expect(gmailChannelStateSchema.parse({})).toEqual({})
  })
})

describe('parseScopes', () => {
  it('returns Gmail defaults when input is blank or undefined', () => {
    expect(parseScopes(undefined)).toEqual(GMAIL_DEFAULT_SCOPES)
    expect(parseScopes('')).toEqual(GMAIL_DEFAULT_SCOPES)
    expect(parseScopes('   ')).toEqual(GMAIL_DEFAULT_SCOPES)
  })

  it('splits comma and whitespace separated scope lists', () => {
    expect(parseScopes('a,b,c')).toEqual(['a', 'b', 'c'])
    expect(parseScopes('a b c')).toEqual(['a', 'b', 'c'])
    expect(parseScopes('a, b,  c\n d')).toEqual(['a', 'b', 'c', 'd'])
  })
})
