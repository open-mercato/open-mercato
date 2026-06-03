import { requestOAuthToken, tokenResponseToExpiresAt } from '../oauth-token'

type FetchMock = jest.Mock<Promise<Partial<Response>>, [string, RequestInit?]>

function mockFetch(impl: (url: string, init?: RequestInit) => Partial<Response>): FetchMock {
  const fn = jest.fn(async (url: string, init?: RequestInit) => impl(url, init)) as unknown as FetchMock
  ;(globalThis as unknown as { fetch: unknown }).fetch = fn
  return fn
}

describe('requestOAuthToken', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    ;(globalThis as unknown as { fetch: unknown }).fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('returns the parsed token response on success', async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
    }))
    const body = await requestOAuthToken(
      'https://oauth.example/token',
      new URLSearchParams({ grant_type: 'refresh_token' }),
      { errorLabel: 'TestProvider token' },
    )
    expect(body.access_token).toBe('tok')
    expect(body.expires_in).toBe(3600)
  })

  it('throws a labelled error (not a raw SyntaxError) when the endpoint returns non-JSON', async () => {
    // A proxy/load-balancer 502 often returns an HTML error page. The old
    // `res.json()` path threw a SyntaxError that masked the real status.
    mockFetch(() => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => '<html><body>502 Bad Gateway</body></html>',
    }))
    await expect(
      requestOAuthToken('https://oauth.example/token', new URLSearchParams(), {
        errorLabel: 'TestProvider token',
      }),
    ).rejects.toThrow(/TestProvider token/)
    await expect(
      requestOAuthToken('https://oauth.example/token', new URLSearchParams(), {
        errorLabel: 'TestProvider token',
      }),
    ).rejects.toThrow(/502/)
  })

  it('throws a labelled error when the JSON body carries an OAuth error', async () => {
    mockFetch(() => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }),
    }))
    await expect(
      requestOAuthToken('https://oauth.example/token', new URLSearchParams(), {
        errorLabel: 'TestProvider token',
      }),
    ).rejects.toThrow(/TestProvider token: expired/)
  })
})

describe('tokenResponseToExpiresAt', () => {
  it('computes the absolute expiry from expires_in', () => {
    const at = tokenResponseToExpiresAt({ access_token: 'x', expires_in: 100 }, 1_000)
    expect(at?.getTime()).toBe(1_000 + 100_000)
  })

  it('returns undefined when expires_in is absent', () => {
    expect(tokenResponseToExpiresAt({ access_token: 'x' })).toBeUndefined()
  })
})
