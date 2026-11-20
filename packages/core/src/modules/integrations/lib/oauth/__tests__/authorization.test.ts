/** @jest-environment node */
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'
import { buildAuthorizationUrl, exchangeAuthorizationCode } from '../authorization'
import { OAuthDescriptorError, OAuthGrantError, type OAuthProviderDescriptor } from '../descriptor'
import { createPkcePair } from '../pkce'

type RecordedRequest = { headers: IncomingMessage['headers']; form: Record<string, string> }

type ExchangeServer = {
  tokenEndpoint: string
  requests: RecordedRequest[]
  issueCode(input: { redirectUri: string; codeChallenge?: string }): string
  respondWith(status: number, body: unknown): void
  close(): Promise<void>
}

const CLIENT = { clientId: 'acme-client', clientSecret: 'acme-client-secret-value' }

function basicCredentials(header: string | undefined): { clientId: string; clientSecret: string } | null {
  if (!header?.startsWith('Basic ')) return null
  const [user, pass] = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8').split(':')
  const decode = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '))
  return { clientId: decode(user ?? ''), clientSecret: decode(pass ?? '') }
}

async function startExchangeServer(): Promise<ExchangeServer> {
  const requests: RecordedRequest[] = []
  const codes = new Map<string, { redirectUri: string; codeChallenge?: string }>()
  let forced: { status: number; body: unknown } | null = null
  let issued = 0

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
      requests.push({ headers: req.headers, form })
      if (forced) return send(res, forced.status, forced.body)
      const credentials = basicCredentials(req.headers.authorization) ?? { clientId: form.client_id, clientSecret: form.client_secret }
      if (credentials.clientId !== CLIENT.clientId || credentials.clientSecret !== CLIENT.clientSecret) {
        return send(res, 401, { error: 'invalid_client' })
      }
      const grant = codes.get(form.code)
      codes.delete(form.code)
      if (!grant || form.grant_type !== 'authorization_code' || grant.redirectUri !== form.redirect_uri) {
        return send(res, 400, { error: 'invalid_grant' })
      }
      if (grant.codeChallenge) {
        const verifier = form.code_verifier
        const challenge = verifier ? createHash('sha256').update(verifier).digest('base64url') : null
        if (challenge !== grant.codeChallenge) return send(res, 400, { error: 'invalid_grant' })
      }
      return send(res, 200, { access_token: 'at-issued', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-issued' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  return {
    tokenEndpoint: `http://127.0.0.1:${port}/token`,
    requests,
    issueCode(input) {
      issued += 1
      const code = `code-${issued}`
      codes.set(code, input)
      return code
    },
    respondWith(status, body) {
      forced = { status, body }
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function captureGrantError(promise: Promise<unknown>): Promise<OAuthGrantError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OAuthGrantError) return error
    throw error
  }
  throw new Error('[internal] expected OAuthGrantError')
}

const REDIRECT_URI = 'https://app.acme.test/api/acme/oauth/callback'

const baseDescriptor: OAuthProviderDescriptor = {
  integrationId: 'acme_mail',
  authorizationEndpoint: 'https://auth.acme.test/oauth/authorize?tenant=common',
  tokenEndpoint: 'https://auth.acme.test/oauth/token',
  defaultScopes: ['mail.read', 'offline_access'],
}

describe('buildAuthorizationUrl', () => {
  it('builds the authorization-code request with PKCE and the default scopes', () => {
    const url = new URL(buildAuthorizationUrl(baseDescriptor, {
      clientId: 'acme-client',
      redirectUri: REDIRECT_URI,
      state: 'state-1',
      codeChallenge: 'challenge-1',
    }))

    expect(`${url.origin}${url.pathname}`).toBe('https://auth.acme.test/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tenant: 'common',
      response_type: 'code',
      client_id: 'acme-client',
      redirect_uri: REDIRECT_URI,
      scope: 'mail.read offline_access',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
    })
  })

  it('uses explicit scopes and appends extra params without letting them override the protocol keys', () => {
    const url = new URL(buildAuthorizationUrl({
      ...baseDescriptor,
      extraAuthorizeParams: { access_type: 'offline', prompt: 'consent', state: 'evil', redirect_uri: 'https://evil.test' },
    }, {
      clientId: 'acme-client',
      redirectUri: REDIRECT_URI,
      state: 'state-1',
      scopes: ['calendar.read'],
      codeChallenge: 'challenge-1',
    }))

    expect(url.searchParams.get('scope')).toBe('calendar.read')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.getAll('state')).toEqual(['state-1'])
    expect(url.searchParams.getAll('redirect_uri')).toEqual([REDIRECT_URI])
  })

  it('refuses a PKCE-less URL while PKCE is on', () => {
    const run = () => buildAuthorizationUrl(baseDescriptor, { clientId: 'acme-client', redirectUri: REDIRECT_URI, state: 'state-1' })

    expect(run).toThrow(OAuthDescriptorError)
    expect(run).toThrow(expect.objectContaining({ field: 'codeChallenge' }))
  })

  it("omits the challenge when the descriptor sets pkce: 'none'", () => {
    const url = new URL(buildAuthorizationUrl({ ...baseDescriptor, pkce: 'none' }, {
      clientId: 'acme-client',
      redirectUri: REDIRECT_URI,
      state: 'state-1',
      codeChallenge: 'ignored',
    }))

    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.searchParams.has('code_challenge_method')).toBe(false)
  })

  it('validates the descriptor first', () => {
    expect(() => buildAuthorizationUrl({ ...baseDescriptor, defaultScopes: [] }, {
      clientId: 'acme-client',
      redirectUri: REDIRECT_URI,
      state: 'state-1',
      codeChallenge: 'challenge-1',
    })).toThrow(expect.objectContaining({ name: 'OAuthDescriptorError', field: 'defaultScopes' }))
  })
})

