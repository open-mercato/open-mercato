import {
  MICROSOFT_AUTHORITY_BASE,
  decodeIdTokenClaims,
  generatePkcePair,
  getMicrosoftOAuthClient,
  setMicrosoftOAuthClient,
  tokenResponseToExpiresAt,
} from '../oauth'

afterEach(() => setMicrosoftOAuthClient(null))

describe('buildAuthorizeUrl', () => {
  it('targets the tenant-scoped /authorize endpoint with PKCE + state', () => {
    const url = new URL(
      getMicrosoftOAuthClient().buildAuthorizeUrl({
        clientId: 'cid',
        tenantId: 'common',
        redirectUri: 'https://example.com/cb',
        state: 'state-1',
        scopes: ['Mail.Read', 'Mail.Send'],
        codeChallenge: 'challenge-abc',
      }),
    )
    expect(url.origin + url.pathname).toBe(`${MICROSOFT_AUTHORITY_BASE}/common/oauth2/v2.0/authorize`)
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('response_mode')).toBe('query')
    expect(url.searchParams.get('scope')).toBe('Mail.Read Mail.Send')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('honors tenant GUIDs and personal-only authority "consumers"', () => {
    const url = new URL(
      getMicrosoftOAuthClient().buildAuthorizeUrl({
        clientId: 'cid',
        tenantId: 'consumers',
        redirectUri: 'https://example.com/cb',
        state: 's',
        scopes: ['Mail.Read'],
        codeChallenge: 'c',
      }),
    )
    expect(url.pathname.startsWith('/consumers/')).toBe(true)
  })

  it('defaults to /common when tenantId is missing', () => {
    const url = new URL(
      getMicrosoftOAuthClient().buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://example.com/cb',
        state: 's',
        scopes: ['Mail.Read'],
        codeChallenge: 'c',
      }),
    )
    expect(url.pathname.startsWith('/common/')).toBe(true)
  })
})

describe('exchangeCode + refreshToken (transport)', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('exchangeCode posts code_verifier and parses tokens', async () => {
    let body = ''
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      body = typeof init?.body === 'string' ? init.body : ''
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'Mail.Read', token_type: 'Bearer' }),
      } as unknown as Response)
    }) as unknown as typeof globalThis.fetch
    const token = await getMicrosoftOAuthClient().exchangeCode({
      clientId: 'cid',
      tenantId: 'common',
      redirectUri: 'https://example.com/cb',
      code: 'code-1',
      codeVerifier: 'verifier',
    })
    expect(token.access_token).toBe('a')
    expect(body).toContain('code_verifier=verifier')
    expect(body).toContain('grant_type=authorization_code')
  })

  it('refreshToken throws when Graph returns an error payload', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () =>
          JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS70008: refresh token expired' }),
      } as unknown as Response)) as unknown as typeof globalThis.fetch
    await expect(
      getMicrosoftOAuthClient().refreshToken({ clientId: 'cid', tenantId: 'common', refreshToken: 'r' }),
    ).rejects.toThrow(/refresh token expired/i)
  })
})

describe('generatePkcePair', () => {
  it('produces base64url-encoded verifier + challenge', () => {
    const pair = generatePkcePair()
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.codeVerifier).not.toContain('=')
    expect(pair.codeChallenge).not.toContain('=')
  })

  it('yields a different pair each call', () => {
    const a = generatePkcePair()
    const b = generatePkcePair()
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
  })
})

describe('decodeIdTokenClaims', () => {
  it('extracts email + oid + name from a JWT payload', () => {
    const payload = {
      email: 'alice@outlook.com',
      oid: 'guid-user',
      name: 'Alice',
      preferred_username: 'alice@outlook.com',
    }
    const token = `header.${Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=+$/, '')}.sig`
    expect(decodeIdTokenClaims(token)).toMatchObject({ email: 'alice@outlook.com', oid: 'guid-user', name: 'Alice' })
  })

  it('falls back to preferred_username when email is missing', () => {
    const payload = { preferred_username: 'bob@contoso.com' }
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=+$/, '')}.s`
    expect(decodeIdTokenClaims(token).email).toBe('bob@contoso.com')
  })

  it('returns {} for missing or unparseable tokens', () => {
    expect(decodeIdTokenClaims(undefined)).toEqual({})
    expect(decodeIdTokenClaims('not.a.jwt')).toEqual({})
  })
})

describe('tokenResponseToExpiresAt', () => {
  it('produces an absolute date from expires_in seconds', () => {
    expect(tokenResponseToExpiresAt({ access_token: 'a', expires_in: 30 }, 1_000_000)?.getTime()).toBe(1_030_000)
  })
})
