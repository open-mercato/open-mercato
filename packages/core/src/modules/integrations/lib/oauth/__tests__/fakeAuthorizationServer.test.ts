/** @jest-environment node */
import { inspect } from 'node:util'
import { buildAuthorizationUrl, exchangeAuthorizationCode } from '../authorization'
import { OAuthGrantError, type OAuthProviderDescriptor } from '../descriptor'
import { createPkcePair } from '../pkce'
import {
  startFakeAuthorizationServer,
  type FakeAuthorizationServer,
  type FakeAuthorizationServerOptions,
} from '../testing/fakeAuthorizationServer'
import {
  OAUTH_RESPONSE_MAX_BYTES,
  OAuthTokenEndpointError,
  requestTokenEndpoint,
  revokeToken,
  type OAuthClientAuthMethod,
  type OAuthClientCredentials,
  type OAuthTokenEndpointResponse,
} from '../token-endpoint'

const REDIRECT_URI = 'https://app.acme.test/api/acme/oauth/callback'
const ACCESS_TOKEN_PATTERN = /^fake_at_[0-9a-f]{64}$/
const REFRESH_TOKEN_PATTERN = /^fake_rt_[0-9a-f]{64}$/

const servers: FakeAuthorizationServer[] = []

async function start(options: Partial<FakeAuthorizationServerOptions> = {}): Promise<FakeAuthorizationServer> {
  const server = await startFakeAuthorizationServer({ rotation: 'strict', ...options })
  servers.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

function credentialsOf(server: FakeAuthorizationServer, authMethod: OAuthClientAuthMethod = 'client_secret_basic'): OAuthClientCredentials {
  return { clientId: server.clientId, clientSecret: server.clientSecret, authMethod }
}

function descriptorOf(server: FakeAuthorizationServer, overrides: Partial<OAuthProviderDescriptor> = {}): OAuthProviderDescriptor {
  return {
    integrationId: 'fake_provider',
    authorizationEndpoint: server.authorizationEndpoint,
    tokenEndpoint: server.tokenEndpoint,
    ...(server.revocationEndpoint ? { revocationEndpoint: server.revocationEndpoint } : {}),
    defaultScopes: ['read'],
    ...overrides,
  }
}

async function connect(
  server: FakeAuthorizationServer,
  options: { scope?: readonly string[]; authMethod?: OAuthClientAuthMethod } = {},
): Promise<OAuthTokenEndpointResponse> {
  const pkce = createPkcePair()
  const code = server.issueAuthorizationCode({ redirectUri: REDIRECT_URI, scope: options.scope, codeChallenge: pkce.codeChallenge })
  return exchangeAuthorizationCode(
    descriptorOf(server, { clientAuthMethod: options.authMethod ?? 'client_secret_basic' }),
    { clientId: server.clientId, clientSecret: server.clientSecret },
    { code, redirectUri: REDIRECT_URI, codeVerifier: pkce.codeVerifier },
  )
}

function refresh(server: FakeAuthorizationServer, refreshToken: string, timeoutMs?: number): Promise<OAuthTokenEndpointResponse> {
  return requestTokenEndpoint({
    url: server.tokenEndpoint,
    client: credentialsOf(server),
    params: { grant_type: 'refresh_token', refresh_token: refreshToken },
    timeoutMs,
  })
}

function requireRefreshToken(tokens: OAuthTokenEndpointResponse): string {
  if (tokens.refreshToken === null) throw new Error('[internal] expected a refresh token')
  return tokens.refreshToken
}

async function captureTokenError(promise: Promise<unknown>): Promise<OAuthTokenEndpointError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OAuthTokenEndpointError) return error
    throw error
  }
  throw new Error('[internal] expected the call to fail')
}

