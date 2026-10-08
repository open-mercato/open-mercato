/** @jest-environment node */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'
import {
  OAUTH_RESPONSE_MAX_BYTES,
  OAuthTokenEndpointError,
  requestTokenEndpoint,
  revokeToken,
  type OAuthClientCredentials,
} from '../token-endpoint'

type RecordedRequest = {
  method: string
  path: string
  headers: IncomingMessage['headers']
  form: Record<string, string>
}

type Responder = (request: RecordedRequest, res: ServerResponse) => void

type ThrowawayServer = {
  url: string
  requests: RecordedRequest[]
  respondWith(responder: Responder): void
  close(): Promise<void>
}

const CLIENT_ID = 'client id:1'
const CLIENT_SECRET = 's3cr+t/%:é-client-secret'
const BASIC_CLIENT: OAuthClientCredentials = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, authMethod: 'client_secret_basic' }
const POST_CLIENT: OAuthClientCredentials = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, authMethod: 'client_secret_post' }
const AUTHORIZATION_CODE = 'authorization-code-secret-value'
const RESPONSE_SECRET = 'response-body-secret-value'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function startServer(): Promise<ThrowawayServer> {
  const requests: RecordedRequest[] = []
  let responder: Responder = (_request, res) => sendJson(res, 200, { access_token: 'at', token_type: 'Bearer' })
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const request: RecordedRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        form: Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))),
      }
      requests.push(request)
      responder(request, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/token`,
    requests,
    respondWith(next) {
      responder = next
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function captureError(promise: Promise<unknown>): Promise<OAuthTokenEndpointError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OAuthTokenEndpointError) return error
    throw error
  }
  throw new Error('[internal] expected the call to fail')
}

function printedError(error: Error): string {
  return [inspect(error, { depth: 10 }), JSON.stringify(error), String(error.cause ?? '')].join('\n')
}

function expectNoSecrets(error: Error, extraSecrets: string[] = []): void {
  const printed = printedError(error)
  for (const secret of [CLIENT_SECRET, AUTHORIZATION_CODE, RESPONSE_SECRET, ...extraSecrets]) {
    expect(printed).not.toContain(secret)
  }
}

describe('requestTokenEndpoint', () => {
  let server: ThrowawayServer

  beforeEach(async () => {
    server = await startServer()
  })

  afterEach(async () => {
    await server.close()
  })

  it('authenticates with client_secret_basic, form-urlencoding id and secret before base64', async () => {
    await requestTokenEndpoint({
      url: server.url,
      client: BASIC_CLIENT,
      params: { grant_type: 'authorization_code', code: AUTHORIZATION_CODE },
    })

    const [request] = server.requests
    const expectedUserPass = 'client+id%3A1:s3cr%2Bt%2F%25%3A%C3%A9-client-secret'
    expect(request.method).toBe('POST')
    expect(request.headers.authorization).toBe(`Basic ${Buffer.from(expectedUserPass, 'utf8').toString('base64')}`)
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(request.form).toEqual({ grant_type: 'authorization_code', code: AUTHORIZATION_CODE })
  })

  it('authenticates with client_secret_post in the form body and no Authorization header', async () => {
    await requestTokenEndpoint({ url: server.url, client: POST_CLIENT, params: { grant_type: 'refresh_token', refresh_token: 'rt' } })

    const [request] = server.requests
    expect(request.headers.authorization).toBeUndefined()
    expect(request.form).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    })
  })

  it.each([
    [
      'a full response with a lowercase token type',
      { access_token: 'at-1', token_type: 'bearer', expires_in: 3599, refresh_token: 'rt-1', scope: 'read  write' },
      { accessToken: 'at-1', tokenType: 'Bearer', expiresInSec: 3599, refreshToken: 'rt-1', scope: ['read', 'write'] },
    ],
    [
      'a numeric-string expires_in and no token type',
      { access_token: 'at-2', expires_in: '120' },
      { accessToken: 'at-2', tokenType: 'Bearer', expiresInSec: 120, refreshToken: null, scope: null },
    ],
    [
      'no expires_in, an empty refresh token and an empty scope',
      { access_token: 'at-3', token_type: 'Bearer', refresh_token: '', scope: ' ' },
      { accessToken: 'at-3', tokenType: 'Bearer', expiresInSec: null, refreshToken: null, scope: null },
    ],
  ])('parses %s', async (_label, body, expected) => {
    server.respondWith((_request, res) => sendJson(res, 200, body))

    await expect(requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: {} })).resolves.toEqual(expected)
  })

  it('accepts a body of exactly OAUTH_RESPONSE_MAX_BYTES', async () => {
    const skeleton = JSON.stringify({ access_token: 'at', pad: '' })
    const body = JSON.stringify({ access_token: 'at', pad: 'x'.repeat(OAUTH_RESPONSE_MAX_BYTES - Buffer.byteLength(skeleton)) })
    expect(Buffer.byteLength(body)).toBe(OAUTH_RESPONSE_MAX_BYTES)
    server.respondWith((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
    })

    await expect(requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: {} })).resolves.toMatchObject({ accessToken: 'at' })
  })

  it.each([
    [400, { error: 'invalid_grant', error_description: 'Refresh token expired' }, 'invalid_grant', 'Refresh token expired'],
    [401, { error: 'invalid_client' }, 'invalid_client', null],
    [503, { error: 'temporarily_unavailable', error_description: 42 }, 'temporarily_unavailable', null],
    [200, { error: 'invalid_grant' }, 'invalid_grant', null],
  ])('parses an RFC 6749 §5.2 error on HTTP %i', async (status, body, error, errorDescription) => {
    server.respondWith((_request, res) => sendJson(res, status, body))

    const failure = await captureError(requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: { code: AUTHORIZATION_CODE } }))
    expect(failure).toMatchObject({ kind: 'protocol', status, error, errorDescription, salvagedRefreshToken: null })
    expect(failure.message.startsWith('[internal]')).toBe(true)
    expectNoSecrets(failure)
  })

  it.each([
    ['an HTML success page', 200, 'text/html', `<html>${RESPONSE_SECRET}</html>`],
    ['an HTML gateway error', 502, 'text/html', `<html>${RESPONSE_SECRET}</html>`],
    ['an error object without `error`', 400, 'application/json', JSON.stringify({ message: RESPONSE_SECRET })],
    ['a JSON array', 200, 'application/json', JSON.stringify([RESPONSE_SECRET])],
    ['an empty success body', 200, 'application/json', ''],
  ])('classifies %s as invalid_response', async (_label, status, contentType, body) => {
    server.respondWith((_request, res) => {
      res.writeHead(status, { 'content-type': contentType })
      res.end(body)
    })

    const failure = await captureError(requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: { code: AUTHORIZATION_CODE } }))
    expect(failure).toMatchObject({ kind: 'invalid_response', status, error: null })
    expect(failure.cause).toBeUndefined()
    expectNoSecrets(failure)
  })

  it('rejects an oversize body announced by Content-Length', async () => {
    server.respondWith((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(OAUTH_RESPONSE_MAX_BYTES + 1) })
      res.end('x'.repeat(OAUTH_RESPONSE_MAX_BYTES + 1))
    })

    await expect(requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: {} })).rejects.toMatchObject({
      kind: 'invalid_response',
      status: 200,
    })
  })

  it('rejects an oversize chunked body by counting bytes', async () => {
    server.respondWith((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      const chunk = `"${RESPONSE_SECRET}"`.repeat(512)
      for (let written = 0; written <= OAUTH_RESPONSE_MAX_BYTES; written += chunk.length) res.write(chunk)
      res.end()
    })

    const failure = await captureError(requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: {} }))
    expect(failure).toMatchObject({ kind: 'invalid_response', status: 200 })
    expectNoSecrets(failure)
  })

  it.each([
    ['a non-Bearer token type', { access_token: 'at', token_type: 'mac', refresh_token: 'rt-salvaged-1' }],
    ['a missing access token', { refresh_token: 'rt-salvaged-1', expires_in: 3600 }],
    ['an unparseable expires_in', { access_token: 'at', expires_in: 'soon', refresh_token: 'rt-salvaged-1' }],
    ['a non-string scope', { access_token: 'at', scope: ['read'], refresh_token: 'rt-salvaged-1' }],
  ])('salvages the refresh token of a 2xx with %s', async (_label, body) => {
    server.respondWith((_request, res) => sendJson(res, 200, body))

    const failure = await captureError(requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: {} }))
    expect(failure.kind).toBe('invalid_response')
    expect(failure.salvagedRefreshToken).toBe('rt-salvaged-1')
    expect(Object.keys(failure)).not.toContain('salvagedRefreshToken')
    expectNoSecrets(failure, ['rt-salvaged-1'])
  })

  it('salvages nothing when the refresh token itself is malformed', async () => {
    server.respondWith((_request, res) => sendJson(res, 200, { access_token: 'at', refresh_token: 42 }))

    const failure = await captureError(requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: {} }))
    expect(failure).toMatchObject({ kind: 'invalid_response', salvagedRefreshToken: null })
  })

  it('times out while the headers are pending', async () => {
    server.respondWith(() => undefined)
    const startedAt = Date.now()

    const failure = await captureError(
      requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: { code: AUTHORIZATION_CODE }, timeoutMs: 150 }),
    )
    expect(failure).toMatchObject({ kind: 'timeout', status: null })
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expectNoSecrets(failure)
  })

  it('reports the caller signal aborting as a timeout', async () => {
    server.respondWith(() => undefined)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)

    await expect(
      requestTokenEndpoint({ url: server.url, client: BASIC_CLIENT, params: {}, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('reports a refused connection as a network error without secrets', async () => {
    const closedUrl = server.url
    await server.close()
    server = await startServer()

    const failure = await captureError(
      requestTokenEndpoint({ url: closedUrl, client: POST_CLIENT, params: { code: AUTHORIZATION_CODE } }),
    )
    expect(failure).toMatchObject({ kind: 'network', status: null })
    expectNoSecrets(failure)
  })

  it('does not follow a redirect with the client credentials', async () => {
    server.respondWith((request, res) => {
      if (request.path === '/token') {
        res.writeHead(307, { location: '/elsewhere' })
        res.end()
        return
      }
      sendJson(res, 200, { access_token: 'at' })
    })

    await expect(requestTokenEndpoint({ url: server.url, client: POST_CLIENT, params: {} })).rejects.toMatchObject({
      kind: 'invalid_response',
      status: 307,
    })
    expect(server.requests.map((request) => request.path)).toEqual(['/token'])
  })
})

describe('revokeToken', () => {
  let server: ThrowawayServer

  beforeEach(async () => {
    server = await startServer()
  })

  afterEach(async () => {
    await server.close()
  })

  it('treats 200 for an unknown token as success and sends the RFC 7009 form', async () => {
    server.respondWith((_request, res) => {
      res.writeHead(200)
      res.end()
    })

    await expect(
      revokeToken({ url: server.url, client: BASIC_CLIENT, token: 'unknown-token', tokenTypeHint: 'refresh_token' }),
    ).resolves.toBeUndefined()
    const [request] = server.requests
    expect(request.form).toEqual({ token: 'unknown-token', token_type_hint: 'refresh_token' })
    expect(request.headers.authorization).toMatch(/^Basic /)
  })

  it('sends client_secret_post credentials in the body', async () => {
    server.respondWith((_request, res) => sendJson(res, 200, {}))

    await revokeToken({ url: server.url, client: POST_CLIENT, token: 'rt' })

    expect(server.requests[0].form).toEqual({ token: 'rt', client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  })

  it('maps an RFC 7009 error response to a protocol error', async () => {
    server.respondWith((_request, res) => sendJson(res, 503, { error: 'unsupported_token_type' }))

    const failure = await captureError(revokeToken({ url: server.url, client: BASIC_CLIENT, token: 'rt-revoke-secret' }))
    expect(failure).toMatchObject({ kind: 'protocol', status: 503, error: 'unsupported_token_type' })
    expectNoSecrets(failure, ['rt-revoke-secret'])
  })

  it('maps a non-JSON failure to invalid_response', async () => {
    server.respondWith((_request, res) => {
      res.writeHead(500, { 'content-type': 'text/html' })
      res.end(`<html>${RESPONSE_SECRET}</html>`)
    })

    const failure = await captureError(revokeToken({ url: server.url, client: BASIC_CLIENT, token: 'rt' }))
    expect(failure).toMatchObject({ kind: 'invalid_response', status: 500 })
    expectNoSecrets(failure)
  })

  it('times out while the headers are pending', async () => {
    server.respondWith(() => undefined)

    await expect(revokeToken({ url: server.url, client: BASIC_CLIENT, token: 'rt', timeoutMs: 150 })).rejects.toMatchObject({
      kind: 'timeout',
    })
  })
})
