import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { OAuthClientAuthMethod } from '../token-endpoint'

export type FakeRotationMode = 'none' | 'non_revoking' | 'strict'

export type FakeAuthorizationServerOptions = {
  rotation: FakeRotationMode
  /** `strict` only: how long a used parent refresh token keeps working. Default 0: it fails at once. */
  strictGraceMs?: number
  /** Default 3600; `null` omits `expires_in`. */
  accessTokenTtlSec?: number | null
  /** Random when omitted. */
  clientId?: string
  clientSecret?: string
  /** Default `client_secret_basic`; the other method answers `401 invalid_client`. */
  clientAuthMethod?: OAuthClientAuthMethod
  /** Default true; false publishes no revocation endpoint. */
  revocation?: boolean
}

/**
 * Replaces or shapes the next matching response. `status`, `body` or `rawBody` replace the
 * response without touching the server's state; `omitRefreshToken` strips the refresh token
 * from the real response after the server has rotated it.
 */
export type FakeInjection = {
  endpoint: 'token' | 'revoke'
  grantType?: 'authorization_code' | 'refresh_token'
  /** Default 1. */
  times?: number
  /** Waits before the headers. */
  delayMs?: number
  /** Sends the headers and half of the body, then stalls. */
  stallBodyMs?: number
  status?: number
  body?: unknown
  rawBody?: string
  omitRefreshToken?: boolean
}

export type FakeAuthorizationServer = {
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly revocationEndpoint: string | null
  readonly clientId: string
  readonly clientSecret: string
  issueAuthorizationCode(input: { redirectUri: string; scope?: readonly string[]; codeChallenge?: string }): string
  inject(injection: FakeInjection): void
  /** Every refresh of an authorization granted so far then answers `invalid_grant`; later authorizations work. */
  revokeAuthorization(): void
  /** Drops injections, codes, tokens, requests and counters; the client identity and endpoints stay. */
  reset(): void
  counters(): { token: { authorizationCode: number; refreshToken: number }; revoke: number }
  requests(): ReadonlyArray<{ endpoint: 'token' | 'revoke'; params: Readonly<Record<string, string>> }>
  issuedTokens(): { accessTokens: string[]; refreshTokens: string[] }
  close(): Promise<void>
}

type AuthorizationRecord = { scope: string[] | null; revoked: boolean }
type AuthorizationCodeRecord = { redirectUri: string; scope: string[] | null; codeChallenge: string | null }
type RefreshTokenRecord = { authorization: AuthorizationRecord; usedAt: number | null }
type PendingInjection = { injection: FakeInjection; remaining: number }
type RecordedRequest = { endpoint: 'token' | 'revoke'; params: Readonly<Record<string, string>> }

type ServerState = {
  injections: PendingInjection[]
  codes: Map<string, AuthorizationCodeRecord>
  refreshTokens: Map<string, RefreshTokenRecord>
  authorizations: Set<AuthorizationRecord>
  requests: RecordedRequest[]
  counters: { token: { authorizationCode: number; refreshToken: number }; revoke: number }
  accessTokens: string[]
  issuedRefreshTokens: string[]
}

type EndpointOutcome = {
  status: number
  json: Record<string, unknown> | null
  headers?: Record<string, string>
}

type PlannedResponse = { status: number; contentType: string; body: string; headers: Record<string, string> }

const REQUEST_BODY_MAX_BYTES = 65_536
const DEFAULT_ACCESS_TOKEN_TTL_SEC = 3600
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded'
const AUTHORIZE_PATH = '/authorize'
const TOKEN_PATH = '/token'
const REVOKE_PATH = '/revoke'

function createState(): ServerState {
  return {
    injections: [],
    codes: new Map(),
    refreshTokens: new Map(),
    authorizations: new Set(),
    requests: [],
    counters: { token: { authorizationCode: 0, refreshToken: 0 }, revoke: 0 },
    accessTokens: [],
    issuedRefreshTokens: [],
  }
}

function randomHex(byteLength: number): string {
  return randomBytes(byteLength).toString('hex')
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right))
}

function formUrlDecode(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, ' '))
}