async function captureGrantError(promise: Promise<unknown>): Promise<OAuthGrantError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OAuthGrantError) return error
    throw error
  }
  throw new Error('[internal] expected the call to fail')
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('startFakeAuthorizationServer', () => {
  it('binds a loopback port and publishes its endpoints', async () => {
    const server = await start()

    for (const [endpoint, path] of [
      [server.authorizationEndpoint, '/authorize'],
      [server.tokenEndpoint, '/token'],
      [server.revocationEndpoint, '/revoke'],
    ] as const) {
      const url = new URL(endpoint ?? '')
      expect(url.protocol).toBe('http:')
      expect(url.hostname).toBe('127.0.0.1')
      expect(Number(url.port)).toBeGreaterThan(0)
      expect(url.pathname).toBe(path)
    }
  })

  it('generates random client credentials per server and honours given ones', async () => {
    const first = await start()
    const second = await start()
    const fixed = await start({ clientId: 'acme-client', clientSecret: 'acme-secret' })

    expect(first.clientId).toMatch(/^fake_client_/)
    expect(first.clientId).not.toBe(second.clientId)
    expect(first.clientSecret).not.toBe(second.clientSecret)
    expect([fixed.clientId, fixed.clientSecret]).toEqual(['acme-client', 'acme-secret'])
  })

  it('publishes no revocation endpoint when revocation is off', async () => {
    const server = await start({ revocation: false })

    expect(server.revocationEndpoint).toBeNull()
    const response = await fetch(`${new URL(server.tokenEndpoint).origin}/revoke`, { method: 'POST' })
    expect(response.status).toBe(404)
    expect(server.counters().revoke).toBe(0)
  })

  it('answers 404 for unknown paths and 405 for the wrong method', async () => {
    const server = await start()
    const origin = new URL(server.tokenEndpoint).origin

    expect((await fetch(`${origin}/nowhere`)).status).toBe(404)
    expect((await fetch(server.tokenEndpoint)).status).toBe(405)
    expect((await fetch(server.authorizationEndpoint, { method: 'POST' })).status).toBe(405)
    expect(server.requests()).toEqual([])
  })

  it('stops listening on close, also when called twice', async () => {
    const server = await start()

    await server.close()
    await server.close()

    await expect(fetch(server.tokenEndpoint, { method: 'POST' })).rejects.toThrow()
  })
})

describe('GET /authorize', () => {
  it('auto-consents with a 302 carrying code and state, and the code redeems', async () => {
    const server = await start()
    const pkce = createPkcePair()
    const redirectUri = `${REDIRECT_URI}?tenant=acme`
    const authorizationUrl = buildAuthorizationUrl(descriptorOf(server), {
      clientId: server.clientId,
      redirectUri,
      state: 'state-1',
      scopes: ['read', 'write'],
      codeChallenge: pkce.codeChallenge,
    })

    const response = await fetch(authorizationUrl, { redirect: 'manual' })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI)
    expect(location.searchParams.get('tenant')).toBe('acme')
    expect(location.searchParams.get('state')).toBe('state-1')
    const code = location.searchParams.get('code') ?? ''
    const tokens = await exchangeAuthorizationCode(
      descriptorOf(server),
      { clientId: server.clientId, clientSecret: server.clientSecret },
      { code, redirectUri, codeVerifier: pkce.codeVerifier },
    )
    expect(tokens.scope).toEqual(['read', 'write'])
  })

  it.each([
    ['an unknown client', { client_id: 'someone-else' }],
    ['a missing response_type', { response_type: '' }],
    ['a challenge without the S256 method', { code_challenge: 'challenge', code_challenge_method: 'plain' }],
    ['a redirect URI that is not http(s)', { redirect_uri: 'javascript:alert(1)' }],
    ['a redirect URI that is not a URL', { redirect_uri: 'not a url' }],
  ])('answers 400 instead of redirecting for %s', async (_label, override) => {
    const server = await start()
    const url = new URL(server.authorizationEndpoint)
    const query: Record<string, string> = {
      response_type: 'code',
      client_id: server.clientId,
      redirect_uri: REDIRECT_URI,
      state: 'state-1',
      ...override,
    }
    for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, value)

    const response = await fetch(url, { redirect: 'manual' })

    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })
})

