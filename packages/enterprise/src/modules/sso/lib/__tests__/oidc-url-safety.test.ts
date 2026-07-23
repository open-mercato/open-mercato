import {
  createOidcFetch,
  getPrivateOidcOriginAllowlist,
  OidcResponseTooLargeError,
} from '../oidc-url-safety'

const requestOptions = {
  body: undefined,
  headers: {},
  method: 'GET',
  redirect: 'manual' as const,
}

describe('OIDC outbound request safety', () => {
  test('normalizes only exact HTTPS origins from the operator allowlist', () => {
    expect(
      getPrivateOidcOriginAllowlist(
        'https://idp.internal:8443, https://login.example.com/, http://unsafe.internal, invalid',
      ),
    ).toEqual(new Set(['https://idp.internal:8443', 'https://login.example.com']))
  })

  test('rejects private and metadata IP literals before opening a socket', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch
    const guardedFetch = createOidcFetch({ fetchImpl })

    await expect(
      guardedFetch('https://169.254.169.254/latest/meta-data/', requestOptions),
    ).rejects.toMatchObject({ reason: 'private_ip_literal' })
    await expect(guardedFetch('https://[::1]/jwks', requestOptions)).rejects.toMatchObject({
      reason: 'private_ip_literal',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('rejects mixed public and private DNS answers before opening a socket', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch
    const guardedFetch = createOidcFetch({
      fetchImpl,
      lookupHost: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ],
    })

    await expect(guardedFetch('https://mixed.example/jwks', requestOptions)).rejects.toMatchObject({
      reason: 'private_ip_resolved',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('validates discovery, JWKS, token, and user-info destinations independently', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}')) as unknown as typeof fetch
    const lookupHost = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const guardedFetch = createOidcFetch({ fetchImpl, lookupHost })

    for (const url of [
      'https://idp.example/.well-known/openid-configuration',
      'https://keys.example/jwks',
      'https://tokens.example/token',
      'https://profile.example/userinfo',
    ]) {
      await guardedFetch(url, requestOptions)
    }

    expect(lookupHost).toHaveBeenCalledTimes(4)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  test('allows an exact operator-approved private origin but not a different port', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}')) as unknown as typeof fetch
    const lookupHost = jest.fn(async () => [{ address: '10.0.0.5', family: 4 }])
    const guardedFetch = createOidcFetch({
      fetchImpl,
      lookupHost,
      privateOriginAllowlist: new Set(['https://idp.internal:8443']),
    })

    await expect(
      guardedFetch('https://idp.internal:8443/token', requestOptions),
    ).resolves.toBeInstanceOf(Response)
    await expect(
      guardedFetch('https://idp.internal:9443/token', requestOptions),
    ).rejects.toMatchObject({ reason: 'private_ip_resolved' })
    expect(lookupHost).toHaveBeenCalledTimes(1)
    expect(lookupHost).toHaveBeenNthCalledWith(1, 'idp.internal')
  })

  test('does not follow redirects automatically', async () => {
    const fetchImpl = jest.fn(async () => new Response(null, { status: 302 })) as unknown as typeof fetch
    const guardedFetch = createOidcFetch({
      fetchImpl,
      lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
    })

    const response = await guardedFetch('https://idp.example/token', requestOptions)

    expect(response.status).toBe(302)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://idp.example/token',
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  test('rejects allowlisted HTTP origins', async () => {
    const guardedFetch = createOidcFetch({
      privateOriginAllowlist: new Set(['http://idp.internal']),
      fetchImpl: jest.fn() as unknown as typeof fetch,
    })

    await expect(guardedFetch('http://idp.internal/token', requestOptions)).rejects.toMatchObject({
      reason: 'forbidden_protocol',
    })
  })

  test('rejects oversized responses from content-length and streamed bytes', async () => {
    const contentLengthFetch = jest.fn(async () =>
      new Response('0123456789', { headers: { 'content-length': '10' } }),
    ) as unknown as typeof fetch
    const streamedFetch = jest.fn(async () => new Response('0123456789')) as unknown as typeof fetch
    const lookupHost = async () => [{ address: '93.184.216.34', family: 4 as const }]

    await expect(
      createOidcFetch({ fetchImpl: contentLengthFetch, lookupHost, maxResponseBytes: 8 })(
        'https://idp.example/discovery',
        requestOptions,
      ),
    ).rejects.toBeInstanceOf(OidcResponseTooLargeError)
    await expect(
      createOidcFetch({ fetchImpl: streamedFetch, lookupHost, maxResponseBytes: 8 })(
        'https://idp.example/jwks',
        requestOptions,
      ),
    ).rejects.toBeInstanceOf(OidcResponseTooLargeError)
  })
})