function readBasicCredentials(header: string | undefined): { clientId: string; clientSecret: string } | null {
  if (!header || !/^Basic /i.test(header)) return null
  const decoded = Buffer.from(header.slice('Basic '.length).trim(), 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  if (separator < 0) return null
  try {
    return { clientId: formUrlDecode(decoded.slice(0, separator)), clientSecret: formUrlDecode(decoded.slice(separator + 1)) }
  } catch {
    return null
  }
}

function oauthError(status: number, error: string, extra: Partial<EndpointOutcome> = {}): EndpointOutcome {
  return { status, json: { error }, ...extra }
}

function readRequestBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength
      if (total > REQUEST_BODY_MAX_BYTES) {
        chunks.length = 0
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
    req.on('close', () => resolve(null))
  })
}

function serializeInjectedBody(injection: FakeInjection): { contentType: string; body: string } {
  if (injection.rawBody !== undefined) return { contentType: 'text/plain; charset=utf-8', body: injection.rawBody }
  if (injection.body !== undefined) return { contentType: 'application/json', body: JSON.stringify(injection.body) }
  return { contentType: 'application/json', body: '' }
}

function hasInjectedResponse(injection: FakeInjection): boolean {
  return injection.status !== undefined || injection.body !== undefined || injection.rawBody !== undefined
}

function validateInjection(injection: FakeInjection): number {
  const times = injection.times ?? 1
  if (!Number.isInteger(times) || times < 1) throw new TypeError('[internal] FakeInjection.times must be a positive integer')
  for (const delay of [injection.delayMs, injection.stallBodyMs]) {
    if (delay !== undefined && (!Number.isFinite(delay) || delay < 0)) {
      throw new TypeError('[internal] FakeInjection delays must be non-negative numbers')
    }
  }
  return times
}

function parseScope(value: string | null): string[] | null {
  const scopes = (value ?? '').split(/\s+/).filter((scope) => scope.length > 0)
  return scopes.length > 0 ? scopes : null
}

