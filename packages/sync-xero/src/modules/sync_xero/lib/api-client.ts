import type { OAuthGrantOwner, OAuthProviderDescriptor } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import type { IntegrationOAuthGrantService, OAuthAccessToken } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { classifyResourceChallenge } from '@open-mercato/core/modules/integrations/lib/oauth/resource-challenge'
import type { XeroEndpoints } from './constants'
import { parseXeroConnections, type XeroConnection } from './connections'
import { XeroApiError } from './errors'

export type XeroClientBudget = 'run' | 'interactive'

export type XeroQuota = {
  dayRemaining: number | null
  minuteRemaining: number | null
  appMinuteRemaining: number | null
}

export type XeroApiResponse<T> = {
  body: T
  quota: XeroQuota
  date: Date | null
  providerData: Record<string, unknown> | null
}

export type XeroRequest = {
  url: string
  xeroTenantId?: string
  ifModifiedSince?: Date | null
}

export type XeroApiClientOptions = {
  grantService: Pick<IntegrationOAuthGrantService, 'getAccessToken'>
  descriptor: OAuthProviderDescriptor
  owner: OAuthGrantOwner
  endpoints: Pick<XeroEndpoints, 'connections' | 'accounting'>
  budget: XeroClientBudget
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
}

export type XeroApiClient = {
  readonly endpoints: Pick<XeroEndpoints, 'connections' | 'accounting'>
  getToken(): Promise<OAuthAccessToken>
  listConnections(input?: { authEventId?: string | null }): Promise<XeroApiResponse<XeroConnection[]>>
  request(input: XeroRequest): Promise<XeroApiResponse<unknown>>
}

const RUN_TIMEOUT_MS = 30_000
const INTERACTIVE_TIMEOUT_MS = 5_000
const MINUTE_WINDOW_MS = 60_000
const RATE_LIMIT_WAIT_CAP_MS = 60_000
const MAX_RATE_LIMIT_WAITS = 5
const SERVER_ERROR_BACKOFF_MS = [1_000, 2_000, 4_000] as const
const MISSPELLED_SCOPE_CHALLENGE = /insufficent_scope/gi

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function readIntegerHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw.trim())
  return Number.isInteger(value) ? value : null
}

function readQuota(headers: Headers): XeroQuota {
  return {
    dayRemaining: readIntegerHeader(headers, 'x-daylimit-remaining'),
    minuteRemaining: readIntegerHeader(headers, 'x-minlimit-remaining'),
    appMinuteRemaining: readIntegerHeader(headers, 'x-appminlimit-remaining'),
  }
}

function readDateHeader(headers: Headers): Date | null {
  const raw = headers.get('date')
  if (!raw) return null
  const value = new Date(raw)
  return Number.isNaN(value.getTime()) ? null : value
}

export function parseRetryAfterMs(raw: string | null, nowMs: number): number | null {
  if (raw === null || raw.trim() === '') return null
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - nowMs)
}

export function formatIfModifiedSince(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function normalizeChallenge(header: string | null): string | null {
  return header === null ? null : header.replace(MISSPELLED_SCOPE_CHALLENGE, 'insufficient_scope')
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    return
  }
}

