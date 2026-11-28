import {
  MS365_DEFAULT_GRAPH_BASE_URL,
  MS365_DEFAULT_LOGIN_BASE_URL,
  buildAuthorizeEndpoint,
  buildTokenEndpoint,
  decodeIdTokenClaims,
  derivePkceChallenge,
  generatePkcePair,
  getMicrosoftOAuthClient,
  resolveGraphBaseUrl,
  resolveLoginBaseUrl,
  setMicrosoftOAuthClient,
} from '../oauth'

afterEach(() => {
  setMicrosoftOAuthClient(null)
  delete process.env.OM_CHANNEL_MS365_LOGIN_BASE_URL
  delete process.env.OM_CHANNEL_MS365_GRAPH_BASE_URL
})

describe('authority + base URL resolution', () => {
  it('builds v2.0 endpoints under the configured tenant segment', () => {
    expect(buildAuthorizeEndpoint('organizations')).toBe(`${MS365_DEFAULT_LOGIN_BASE_URL}/organizations/oauth2/v2.0/authorize`)
    expect(buildTokenEndpoint('contoso.onmicrosoft.com')).toBe(`${MS365_DEFAULT_LOGIN_BASE_URL}/contoso.onmicrosoft.com/oauth2/v2.0/token`)
  })

  it('honours sovereign-cloud overrides only when they are https origins', () => {
    process.env.OM_CHANNEL_MS365_LOGIN_BASE_URL = 'https://login.microsoftonline.us/'
    expect(resolveLoginBaseUrl()).toBe('https://login.microsoftonline.us')
    process.env.OM_CHANNEL_MS365_LOGIN_BASE_URL = 'http://evil.example.com'
    expect(resolveLoginBaseUrl()).toBe(MS365_DEFAULT_LOGIN_BASE_URL)
    process.env.OM_CHANNEL_MS365_GRAPH_BASE_URL = 'https://graph.microsoft.us/v1.0/'
    expect(resolveGraphBaseUrl()).toBe('https://graph.microsoft.us/v1.0')
    process.env.OM_CHANNEL_MS365_GRAPH_BASE_URL = 'ftp://nope'
    expect(resolveGraphBaseUrl()).toBe(MS365_DEFAULT_GRAPH_BASE_URL)
  })
})

describe('PKCE', () => {
  it('generates an RFC 7636 verifier and a matching S256 challenge', () => {
    const pair = generatePkcePair()
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pair.verifier.length).toBeLessThanOrEqual(128)
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.challenge).toBe(derivePkceChallenge(pair.verifier))
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('derives the documented challenge for the RFC 7636 appendix B verifier', () => {
    expect(derivePkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('buildAuthorizeUrl', () => {
  it('builds an Entra v2.0 authorize URL with PKCE and select_account', () => {
    const url = new URL(
      getMicrosoftOAuthClient().buildAuthorizeUrl({
        clientId: 'cid',
        tenantId: 'organizations',
        redirectUri: 'https://example.com/cb',
        state: 'state-123',
        scopes: ['offline_access', 'https://graph.microsoft.com/Mail.ReadWrite'],
        codeChallenge: 'challenge',
        loginHint: 'alice@contoso.com',
      }),
    )
    expect(url.origin + url.pathname).toBe(buildAuthorizeEndpoint('organizations'))
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/cb')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('response_mode')).toBe('query')
    expect(url.searchParams.get('state')).toBe('state-123')
    expect(url.searchParams.get('scope')).toBe('offline_access https://graph.microsoft.com/Mail.ReadWrite')
    expect(url.searchParams.get('code_challenge')).toBe('challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('prompt')).toBe('select_account')
    expect(url.searchParams.get('login_hint')).toBe('alice@contoso.com')
  })

  it('falls back to the default scopes when none are given', () => {
    const url = new URL(
      getMicrosoftOAuthClient().buildAuthorizeUrl({
        clientId: 'cid',
        tenantId: 'common',
        redirectUri: 'https://example.com/cb',
        state: 's',
        scopes: [],
        codeChallenge: 'c',
      }),
    )
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('scope')).toContain('Mail.Send')
  })
})

describe('exchangeCode + refreshToken (transport-level)', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function captureFetch(body: Record<string, unknown>) {
    const captured: { url?: string; body?: string; method?: string } = {}
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured.url = String(url)
      captured.method = init?.method
      captured.body = typeof init?.body === 'string' ? init.body : ''
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as unknown as Response
    }) as typeof fetch
    return captured
  }

  it('POSTs the authorization code with the PKCE verifier to the tenant token endpoint', async () => {
    const captured = captureFetch({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: 'x.y.z' })
    const token = await getMicrosoftOAuthClient().exchangeCode({
      clientId: 'cid',
      clientSecret: 'sec',
      tenantId: 'organizations',
      redirectUri: 'https://example.com/cb',
      code: 'the-code',
      codeVerifier: 'verifier',
      scopes: ['offline_access', 'openid'],
    })
    expect(captured.url).toBe(buildTokenEndpoint('organizations'))
    expect(captured.method).toBe('POST')
    const params = new URLSearchParams(captured.body)
    expect(params.get('grant_type')).toBe('authorization_code')
    expect(params.get('code')).toBe('the-code')
    expect(params.get('code_verifier')).toBe('verifier')
    expect(params.get('client_secret')).toBe('sec')
    expect(params.get('scope')).toBe('offline_access openid')
    expect(token.access_token).toBe('at')
    expect(token.refresh_token).toBe('rt')
  })

  it('refreshes against the user home tenant with the rotated token response', async () => {
    const captured = captureFetch({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 })
    const token = await getMicrosoftOAuthClient().refreshToken({
      clientId: 'cid',
      clientSecret: 'sec',
      tenantId: '0f3a1c2e-1111-2222-3333-444455556666',
      refreshToken: 'rt1',
      scopes: ['offline_access'],
    })
    expect(captured.url).toBe(buildTokenEndpoint('0f3a1c2e-1111-2222-3333-444455556666'))
    const params = new URLSearchParams(captured.body)
    expect(params.get('grant_type')).toBe('refresh_token')
    expect(params.get('refresh_token')).toBe('rt1')
    expect(token.refresh_token).toBe('rt2')
  })

  it('fetches the Graph profile with a bearer token', async () => {
    const captured = captureFetch({ mail: 'Alice@Contoso.com', userPrincipalName: 'alice@contoso.com', displayName: 'Alice' })
    const profile = await getMicrosoftOAuthClient().fetchProfile('at')
    expect(captured.url).toContain(`${MS365_DEFAULT_GRAPH_BASE_URL}/me`)
    expect(profile.mail).toBe('Alice@Contoso.com')
    expect(profile.displayName).toBe('Alice')
  })
})

describe('decodeIdTokenClaims', () => {
  function fakeJwt(payload: Record<string, unknown>): string {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
  }

  it('extracts the identity claims without verifying the signature', () => {
    const claims = decodeIdTokenClaims(fakeJwt({ preferred_username: 'alice@contoso.com', name: 'Alice', tid: 'tenant-guid', oid: 'oid-1', aud: 'cid' }))
    expect(claims).toEqual({ preferred_username: 'alice@contoso.com', email: undefined, name: 'Alice', tid: 'tenant-guid', oid: 'oid-1' })
  })

  it('returns null for missing or malformed tokens', () => {
    expect(decodeIdTokenClaims(undefined)).toBeNull()
    expect(decodeIdTokenClaims('not-a-jwt')).toBeNull()
    expect(decodeIdTokenClaims('a.!!!.c')).toBeNull()
  })
})