describe('requestTokenEndpoint against the fake', () => {
  it('authenticates with client_secret_basic and returns fake tokens', async () => {
    const server = await start()

    const tokens = await connect(server)

    expect(tokens.accessToken).toMatch(ACCESS_TOKEN_PATTERN)
    expect(tokens.refreshToken).toMatch(REFRESH_TOKEN_PATTERN)
    expect(tokens).toMatchObject({ tokenType: 'Bearer', expiresInSec: 3600, scope: null })
  })

  it('authenticates with client_secret_post when the fake is configured for it', async () => {
    const server = await start({ clientAuthMethod: 'client_secret_post' })

    const tokens = await connect(server, { authMethod: 'client_secret_post' })

    expect(tokens.accessToken).toMatch(ACCESS_TOKEN_PATTERN)
    const [request] = server.requests()
    expect(request.params).toMatchObject({ client_id: server.clientId, client_secret: server.clientSecret })
  })

  it.each<[OAuthClientAuthMethod]>([['client_secret_basic'], ['client_secret_post']])(
    'decodes form-urlencoded credentials with special characters (%s)',
    async (authMethod) => {
      const server = await start({ clientId: 'client id:1', clientSecret: 's3cr+t/%:é-secret', clientAuthMethod: authMethod })

      await expect(connect(server, { authMethod })).resolves.toMatchObject({ tokenType: 'Bearer' })
    },
  )

  it.each<[string, OAuthClientAuthMethod, OAuthClientAuthMethod, Partial<OAuthClientCredentials>]>([
    ['a wrong secret', 'client_secret_basic', 'client_secret_basic', { clientSecret: 'wrong' }],
    ['a wrong client id', 'client_secret_basic', 'client_secret_basic', { clientId: 'wrong' }],
    ['a wrong secret', 'client_secret_post', 'client_secret_post', { clientSecret: 'wrong' }],
    ['post credentials sent to a basic server', 'client_secret_basic', 'client_secret_post', {}],
    ['basic credentials sent to a post server', 'client_secret_post', 'client_secret_basic', {}],
  ])('answers 401 invalid_client for %s (server: %s, client: %s)', async (_label, serverMethod, clientMethod, override) => {
    const server = await start({ clientAuthMethod: serverMethod })

    const failure = await captureTokenError(
      requestTokenEndpoint({
        url: server.tokenEndpoint,
        client: { ...credentialsOf(server, clientMethod), ...override },
        params: { grant_type: 'refresh_token', refresh_token: 'fake_rt_unknown' },
      }),
    )

    expect(failure).toMatchObject({ kind: 'protocol', status: 401, error: 'invalid_client' })
  })

  it('omits expires_in when accessTokenTtlSec is null and honours a custom TTL', async () => {
    const withoutTtl = await start({ accessTokenTtlSec: null })
    const shortTtl = await start({ accessTokenTtlSec: 60 })

    await expect(connect(withoutTtl)).resolves.toMatchObject({ expiresInSec: null })
    await expect(connect(shortTtl)).resolves.toMatchObject({ expiresInSec: 60 })
  })

  it.each([
    ['an unsupported grant type', { grant_type: 'password' }, 'unsupported_grant_type'],
    ['a refresh grant without a refresh token', { grant_type: 'refresh_token' }, 'invalid_request'],
    ['a code grant without a code', { grant_type: 'authorization_code' }, 'invalid_request'],
  ])('answers 400 for %s', async (_label, params, error) => {
    const server = await start()

    const failure = await captureTokenError(
      requestTokenEndpoint({ url: server.tokenEndpoint, client: credentialsOf(server), params }),
    )

    expect(failure).toMatchObject({ kind: 'protocol', status: 400, error })
  })

  it('answers 400 invalid_request for a body that is not a form', async () => {
    const server = await start()

    const response = await fetch(server.tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${server.clientId}:${server.clientSecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ grant_type: 'refresh_token' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })
})

describe('exchangeAuthorizationCode against the fake', () => {
  const client = (server: FakeAuthorizationServer) => ({ clientId: server.clientId, clientSecret: server.clientSecret })

  it('exchanges a code with the PKCE verifier and returns the granted scope', async () => {
    const server = await start()

    await expect(connect(server, { scope: ['read', 'write'] })).resolves.toMatchObject({ scope: ['read', 'write'] })

    expect(server.counters().token).toEqual({ authorizationCode: 1, refreshToken: 0 })
    expect(server.requests()[0].params).toMatchObject({
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    })
  })

  it("exchanges a code without PKCE for a descriptor with pkce: 'none'", async () => {
    const server = await start()
    const code = server.issueAuthorizationCode({ redirectUri: REDIRECT_URI })

    const tokens = await exchangeAuthorizationCode(descriptorOf(server, { pkce: 'none' }), client(server), {
      code,
      redirectUri: REDIRECT_URI,
    })

    expect(tokens.accessToken).toMatch(ACCESS_TOKEN_PATTERN)
    expect(server.requests()[0].params).not.toHaveProperty('code_verifier')
  })

  it('accepts a code once and burns it on the first attempt', async () => {
    const server = await start()
    const pkce = createPkcePair()
    const code = server.issueAuthorizationCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })
    const input = { code, redirectUri: REDIRECT_URI, codeVerifier: pkce.codeVerifier }

    await exchangeAuthorizationCode(descriptorOf(server), client(server), input)
    const replay = await captureGrantError(exchangeAuthorizationCode(descriptorOf(server), client(server), input))

    expect(replay).toMatchObject({ code: 'connect_exchange_failed', providerErrorCode: 'invalid_grant' })
  })

  it('rejects a wrong verifier and then no longer honours the code', async () => {
    const server = await start()
    const pkce = createPkcePair()
    const code = server.issueAuthorizationCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })

    const wrong = await captureGrantError(
      exchangeAuthorizationCode(descriptorOf(server), client(server), {
        code,
        redirectUri: REDIRECT_URI,
        codeVerifier: createPkcePair().codeVerifier,
      }),
    )
    const retry = await captureGrantError(
      exchangeAuthorizationCode(descriptorOf(server), client(server), {
        code,
        redirectUri: REDIRECT_URI,
        codeVerifier: pkce.codeVerifier,
      }),
    )

    expect(wrong).toMatchObject({ code: 'connect_exchange_failed', providerErrorCode: 'invalid_grant' })
    expect(retry.providerErrorCode).toBe('invalid_grant')
  })

  it('rejects a challenge-bound code redeemed without a verifier', async () => {
    const server = await start()
    const code = server.issueAuthorizationCode({ redirectUri: REDIRECT_URI, codeChallenge: createPkcePair().codeChallenge })

    const failure = await captureGrantError(
      exchangeAuthorizationCode(descriptorOf(server, { pkce: 'none' }), client(server), { code, redirectUri: REDIRECT_URI }),
    )

    expect(failure).toMatchObject({ code: 'connect_exchange_failed', providerErrorCode: 'invalid_grant' })
  })

  it('rejects a different redirect URI', async () => {
    const server = await start()
    const pkce = createPkcePair()
    const code = server.issueAuthorizationCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })

    const failure = await captureGrantError(
      exchangeAuthorizationCode(descriptorOf(server), client(server), {
        code,
        redirectUri: 'https://evil.test/callback',
        codeVerifier: pkce.codeVerifier,
      }),
    )

    expect(failure).toMatchObject({ code: 'connect_exchange_failed', providerErrorCode: 'invalid_grant' })
  })

  it('rejects a code it never issued', async () => {
    const server = await start()
    const pkce = createPkcePair()

    const failure = await captureGrantError(
      exchangeAuthorizationCode(descriptorOf(server), client(server), {
        code: 'fake_code_unknown',
        redirectUri: REDIRECT_URI,
        codeVerifier: pkce.codeVerifier,
      }),
    )

    expect(failure).toMatchObject({ code: 'connect_exchange_failed', providerErrorCode: 'invalid_grant' })
  })

  it('maps a rejected client to client_misconfigured', async () => {
    const server = await start()
    const pkce = createPkcePair()
    const code = server.issueAuthorizationCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })

    const failure = await captureGrantError(
      exchangeAuthorizationCode(descriptorOf(server), { clientId: server.clientId, clientSecret: 'wrong' }, {
        code,
        redirectUri: REDIRECT_URI,
        codeVerifier: pkce.codeVerifier,
      }),
    )

    expect(failure).toMatchObject({ code: 'client_misconfigured', providerErrorCode: 'invalid_client' })
  })

  it('refuses to issue a code without a redirect URI', async () => {
    const server = await start()

    expect(() => server.issueAuthorizationCode({ redirectUri: '' })).toThrow(TypeError)
  })
})

