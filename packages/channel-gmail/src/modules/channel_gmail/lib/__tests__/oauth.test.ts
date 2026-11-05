import {
  GMAIL_OAUTH_AUTHORIZE_URL,
  GMAIL_OAUTH_TOKEN_URL,
  GMAIL_OAUTH_USERINFO_URL,
  getGoogleOAuthClient,
  setGoogleOAuthClient,
  tokenResponseToExpiresAt,
} from '../oauth'

afterEach(() => setGoogleOAuthClient(null))

describe('buildAuthorizeUrl', () => {
  it('builds a Google OAuth2 URL with all required params', () => {
    const url = new URL(
      getGoogleOAuthClient().buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://example.com/cb',
        state: 'state-123',
        scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      }),
    )
    expect(url.origin + url.pathname).toBe(GMAIL_OAUTH_AUTHORIZE_URL)
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/cb')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('state-123')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.modify')
  })

  it('includes login_hint when provided', () => {
    const url = new URL(
      getGoogleOAuthClient().buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://example.com/cb',
        state: 's',
        scopes: ['scope'],
        loginHint: 'alice@example.com',
      }),
    )
    expect(url.searchParams.get('login_hint')).toBe('alice@example.com')
  })

  it('falls back to default scopes when scopes is empty', () => {
    const url = new URL(
      getGoogleOAuthClient().buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://example.com/cb',
        state: 's',
        scopes: [],
      }),
    )
    expect(url.searchParams.get('scope')).toContain('gmail.modify')
  })
})

describe('exchangeCode + refreshToken (transport-level)', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('POSTs form-encoded params and parses the token response', async () => {
    const captured: { url?: string; body?: string; headers?: Record<string, string> } = {}
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      captured.url = url
      captured.body = typeof init?.body === 'string' ? init.body : ''
      captured.headers = init?.headers as Record<string, string>
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            access_token: 'access',
            refresh_token: 'refresh',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/gmail.modify',
            token_type: 'Bearer',
          }),
      } as unknown as Response)
    }) as unknown as typeof globalThis.fetch
    const token = await getGoogleOAuthClient().exchangeCode({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://example.com/cb',
      code: 'code123',
    })
    expect(captured.url).toBe(GMAIL_OAUTH_TOKEN_URL)
    expect(captured.body).toContain('grant_type=authorization_code')
    expect(captured.body).toContain('code=code123')
    expect(captured.body).toContain('client_id=cid')
    expect(captured.body).toContain('client_secret=secret')
    expect(token.access_token).toBe('access')
    expect(token.refresh_token).toBe('refresh')
  })

  it('throws when token endpoint responds with error', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => JSON.stringify({ error: 'invalid_grant', error_description: 'Token expired' }),
      } as unknown as Response)) as unknown as typeof globalThis.fetch
    await expect(
      getGoogleOAuthClient().refreshToken({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
    ).rejects.toThrow(/Token expired|invalid_grant/i)
  })
})

describe('fetchUserInfo', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })
  it('GETs the userinfo endpoint with Bearer auth and parses the response', async () => {
    const captured: { url?: string; headers?: Record<string, string> } = {}
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      captured.url = url
      captured.headers = init?.headers as Record<string, string>
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ sub: 'g-123', email: 'alice@gmail.com', name: 'Alice' }),
      } as unknown as Response)
    }) as unknown as typeof globalThis.fetch
    const info = await getGoogleOAuthClient().fetchUserInfo('access')
    expect(captured.url).toBe(GMAIL_OAUTH_USERINFO_URL)
    expect(captured.headers?.Authorization).toBe('Bearer access')
    expect(info.email).toBe('alice@gmail.com')
  })
})

describe('tokenResponseToExpiresAt', () => {
  it('returns the absolute expiry derived from expires_in seconds', () => {
    const t = tokenResponseToExpiresAt({ access_token: 'x', expires_in: 60 }, 1_700_000_000_000)
    expect(t).toBeInstanceOf(Date)
    expect(t!.getTime()).toBe(1_700_000_060_000)
  })

  it('returns undefined when expires_in missing', () => {
    expect(tokenResponseToExpiresAt({ access_token: 'x' })).toBeUndefined()
  })
})