function isAbortFromCaller(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

export function createXeroApiClient(options: XeroApiClientOptions): XeroApiClient {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const timeoutMs = options.budget === 'interactive' ? INTERACTIVE_TIMEOUT_MS : RUN_TIMEOUT_MS
  let nextRequestNotBefore = 0

  async function obtainToken(rejectedAccessToken?: string): Promise<OAuthAccessToken> {
    return options.grantService.getAccessToken(
      options.descriptor,
      options.owner,
      rejectedAccessToken === undefined ? undefined : { rejectedAccessToken },
    )
  }

  async function waitForMinuteWindow(): Promise<void> {
    if (options.budget !== 'run') return
    const waitMs = nextRequestNotBefore - now()
    if (waitMs > 0) await sleep(waitMs, options.signal)
  }

  function recordPacing(response: Response): void {
    if (readIntegerHeader(response.headers, 'x-minlimit-remaining') !== 0) return
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), now())
    nextRequestNotBefore = now() + Math.min(retryAfterMs ?? MINUTE_WINDOW_MS, RATE_LIMIT_WAIT_CAP_MS)
  }

  async function send(request: XeroRequest, accessToken: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    }
    if (request.xeroTenantId) headers['xero-tenant-id'] = request.xeroTenantId
    if (request.ifModifiedSince) headers['If-Modified-Since'] = formatIfModifiedSince(request.ifModifiedSince)
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
    return fetchImpl(request.url, { method: 'GET', headers, redirect: 'manual', signal })
  }

  function parseBody(text: string, status: number): unknown {
    if (text.trim() === '') return null
    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      throw new XeroApiError('transient', { status, cause: error })
    }
  }

  async function isOrganisationStillConnected(xeroTenantId: string): Promise<boolean> {
    const connections = await execute({ url: options.endpoints.connections })
    return parseXeroConnections(connections.body).some((connection) => connection.tenantId === xeroTenantId)
  }

  async function execute(request: XeroRequest): Promise<XeroApiResponse<unknown>> {
    let token = await obtainToken()
    let retriedRejectedToken = false
    let rateLimitWaits = 0
    let serverErrorRetries = 0

    const retryAfterServerError = async (status: number | null, cause?: unknown): Promise<void> => {
      if (options.budget !== 'run' || serverErrorRetries >= SERVER_ERROR_BACKOFF_MS.length) {
        throw new XeroApiError('transient', { status, cause })
      }
      const delay = SERVER_ERROR_BACKOFF_MS[serverErrorRetries]
      serverErrorRetries += 1
      await sleep(delay, options.signal)
    }

    for (;;) {
      await waitForMinuteWindow()
      let response: Response
      try {
        response = await send(request, token.accessToken)
      } catch (error) {
        if (isAbortFromCaller(options.signal)) throw error
        await retryAfterServerError(null, error)
        continue
      }
      recordPacing(response)

      if (response.ok) {
        let text: string
        try {
          text = await response.text()
        } catch (error) {
          if (isAbortFromCaller(options.signal)) throw error
          await retryAfterServerError(null, error)
          continue
        }
        const body = parseBody(text, response.status)
        return { body, quota: readQuota(response.headers), date: readDateHeader(response.headers), providerData: token.providerData }
      }

      const status = response.status
      if (status === 401 || status === 403) {
        const challenge = classifyResourceChallenge(status, normalizeChallenge(response.headers.get('www-authenticate')))
        await discardBody(response)
        if (challenge === 'scope_insufficient') throw new XeroApiError('scope_insufficient', { status })
        if (status === 401) {
          if (retriedRejectedToken) throw new XeroApiError('unauthorized', { status })
          retriedRejectedToken = true
          token = await obtainToken(token.accessToken)
          continue
        }
        if (request.xeroTenantId && !(await isOrganisationStillConnected(request.xeroTenantId))) {
          throw new XeroApiError('organisation_not_authorised', { status })
        }
        throw new XeroApiError('forbidden', { status })
      }

      if (status === 429) {
        const problem = (response.headers.get('x-rate-limit-problem') ?? '').trim().toLowerCase()
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), now())
        await discardBody(response)
        const dailyLimit = problem === 'day' || (problem === '' && retryAfterMs !== null && retryAfterMs > RATE_LIMIT_WAIT_CAP_MS)
        if (dailyLimit) throw new XeroApiError('daily_limit', { status })
        if (options.budget !== 'run') throw new XeroApiError('rate_limited', { status })
        if (rateLimitWaits >= MAX_RATE_LIMIT_WAITS) throw new XeroApiError('transient', { status })
        rateLimitWaits += 1
        await sleep(Math.min(retryAfterMs ?? MINUTE_WINDOW_MS, RATE_LIMIT_WAIT_CAP_MS), options.signal)
        continue
      }

      await discardBody(response)
      if (status >= 500) {
        await retryAfterServerError(status)
        continue
      }
      throw new XeroApiError('request_rejected', { status })
    }
  }

  return {
    endpoints: options.endpoints,
    getToken: () => obtainToken(),
    async listConnections(input) {
      const url = new URL(options.endpoints.connections)
      if (input?.authEventId) url.searchParams.set('authEventId', input.authEventId)
      const response = await execute({ url: url.toString() })
      return { ...response, body: parseXeroConnections(response.body) }
    },
    request: execute,
  }
}