describe('exchangeAuthorizationCode', () => {
  let server: ExchangeServer
  let descriptor: OAuthProviderDescriptor

  beforeEach(async () => {
    server = await startExchangeServer()
    descriptor = { ...baseDescriptor, tokenEndpoint: server.tokenEndpoint }
  })

  afterEach(async () => {
    await server.close()
  })

  it('exchanges a code with the PKCE verifier and client_secret_basic', async () => {
    const pkce = createPkcePair()
    const code = server.issueCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })

    await expect(exchangeAuthorizationCode(descriptor, CLIENT, { code, redirectUri: REDIRECT_URI, codeVerifier: pkce.codeVerifier }))
      .resolves.toEqual({ accessToken: 'at-issued', tokenType: 'Bearer', expiresInSec: 3600, refreshToken: 'rt-issued', scope: null })
    expect(server.requests[0].form).toEqual({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.codeVerifier,
    })
    expect(server.requests[0].headers.authorization).toMatch(/^Basic /)
  })

  it("uses the descriptor's client_secret_post", async () => {
    const pkce = createPkcePair()
    const code = server.issueCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })

    await exchangeAuthorizationCode({ ...descriptor, clientAuthMethod: 'client_secret_post' }, CLIENT, {
      code,
      redirectUri: REDIRECT_URI,
      codeVerifier: pkce.codeVerifier,
    })

    expect(server.requests[0].headers.authorization).toBeUndefined()
    expect(server.requests[0].form).toMatchObject({ client_id: CLIENT.clientId, client_secret: CLIENT.clientSecret })
  })

  it('fails connect_state_invalid without a verifier before any network call', async () => {
    const failure = await captureGrantError(
      exchangeAuthorizationCode(descriptor, CLIENT, { code: 'code-x', redirectUri: REDIRECT_URI }),
    )

    expect(failure.code).toBe('connect_state_invalid')
    expect(server.requests).toHaveLength(0)
  })

  it('throws OAuthDescriptorError for a malformed descriptor before any network call', async () => {
    await expect(exchangeAuthorizationCode({ ...descriptor, pkce: 'plain' } as unknown as OAuthProviderDescriptor, CLIENT, {
      code: 'code-x',
      redirectUri: REDIRECT_URI,
      codeVerifier: 'verifier',
    })).rejects.toThrow(OAuthDescriptorError)
    expect(server.requests).toHaveLength(0)
  })

  it('fails connect_exchange_failed when the authorization server rejects a wrong verifier', async () => {
    const pkce = createPkcePair()
    const code = server.issueCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })

    const failure = await captureGrantError(exchangeAuthorizationCode(descriptor, CLIENT, {
      code,
      redirectUri: REDIRECT_URI,
      codeVerifier: createPkcePair().codeVerifier,
    }))

    expect(failure).toMatchObject({ code: 'connect_exchange_failed', providerErrorCode: 'invalid_grant', reason: null })
  })

  it("sends no verifier with pkce: 'none'", async () => {
    const code = server.issueCode({ redirectUri: REDIRECT_URI })

    await exchangeAuthorizationCode({ ...descriptor, pkce: 'none' }, CLIENT, { code, redirectUri: REDIRECT_URI })

    expect(server.requests[0].form).not.toHaveProperty('code_verifier')
  })

  it.each(['invalid_client', 'unauthorized_client'])('maps %s to client_misconfigured', async (providerError) => {
    server.respondWith(401, { error: providerError })

    const failure = await captureGrantError(exchangeAuthorizationCode(descriptor, CLIENT, {
      code: 'code-x',
      redirectUri: REDIRECT_URI,
      codeVerifier: 'verifier',
    }))

    expect(failure).toMatchObject({ code: 'client_misconfigured', providerErrorCode: providerError })
  })

  it('maps a wrong client secret answered by the server to client_misconfigured', async () => {
    const failure = await captureGrantError(exchangeAuthorizationCode(descriptor, { ...CLIENT, clientSecret: 'wrong' }, {
      code: 'code-x',
      redirectUri: REDIRECT_URI,
      codeVerifier: 'verifier',
    }))

    expect(failure.code).toBe('client_misconfigured')
  })

  it('maps a network failure to connect_exchange_failed without secrets', async () => {
    await server.close()
    const pkce = createPkcePair()

    const failure = await captureGrantError(exchangeAuthorizationCode(descriptor, CLIENT, {
      code: 'code-secret-value',
      redirectUri: REDIRECT_URI,
      codeVerifier: pkce.codeVerifier,
    }))

    expect(failure).toMatchObject({ code: 'connect_exchange_failed', providerErrorCode: null })
    const printed = inspect(failure, { depth: 10 })
    for (const secret of [CLIENT.clientSecret, 'code-secret-value', pkce.codeVerifier]) expect(printed).not.toContain(secret)
    server = await startExchangeServer()
  })

  it('drops a salvaged refresh token from the failure', async () => {
    server.respondWith(200, { token_type: 'Bearer', refresh_token: 'rt-salvaged-secret' })

    const failure = await captureGrantError(exchangeAuthorizationCode(descriptor, CLIENT, {
      code: 'code-x',
      redirectUri: REDIRECT_URI,
      codeVerifier: 'verifier',
    }))

    expect(failure.code).toBe('connect_exchange_failed')
    expect(failure.cause).toBeUndefined()
    expect(inspect(failure, { depth: 10, showHidden: true })).not.toContain('rt-salvaged-secret')
  })
})