describe('rotation', () => {
  it('none: a refresh returns a new access token and no refresh token, and the original keeps working', async () => {
    const server = await start({ rotation: 'none' })
    const connected = await connect(server)
    const original = requireRefreshToken(connected)

    const first = await refresh(server, original)
    const second = await refresh(server, original)

    expect(first.refreshToken).toBeNull()
    expect(second.refreshToken).toBeNull()
    expect(new Set([connected.accessToken, first.accessToken, second.accessToken]).size).toBe(3)
    expect(server.issuedTokens().refreshTokens).toEqual([original])
  })

  it('non_revoking: a refresh returns a new refresh token and the old one stays valid', async () => {
    const server = await start({ rotation: 'non_revoking' })
    const original = requireRefreshToken(await connect(server))

    const rotated = await refresh(server, original)
    const rotatedToken = requireRefreshToken(rotated)

    expect(rotatedToken).toMatch(REFRESH_TOKEN_PATTERN)
    expect(rotatedToken).not.toBe(original)
    await expect(refresh(server, original)).resolves.toMatchObject({ tokenType: 'Bearer' })
    await expect(refresh(server, rotatedToken)).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it('strict with grace 0: a used parent fails at once and the child works', async () => {
    const server = await start({ rotation: 'strict' })
    const parent = requireRefreshToken(await connect(server))

    const child = requireRefreshToken(await refresh(server, parent))
    const replay = await captureTokenError(refresh(server, parent))

    expect(child).not.toBe(parent)
    expect(replay).toMatchObject({ kind: 'protocol', status: 400, error: 'invalid_grant' })
    await expect(refresh(server, child)).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it('strict with a grace window: a used parent works inside it and fails after it', async () => {
    const server = await start({ rotation: 'strict', strictGraceMs: 400 })
    const parent = requireRefreshToken(await connect(server))

    const first = requireRefreshToken(await refresh(server, parent))
    const insideGrace = requireRefreshToken(await refresh(server, parent))
    await wait(450)
    const afterGrace = await captureTokenError(refresh(server, parent))

    expect(new Set([parent, first, insideGrace]).size).toBe(3)
    expect(afterGrace).toMatchObject({ kind: 'protocol', error: 'invalid_grant' })
    await expect(refresh(server, first)).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it('rejects an unknown refresh token', async () => {
    const server = await start()

    await expect(refresh(server, 'fake_rt_unknown')).rejects.toMatchObject({ kind: 'protocol', error: 'invalid_grant' })
  })

  it('returns the granted scope on a refresh and records that the request sent none', async () => {
    const server = await start()
    const connected = await connect(server, { scope: ['read', 'write'] })

    const refreshed = await refresh(server, requireRefreshToken(connected))

    expect(refreshed.scope).toEqual(['read', 'write'])
    const refreshRequests = server.requests().filter((request) => request.params.grant_type === 'refresh_token')
    expect(refreshRequests).toHaveLength(1)
    expect(refreshRequests[0].params).not.toHaveProperty('scope')
  })
})

describe('revokeToken against the fake', () => {
  it('revokes the authorization of a refresh token and answers 200 for an unknown token', async () => {
    const server = await start({ rotation: 'non_revoking' })
    const original = requireRefreshToken(await connect(server))
    const rotated = requireRefreshToken(await refresh(server, original))
    const client = credentialsOf(server)
    const url = server.revocationEndpoint ?? ''

    await expect(revokeToken({ url, client, token: 'fake_rt_unknown' })).resolves.toBeUndefined()
    await expect(refresh(server, rotated)).resolves.toMatchObject({ tokenType: 'Bearer' })
    await expect(revokeToken({ url, client, token: rotated, tokenTypeHint: 'refresh_token' })).resolves.toBeUndefined()

    await expect(refresh(server, rotated)).rejects.toMatchObject({ error: 'invalid_grant' })
    await expect(refresh(server, original)).rejects.toMatchObject({ error: 'invalid_grant' })
    expect(server.counters().revoke).toBe(2)
    expect(server.requests().filter((request) => request.endpoint === 'revoke')[1].params).toEqual({
      token: rotated,
      token_type_hint: 'refresh_token',
    })
  })

  it('leaves another authorization untouched', async () => {
    const server = await start()
    const first = requireRefreshToken(await connect(server))
    const second = requireRefreshToken(await connect(server))

    await revokeToken({ url: server.revocationEndpoint ?? '', client: credentialsOf(server), token: first })

    await expect(refresh(server, first)).rejects.toMatchObject({ error: 'invalid_grant' })
    await expect(refresh(server, second)).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it('authenticates with client_secret_post when the fake is configured for it', async () => {
    const server = await start({ clientAuthMethod: 'client_secret_post' })
    const token = requireRefreshToken(await connect(server, { authMethod: 'client_secret_post' }))

    await expect(
      revokeToken({ url: server.revocationEndpoint ?? '', client: credentialsOf(server, 'client_secret_post'), token }),
    ).resolves.toBeUndefined()
  })

  it('answers 401 invalid_client for wrong credentials and does not revoke', async () => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))

    const failure = await captureTokenError(
      revokeToken({
        url: server.revocationEndpoint ?? '',
        client: { ...credentialsOf(server), clientSecret: 'wrong' },
        token,
      }),
    )

    expect(failure).toMatchObject({ kind: 'protocol', status: 401, error: 'invalid_client' })
    await expect(refresh(server, token)).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it('answers 400 invalid_request for a request without a token', async () => {
    const server = await start()

    const failure = await captureTokenError(
      revokeToken({ url: server.revocationEndpoint ?? '', client: credentialsOf(server), token: '' }),
    )

    expect(failure).toMatchObject({ kind: 'protocol', status: 400, error: 'invalid_request' })
  })
})

describe('revokeAuthorization and reset', () => {
  it('revokeAuthorization fails every earlier refresh with invalid_grant and leaves later authorizations working', async () => {
    const server = await start({ rotation: 'none' })
    const earlier = requireRefreshToken(await connect(server))

    server.revokeAuthorization()
    const failure = await captureTokenError(refresh(server, earlier))
    const later = requireRefreshToken(await connect(server))

    expect(failure).toMatchObject({ kind: 'protocol', status: 400, error: 'invalid_grant' })
    await expect(refresh(server, later)).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it('reset drops state, injections and recordings but keeps the identity and endpoints', async () => {
    const server = await start({ clientId: 'acme-client', clientSecret: 'acme-secret' })
    const { tokenEndpoint } = server
    const token = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'token', status: 503, body: { error: 'temporarily_unavailable' } })

    server.reset()

    expect(server.counters()).toEqual({ token: { authorizationCode: 0, refreshToken: 0 }, revoke: 0 })
    expect(server.requests()).toEqual([])
    expect(server.issuedTokens()).toEqual({ accessTokens: [], refreshTokens: [] })
    expect([server.clientId, server.clientSecret, server.tokenEndpoint]).toEqual(['acme-client', 'acme-secret', tokenEndpoint])
    await expect(refresh(server, token)).rejects.toMatchObject({ kind: 'protocol', status: 400, error: 'invalid_grant' })
  })
})

describe('injections', () => {
  it('replaces one matching refresh response with a protocol error without touching the rotation state', async () => {
    const server = await start({ rotation: 'strict' })
    const parent = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'token', grantType: 'refresh_token', status: 400, body: { error: 'invalid_grant', error_description: 'gone' } })

    const injected = await captureTokenError(refresh(server, parent))
    const real = await refresh(server, parent)

    expect(injected).toMatchObject({ kind: 'protocol', status: 400, error: 'invalid_grant', errorDescription: 'gone' })
    expect(real.refreshToken).toMatch(REFRESH_TOKEN_PATTERN)
    expect(server.counters().token.refreshToken).toBe(2)
  })

  it('applies an injection to its grant type only and for `times` matching calls', async () => {
    const server = await start({ rotation: 'non_revoking' })
    server.inject({ endpoint: 'token', grantType: 'refresh_token', times: 2, status: 503, body: { error: 'temporarily_unavailable' } })

    const connected = await connect(server)
    const token = requireRefreshToken(connected)
    const firstFailure = await captureTokenError(refresh(server, token))
    const secondFailure = await captureTokenError(refresh(server, token))

    expect(firstFailure).toMatchObject({ kind: 'protocol', status: 503, error: 'temporarily_unavailable' })
    expect(secondFailure.status).toBe(503)
    await expect(refresh(server, token)).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it('applies an injection without a grant type to the first token call', async () => {
    const server = await start()
    server.inject({ endpoint: 'token', status: 401, body: { error: 'invalid_client' } })
    const pkce = createPkcePair()
    const code = server.issueAuthorizationCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })

    const failure = await captureGrantError(
      exchangeAuthorizationCode(descriptorOf(server), { clientId: server.clientId, clientSecret: server.clientSecret }, {
        code,
        redirectUri: REDIRECT_URI,
        codeVerifier: pkce.codeVerifier,
      }),
    )

    expect(failure).toMatchObject({ code: 'client_misconfigured', providerErrorCode: 'invalid_client' })
    await expect(
      exchangeAuthorizationCode(descriptorOf(server), { clientId: server.clientId, clientSecret: server.clientSecret }, {
        code,
        redirectUri: REDIRECT_URI,
        codeVerifier: pkce.codeVerifier,
      }),
    ).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it('injects a revoke failure that a later revoke recovers from', async () => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'revoke', status: 503, body: { error: 'temporarily_unavailable' } })
    const input = { url: server.revocationEndpoint ?? '', client: credentialsOf(server), token }

    const failure = await captureTokenError(revokeToken(input))

    expect(failure).toMatchObject({ kind: 'protocol', status: 503, error: 'temporarily_unavailable' })
    await expect(refresh(server, token)).resolves.toMatchObject({ tokenType: 'Bearer' })
    await expect(revokeToken(input)).resolves.toBeUndefined()
    expect(server.counters().revoke).toBe(2)
  })

  it.each([
    ['an HTML gateway page', 502, '<html>bad gateway</html>'],
    ['a non-JSON success body', 200, 'not json at all'],
  ])('classifies %s as invalid_response', async (_label, status, rawBody) => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'token', grantType: 'refresh_token', status, rawBody })

    const failure = await captureTokenError(refresh(server, token))

    expect(failure).toMatchObject({ kind: 'invalid_response', status, error: null })
    expect(failure.cause).toBeUndefined()
  })

  it('announces the byte length of an injected body', async () => {
    const server = await start()
    server.inject({ endpoint: 'token', rawBody: 'é-body' })

    const response = await fetch(server.tokenEndpoint, { method: 'POST' })

    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength('é-body')))
    expect(await response.text()).toBe('é-body')
  })

  it('classifies an oversize body as invalid_response', async () => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'token', grantType: 'refresh_token', rawBody: 'x'.repeat(OAUTH_RESPONSE_MAX_BYTES + 1) })

    const failure = await captureTokenError(refresh(server, token))

    expect(failure).toMatchObject({ kind: 'invalid_response', status: 200 })
  })

  it('salvages the refresh token of an injected 200 with an unusable access token', async () => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))
    server.inject({
      endpoint: 'token',
      grantType: 'refresh_token',
      body: { token_type: 'Bearer', expires_in: 3600, refresh_token: 'fake_rt_salvaged' },
    })

    const failure = await captureTokenError(refresh(server, token))

    expect(failure).toMatchObject({ kind: 'invalid_response', status: 200, salvagedRefreshToken: 'fake_rt_salvaged' })
    expect(Object.keys(failure)).not.toContain('salvagedRefreshToken')
  })

  it('omitRefreshToken strips the rotated token from the response after the fake issued it', async () => {
    const server = await start({ rotation: 'strict' })
    const parent = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'token', grantType: 'refresh_token', omitRefreshToken: true })

    const stripped = await refresh(server, parent)

    expect(stripped.refreshToken).toBeNull()
    expect(stripped.accessToken).toMatch(ACCESS_TOKEN_PATTERN)
    const issued = server.issuedTokens().refreshTokens
    expect(issued).toHaveLength(2)
    expect(issued[0]).toBe(parent)
    await expect(refresh(server, parent)).rejects.toMatchObject({ error: 'invalid_grant' })
    await expect(refresh(server, issued[1])).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it('omitRefreshToken applies to the code exchange as well', async () => {
    const server = await start()
    server.inject({ endpoint: 'token', grantType: 'authorization_code', omitRefreshToken: true })

    await expect(connect(server)).resolves.toMatchObject({ refreshToken: null })
  })

  it('delays the headers by delayMs', async () => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'token', grantType: 'refresh_token', delayMs: 250 })
    const startedAt = Date.now()

    await refresh(server, token)

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(240)
  })

  it('times out while a delayed response has not sent its headers', async () => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'token', grantType: 'refresh_token', delayMs: 5_000 })

    const failure = await captureTokenError(refresh(server, token, 150))

    expect(failure).toMatchObject({ kind: 'timeout', status: null })
  })

  it('times out when the fake sends the headers and half the body, then stalls', async () => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'token', grantType: 'refresh_token', stallBodyMs: 5_000 })
    const startedAt = Date.now()

    const failure = await captureTokenError(refresh(server, token, 300))

    expect(failure).toMatchObject({ kind: 'timeout', status: 200 })
    expect(Date.now() - startedAt).toBeLessThan(3_000)
    expect(inspect(failure, { depth: 10 })).not.toContain(token)
  })

  it('times out a revoke failure whose body stalls', async () => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'revoke', status: 500, body: { error: 'server_error' }, stallBodyMs: 5_000 })

    const failure = await captureTokenError(
      revokeToken({ url: server.revocationEndpoint ?? '', client: credentialsOf(server), token, timeoutMs: 300 }),
    )

    expect(failure).toMatchObject({ kind: 'timeout', status: 500 })
  })

  it('completes a stalled body after the stall when the client waits for it', async () => {
    const server = await start()
    const token = requireRefreshToken(await connect(server))
    server.inject({ endpoint: 'token', grantType: 'refresh_token', stallBodyMs: 200 })

    await expect(refresh(server, token)).resolves.toMatchObject({ tokenType: 'Bearer' })
  })

  it.each([
    ['times 0', { times: 0 }],
    ['a fractional times', { times: 1.5 }],
    ['a negative delay', { delayMs: -1 }],
    ['a non-finite stall', { stallBodyMs: Number.NaN }],
  ])('rejects an injection with %s', async (_label, override) => {
    const server = await start()

    expect(() => server.inject({ endpoint: 'token', ...override })).toThrow(TypeError)
  })
})