export async function startFakeAuthorizationServer(options: FakeAuthorizationServerOptions): Promise<FakeAuthorizationServer> {
  const rotation = options.rotation
  const strictGraceMs = options.strictGraceMs ?? 0
  const accessTokenTtlSec = options.accessTokenTtlSec === undefined ? DEFAULT_ACCESS_TOKEN_TTL_SEC : options.accessTokenTtlSec
  const clientId = options.clientId ?? `fake_client_${randomHex(8)}`
  const clientSecret = options.clientSecret ?? `fake_secret_${randomHex(24)}`
  const clientAuthMethod: OAuthClientAuthMethod = options.clientAuthMethod ?? 'client_secret_basic'
  const revocationEnabled = options.revocation ?? true

  let state = createState()
  let closing: Promise<void> | null = null
  const sleepers = new Set<() => void>()

  function sleep(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const settle = (completed: boolean) => {
        clearTimeout(timer)
        sleepers.delete(cancel)
        resolve(completed)
      }
      const cancel = () => settle(false)
      const timer = setTimeout(() => settle(true), ms)
      sleepers.add(cancel)
    })
  }

  function authenticateClient(req: IncomingMessage, params: Record<string, string>): boolean {
    if (clientAuthMethod === 'client_secret_basic') {
      const credentials = readBasicCredentials(req.headers.authorization)
      return credentials !== null && safeEqual(credentials.clientId, clientId) && safeEqual(credentials.clientSecret, clientSecret)
    }
    if (req.headers.authorization !== undefined) return false
    const postedId: string | undefined = params.client_id
    const postedSecret: string | undefined = params.client_secret
    return (
      postedId !== undefined &&
      postedSecret !== undefined &&
      safeEqual(postedId, clientId) &&
      safeEqual(postedSecret, clientSecret)
    )
  }

  function invalidClient(): EndpointOutcome {
    const headers = clientAuthMethod === 'client_secret_basic' ? { 'www-authenticate': 'Basic realm="fake"' } : undefined
    return oauthError(401, 'invalid_client', { headers })
  }

  function issueRefreshToken(authorization: AuthorizationRecord): string {
    const token = `fake_rt_${randomHex(32)}`
    state.refreshTokens.set(token, { authorization, usedAt: null })
    state.issuedRefreshTokens.push(token)
    return token
  }

  function tokenResponse(authorization: AuthorizationRecord, refreshToken: string | null): EndpointOutcome {
    const accessToken = `fake_at_${randomHex(32)}`
    state.accessTokens.push(accessToken)
    const json: Record<string, unknown> = { access_token: accessToken, token_type: 'Bearer' }
    if (accessTokenTtlSec !== null) json.expires_in = accessTokenTtlSec
    if (refreshToken !== null) json.refresh_token = refreshToken
    if (authorization.scope) json.scope = authorization.scope.join(' ')
    return { status: 200, json }
  }

  function exchangeAuthorizationCode(params: Record<string, string>): EndpointOutcome {
    const code: string | undefined = params.code
    if (code === undefined) return oauthError(400, 'invalid_request')
    const record = state.codes.get(code)
    state.codes.delete(code)
    if (!record || params.redirect_uri !== record.redirectUri) return oauthError(400, 'invalid_grant')
    if (record.codeChallenge !== null) {
      const verifier: string | undefined = params.code_verifier
      const challenge = verifier === undefined ? null : createHash('sha256').update(verifier, 'ascii').digest('base64url')
      if (challenge === null || !safeEqual(challenge, record.codeChallenge)) return oauthError(400, 'invalid_grant')
    }
    const authorization: AuthorizationRecord = { scope: record.scope, revoked: false }
    state.authorizations.add(authorization)
    return tokenResponse(authorization, issueRefreshToken(authorization))
  }

  function exchangeRefreshToken(params: Record<string, string>): EndpointOutcome {
    const presented: string | undefined = params.refresh_token
    if (presented === undefined) return oauthError(400, 'invalid_request')
    const record = state.refreshTokens.get(presented)
    if (!record || record.authorization.revoked) return oauthError(400, 'invalid_grant')
    const now = Date.now()
    if (rotation === 'strict') {
      if (record.usedAt !== null && now - record.usedAt >= strictGraceMs) return oauthError(400, 'invalid_grant')
      if (record.usedAt === null) record.usedAt = now
    }
    return tokenResponse(record.authorization, rotation === 'none' ? null : issueRefreshToken(record.authorization))
  }

  function processToken(req: IncomingMessage, params: Record<string, string>): EndpointOutcome {
    if (!req.headers['content-type']?.toLowerCase().startsWith(FORM_CONTENT_TYPE)) return oauthError(400, 'invalid_request')
    if (!authenticateClient(req, params)) return invalidClient()
    if (params.grant_type === 'authorization_code') return exchangeAuthorizationCode(params)
    if (params.grant_type === 'refresh_token') return exchangeRefreshToken(params)
    return oauthError(400, 'unsupported_grant_type')
  }

  function processRevoke(req: IncomingMessage, params: Record<string, string>): EndpointOutcome {
    if (!req.headers['content-type']?.toLowerCase().startsWith(FORM_CONTENT_TYPE)) return oauthError(400, 'invalid_request')
    if (!authenticateClient(req, params)) return invalidClient()
    const token: string | undefined = params.token
    if (token === undefined || token.length === 0) return oauthError(400, 'invalid_request')
    const record = state.refreshTokens.get(token)
    if (record) record.authorization.revoked = true
    return { status: 200, json: null }
  }

  function takeInjection(endpoint: 'token' | 'revoke', grantType: string | undefined): FakeInjection | null {
    const index = state.injections.findIndex(
      ({ injection }) => injection.endpoint === endpoint && (injection.grantType === undefined || injection.grantType === grantType),
    )
    if (index < 0) return null
    const entry = state.injections[index]
    entry.remaining -= 1
    if (entry.remaining <= 0) state.injections.splice(index, 1)
    return entry.injection
  }

  function plan(outcome: EndpointOutcome, injection: FakeInjection | null): PlannedResponse {
    const json = outcome.json
    if (json && injection?.omitRefreshToken) delete json.refresh_token
    return {
      status: outcome.status,
      contentType: 'application/json',
      body: json ? JSON.stringify(json) : '',
      headers: outcome.headers ?? {},
    }
  }

  async function deliver(res: ServerResponse, planned: PlannedResponse, injection: FakeInjection | null): Promise<void> {
    if (injection?.delayMs && !(await sleep(injection.delayMs))) return
    if (res.destroyed) return
    const headers = {
      ...planned.headers,
      'content-type': planned.contentType,
      'cache-control': 'no-store',
      pragma: 'no-cache',
    }
    const bytes = Buffer.from(planned.body, 'utf8')
    if (!injection?.stallBodyMs) {
      res.writeHead(planned.status, { ...headers, 'content-length': String(bytes.byteLength) })
      res.end(bytes)
      return
    }
    const splitAt = Math.floor(bytes.byteLength / 2)
    res.writeHead(planned.status, headers)
    if (splitAt > 0) res.write(bytes.subarray(0, splitAt))
    else res.flushHeaders()
    if (!(await sleep(injection.stallBodyMs))) return
    if (!res.destroyed) res.end(bytes.subarray(splitAt))
  }

  async function handleEndpoint(endpoint: 'token' | 'revoke', req: IncomingMessage, res: ServerResponse): Promise<void> {
    const text = await readRequestBody(req)
    if (text === null) {
      res.writeHead(413, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid_request' }))
      return
    }
    const params: Record<string, string> = Object.fromEntries(new URLSearchParams(text))
    state.requests.push({ endpoint, params })
    if (endpoint === 'revoke') {
      state.counters.revoke += 1
    } else if (params.grant_type === 'authorization_code') {
      state.counters.token.authorizationCode += 1
    } else if (params.grant_type === 'refresh_token') {
      state.counters.token.refreshToken += 1
    }
    const injection = takeInjection(endpoint, params.grant_type)
    if (injection && hasInjectedResponse(injection)) {
      const { contentType, body } = serializeInjectedBody(injection)
      await deliver(res, { status: injection.status ?? 200, contentType, body, headers: {} }, injection)
      return
    }
    const outcome = endpoint === 'token' ? processToken(req, params) : processRevoke(req, params)
    await deliver(res, plan(outcome, injection), injection)
  }

  function handleAuthorize(url: URL, res: ServerResponse): void {
    const query = url.searchParams
    const respondWithError = (status: number, error: string) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error }))
    }
    if (query.get('client_id') !== clientId) return respondWithError(400, 'unauthorized_client')
    if (query.get('response_type') !== 'code') return respondWithError(400, 'invalid_request')
    const challenge = query.get('code_challenge')
    if (challenge !== null && query.get('code_challenge_method') !== 'S256') return respondWithError(400, 'invalid_request')
    const redirectUri = query.get('redirect_uri') ?? ''
    let target: URL
    try {
      target = new URL(redirectUri)
    } catch {
      return respondWithError(400, 'invalid_request')
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return respondWithError(400, 'invalid_request')
    const code = issueAuthorizationCode({
      redirectUri,
      scope: parseScope(query.get('scope')) ?? undefined,
      codeChallenge: challenge ?? undefined,
    })
    target.searchParams.set('code', code)
    const clientState = query.get('state')
    if (clientState !== null) target.searchParams.set('state', clientState)
    res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' })
    res.end()
  }

  function issueAuthorizationCode(input: { redirectUri: string; scope?: readonly string[]; codeChallenge?: string }): string {
    if (!input.redirectUri) throw new TypeError('[internal] issueAuthorizationCode requires a redirectUri')
    const code = `fake_code_${randomHex(16)}`
    state.codes.set(code, {
      redirectUri: input.redirectUri,
      scope: input.scope && input.scope.length > 0 ? [...input.scope] : null,
      codeChallenge: input.codeChallenge ?? null,
    })
    return code
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const isEndpoint = url.pathname === TOKEN_PATH || (revocationEnabled && url.pathname === REVOKE_PATH)
    if (url.pathname === AUTHORIZE_PATH) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      handleAuthorize(url, res)
      return
    }
    if (!isEndpoint) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    await handleEndpoint(url.pathname === TOKEN_PATH ? 'token' : 'revoke', req, res)
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'server_error' }))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('[internal] The fake authorization server did not bind a TCP port')
  }
  const origin = `http://127.0.0.1:${address.port}`

  return {
    authorizationEndpoint: `${origin}${AUTHORIZE_PATH}`,
    tokenEndpoint: `${origin}${TOKEN_PATH}`,
    revocationEndpoint: revocationEnabled ? `${origin}${REVOKE_PATH}` : null,
    clientId,
    clientSecret,
    issueAuthorizationCode,
    inject(injection) {
      state.injections.push({ injection: { ...injection }, remaining: validateInjection(injection) })
    },
    revokeAuthorization() {
      for (const authorization of state.authorizations) authorization.revoked = true
    },
    reset() {
      state = createState()
    },
    counters() {
      return {
        token: { ...state.counters.token },
        revoke: state.counters.revoke,
      }
    },
    requests() {
      return state.requests.map((request) => ({ endpoint: request.endpoint, params: { ...request.params } }))
    },
    issuedTokens() {
      return { accessTokens: [...state.accessTokens], refreshTokens: [...state.issuedRefreshTokens] }
    },
    close() {
      if (!closing) {
        closing = new Promise<void>((resolve) => {
          for (const cancel of [...sleepers]) cancel()
          server.close(() => resolve())
          server.closeAllConnections()
        })
      }
      return closing
    },
  }
}
