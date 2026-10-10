export type OAuthClientAuthMethod = 'client_secret_basic' | 'client_secret_post'

export type OAuthClientCredentials = { clientId: string; clientSecret: string; authMethod: OAuthClientAuthMethod }

export type OAuthTokenEndpointResponse = {
  accessToken: string
  tokenType: 'Bearer'
  expiresInSec: number | null
  refreshToken: string | null
  scope: string[] | null
}

/**
 * - `protocol`: the endpoint answered an RFC 6749 §5.2 error (`error` set).
 * - `network`: no response or a broken body stream.
 * - `timeout`: the call's own deadline or the caller's `signal` fired, headers or body pending.
 * - `invalid_response`: a body that is not JSON, too large, or an unusable success response.
 */
export type OAuthTokenEndpointErrorKind = 'protocol' | 'network' | 'timeout' | 'invalid_response'

/**
 * A failed token or revocation call. Branch on `kind`, `status` and `error`, never on the
 * message. Neither the message nor `cause` carries a request body, form parameter or
 * response body; `salvagedRefreshToken` is non-enumerable, so error serializers never print it.
 */
export class OAuthTokenEndpointError extends Error {
  readonly kind: OAuthTokenEndpointErrorKind
  readonly status: number | null
  /** RFC 6749 §5.2 `error`. */
  readonly error: string | null
  readonly errorDescription: string | null
  /** A 2xx whose access-token part is unusable but which carries a `refresh_token` (App Spec §1.4.5, anti-corruption). */
  declare readonly salvagedRefreshToken: string | null
  constructor(
    kind: OAuthTokenEndpointErrorKind,
    details: {
      status?: number | null
      error?: string | null
      errorDescription?: string | null
      salvagedRefreshToken?: string | null
      cause?: unknown
    } = {},
  ) {
    const status = details.status ?? null
    super(
      status === null
        ? `[internal] OAuth endpoint call failed: ${kind}`
        : `[internal] OAuth endpoint call failed: ${kind} (HTTP ${status})`,
      details.cause === undefined ? undefined : { cause: details.cause },
    )
    this.name = 'OAuthTokenEndpointError'
    this.kind = kind
    this.status = status
    this.error = details.error ?? null
    this.errorDescription = details.errorDescription ?? null
    Object.defineProperty(this, 'salvagedRefreshToken', {
      value: details.salvagedRefreshToken ?? null,
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }
}

export const OAUTH_RESPONSE_MAX_BYTES = 65_536

const TOKEN_TIMEOUT_MAX_MS = 10_000
const REVOKE_TIMEOUT_MAX_MS = 8_000

type JsonObject = Record<string, unknown>

function clampTimeoutMs(value: number | undefined, maxMs: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return maxMs
  return Math.min(Math.ceil(value), maxMs)
}

function callSignal(timeoutMs: number, signal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function formUrlEncode(value: string): string {
  return new URLSearchParams([['value', value]]).toString().slice('value='.length)
}

function transportError(error: unknown, signal: AbortSignal, status: number | null): OAuthTokenEndpointError {
  if (signal.aborted) return new OAuthTokenEndpointError('timeout', { status, cause: signal.reason })
  return new OAuthTokenEndpointError('network', { status, cause: error })
}

async function postForm(
  url: string,
  client: OAuthClientCredentials,
  form: URLSearchParams,
  signal: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }
  if (client.authMethod === 'client_secret_post') {
    form.set('client_id', client.clientId)
    form.set('client_secret', client.clientSecret)
  } else {
    const userPass = `${formUrlEncode(client.clientId)}:${formUrlEncode(client.clientSecret)}`
    headers.Authorization = `Basic ${Buffer.from(userPass, 'utf8').toString('base64')}`
  }
  try {
    return await fetch(url, { method: 'POST', headers, body: form.toString(), redirect: 'manual', signal })
  } catch (error) {
    throw transportError(error, signal, null)
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    return
  }
}

async function readCappedText(response: Response, signal: AbortSignal): Promise<string> {
  const status = response.status
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > OAUTH_RESPONSE_MAX_BYTES) {
    await discardBody(response)
    throw new OAuthTokenEndpointError('invalid_response', { status })
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > OAUTH_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new OAuthTokenEndpointError('invalid_response', { status })
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof OAuthTokenEndpointError) throw error
    throw transportError(error, signal, status)
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks))
}

function parseJsonObject(text: string): JsonObject | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as JsonObject
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function errorResponse(status: number, body: JsonObject | null): OAuthTokenEndpointError {
  if (body && typeof body.error === 'string' && body.error.length > 0) {
    return new OAuthTokenEndpointError('protocol', {
      status,
      error: body.error,
      errorDescription: optionalString(body.error_description),
    })
  }
  return new OAuthTokenEndpointError('invalid_response', { status })
}

function parseExpiresIn(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim())
  return undefined
}

function parseScope(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  const scopes = value.split(/\s+/).filter((scope) => scope.length > 0)
  return scopes.length > 0 ? scopes : null
}

function parseRefreshToken(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  return value.length > 0 ? value : null
}

function isBearerTokenType(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.toLowerCase() === 'bearer'
}

function successResponse(status: number, body: JsonObject): OAuthTokenEndpointResponse {
  if (typeof body.error === 'string' && body.error.length > 0) throw errorResponse(status, body)
  const refreshToken = parseRefreshToken(body.refresh_token)
  if (refreshToken === undefined) throw new OAuthTokenEndpointError('invalid_response', { status })
  const accessToken = typeof body.access_token === 'string' && body.access_token.length > 0 ? body.access_token : null
  const expiresInSec = parseExpiresIn(body.expires_in)
  const scope = parseScope(body.scope)
  if (accessToken === null || expiresInSec === undefined || scope === undefined || !isBearerTokenType(body.token_type)) {
    throw new OAuthTokenEndpointError('invalid_response', { status, salvagedRefreshToken: refreshToken })
  }
  return { accessToken, tokenType: 'Bearer', expiresInSec, refreshToken, scope }
}

/** Form POST; `client_secret_basic` form-urlencodes id and secret before base64 (RFC 6749 §2.3.1).
 *  `timeoutMs` is clamped to ≤ 10_000 and covers `fetch` and the body read. */
export async function requestTokenEndpoint(input: {
  url: string
  client: OAuthClientCredentials
  params: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<OAuthTokenEndpointResponse> {
  const signal = callSignal(clampTimeoutMs(input.timeoutMs, TOKEN_TIMEOUT_MAX_MS), input.signal)
  const response = await postForm(input.url, input.client, new URLSearchParams(input.params), signal)
  const body = parseJsonObject(await readCappedText(response, signal))
  if (response.status < 200 || response.status > 299) throw errorResponse(response.status, body)
  if (!body) throw new OAuthTokenEndpointError('invalid_response', { status: response.status })
  return successResponse(response.status, body)
}

/** RFC 7009; 200 is success, including for an unknown token. `timeoutMs` clamped to ≤ 8_000. */
export async function revokeToken(input: {
  url: string
  client: OAuthClientCredentials
  token: string
  tokenTypeHint?: 'refresh_token' | 'access_token'
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<void> {
  const signal = callSignal(clampTimeoutMs(input.timeoutMs, REVOKE_TIMEOUT_MAX_MS), input.signal)
  const form = new URLSearchParams({ token: input.token })
  if (input.tokenTypeHint) form.set('token_type_hint', input.tokenTypeHint)
  const response = await postForm(input.url, input.client, form, signal)
  if (response.status === 200) {
    await discardBody(response)
    return
  }
  throw errorResponse(response.status, parseJsonObject(await readCappedText(response, signal)))
}