describe('recorded state', () => {
  it('records every token and revoke request in order with its parameters, as copies', async () => {
    const server = await start({ rotation: 'non_revoking' })
    const connected = await connect(server)
    const token = requireRefreshToken(connected)
    await refresh(server, token)
    await revokeToken({ url: server.revocationEndpoint ?? '', client: credentialsOf(server), token })

    const recorded = server.requests()

    expect(recorded.map((request) => request.endpoint)).toEqual(['token', 'token', 'revoke'])
    expect(recorded[1].params).toEqual({ grant_type: 'refresh_token', refresh_token: token })
    expect(recorded[2].params).toEqual({ token })
    const tamperedParams = server.requests()[1].params as Record<string, string>
    tamperedParams.scope = 'tampered'
    expect(server.requests()[1].params).not.toHaveProperty('scope')
  })

  it('counts injected and rejected calls as calls', async () => {
    const server = await start()
    server.inject({ endpoint: 'token', grantType: 'refresh_token', status: 503, body: { error: 'temporarily_unavailable' } })
    await connect(server)

    await captureTokenError(refresh(server, 'fake_rt_unknown'))
    await captureTokenError(refresh(server, 'fake_rt_unknown'))
    await captureTokenError(
      requestTokenEndpoint({
        url: server.tokenEndpoint,
        client: { ...credentialsOf(server), clientSecret: 'wrong' },
        params: { grant_type: 'authorization_code', code: 'fake_code_unknown' },
      }),
    )

    expect(server.counters()).toEqual({ token: { authorizationCode: 2, refreshToken: 2 }, revoke: 0 })
  })

  it('lists every issued token with the exact fake prefixes and 32 random bytes', async () => {
    const server = await start({ rotation: 'non_revoking' })
    const connected = await connect(server)
    const refreshed = await refresh(server, requireRefreshToken(connected))

    const issued = server.issuedTokens()

    expect(issued.accessTokens).toEqual([connected.accessToken, refreshed.accessToken])
    expect(issued.refreshTokens).toEqual([connected.refreshToken, refreshed.refreshToken])
    for (const accessToken of issued.accessTokens) expect(accessToken).toMatch(ACCESS_TOKEN_PATTERN)
    for (const refreshToken of issued.refreshTokens) expect(refreshToken).toMatch(REFRESH_TOKEN_PATTERN)
  })

  it('keeps secrets out of the errors the client library raises', async () => {
    const server = await start()
    const pkce = createPkcePair()
    const code = server.issueAuthorizationCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })

    const failure = await captureTokenError(
      requestTokenEndpoint({
        url: server.tokenEndpoint,
        client: credentialsOf(server),
        params: { grant_type: 'authorization_code', code, redirect_uri: 'https://evil.test/callback', code_verifier: pkce.codeVerifier },
      }),
    )

    const printed = [inspect(failure, { depth: 10 }), JSON.stringify(failure)].join('\n')
    for (const secret of [server.clientSecret, code, pkce.codeVerifier]) expect(printed).not.toContain(secret)
  })
})
