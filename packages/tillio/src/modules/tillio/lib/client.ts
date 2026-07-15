import { z } from 'zod'
import { fetchWithTimeout, FetchTimeoutError } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { TillioApiError } from './errors'
import { assertPublicTillioApiUrl } from './url-guard'

const TILLIO_REQUEST_TIMEOUT_MS = 15_000
const TILLIO_MIN_REQUEST_SPACING_MS = 200
const TILLIO_MAX_RETRIES = 3
const TILLIO_RETRY_BASE_MS = 500
const TILLIO_RETRY_MAX_MS = 8_000
const RETRYABLE_STATUSES = new Set([429, 503])

export type TillioPlugin = 'Ringostat' | 'P4' | 'Focus' | 'Plus'

export type TillioClientEnvironment = {
  apiUrl: string
  apiKey: string
  tenantSystemId: string
}

const addConfigResponseSchema = z.object({ token: z.string().min(1) })
const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})

// Tillio serializes pagination counters as strings ("52", "1"); tolerate numbers too.
const counterSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    ctx.addIssue({ code: 'custom', message: 'Tillio returned an unusable pagination counter' })
    return z.NEVER
  }
  return Math.trunc(parsed)
})

// Calls stay raw records here: mapping is the normalizer's job, and `raw_snapshot`
// must keep every field Tillio sent, including operator-specific `extraFields`.
const getCallsResponseSchema = z.object({
  calls: z.array(z.record(z.string(), z.unknown())).default([]),
  pagination: z.object({
    total: counterSchema,
    page: counterSchema,
    pages: counterSchema,
  }),
})

export type TillioCallsPage = z.infer<typeof getCallsResponseSchema>

export type GetCallsParams = {
  tenantDomain: string
  token: string
  from?: string
  to?: string
  page?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampRetryAfterMs(header: string | null, fallback: number): number {
  if (!header) return fallback
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, TILLIO_RETRY_MAX_MS)
  return fallback
}

function backoffMs(attempt: number): number {
  const exponential = Math.min(TILLIO_RETRY_BASE_MS * 2 ** attempt, TILLIO_RETRY_MAX_MS)
  const jitter = Math.floor(Math.random() * TILLIO_RETRY_BASE_MS)
  return exponential + jitter
}

export function createTillioClient(environment: TillioClientEnvironment) {
  const apiUrl = environment.apiUrl.trim().replace(/\/+$/, '')
  const apiKey = environment.apiKey.trim()
  const tenantSystemId = environment.tenantSystemId.trim()
  if (!apiUrl) throw new Error('Tillio environment is missing the API URL.')
  if (!apiKey) throw new Error('Tillio environment is missing the API key.')
  if (!tenantSystemId) throw new Error('Tillio environment is missing the tenant system id.')
  // SSRF guard: apiUrl is user-supplied, so reject loopback/private/link-local targets
  // before any request goes out (covers health check, validate, attach/detach, pull).
  assertPublicTillioApiUrl(apiUrl)

  let lastRequestAt = 0

  function buildHeaders(tenantDomain: string, token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Api-Key': apiKey,
      'X-System': tenantSystemId,
      'X-Tenant': tenantSystemId,
      'X-Tenant-Domain': tenantDomain,
    }
    if (token) headers['X-Token'] = token
    return headers
  }

  async function throttle(): Promise<void> {
    const wait = Math.max(0, TILLIO_MIN_REQUEST_SPACING_MS - (Date.now() - lastRequestAt))
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
  }

  function resolveUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(path.replace(/^\/+/, ''), `${apiUrl}/`)
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    return url.toString()
  }

  async function rawRequest(
    method: string,
    url: string,
    init: { headers: Record<string, string>; body?: unknown },
    attempt = 0,
  ): Promise<Response> {
    await throttle()
    const hasBody = init.body !== undefined
    let response: Response
    try {
      response = await fetchWithTimeout(url, {
        method,
        timeoutMs: TILLIO_REQUEST_TIMEOUT_MS,
        headers: {
          accept: 'application/json',
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
        ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
      })
    } catch (err) {
      if (err instanceof FetchTimeoutError) {
        throw new TillioApiError(`Tillio request timed out: ${method} ${url}`, 0, 'timeout')
      }
      const message = err instanceof Error ? err.message : 'network error'
      throw new TillioApiError(`Tillio request failed: ${method} ${url}: ${message}`, 0, 'network')
    }

    if (RETRYABLE_STATUSES.has(response.status) && attempt < TILLIO_MAX_RETRIES) {
      const delay = clampRetryAfterMs(response.headers.get('retry-after'), backoffMs(attempt))
      await sleep(delay)
      return rawRequest(method, url, init, attempt + 1)
    }

    return response
  }

  async function requestJson<T>(
    method: string,
    path: string,
    options: { headers: Record<string, string>; body?: unknown; query?: Record<string, string>; schema: z.ZodType<T> },
  ): Promise<T> {
    const url = resolveUrl(path, options.query)
    const response = await rawRequest(method, url, { headers: options.headers, body: options.body })
    const text = await response.text()

    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      throw new TillioApiError(
        response.ok ? 'Tillio returned a non-JSON response' : `Tillio request failed (${response.status})`,
        response.status,
        text.slice(0, 200),
      )
    }

    const asError = errorResponseSchema.safeParse(parsed)
    if (asError.success && asError.data.error) {
      throw new TillioApiError(asError.data.message ?? asError.data.error, response.status, asError.data.error)
    }

    if (!response.ok) {
      throw new TillioApiError(`Tillio request failed (${response.status})`, response.status, JSON.stringify(parsed).slice(0, 200))
    }

    return options.schema.parse(parsed)
  }

  return {
    async getPlugins(tenantDomain: string): Promise<unknown> {
      return requestJson('GET', '/api/plugins', { headers: buildHeaders(tenantDomain), schema: z.unknown() })
    },

    async getCalls(params: GetCallsParams): Promise<TillioCallsPage> {
      const query: Record<string, string> = {}
      if (params.from) query.from = params.from
      if (params.to) query.to = params.to
      if (params.page !== undefined) query.page = String(params.page)
      return requestJson('GET', '/api/call', {
        headers: buildHeaders(params.tenantDomain, params.token),
        query,
        schema: getCallsResponseSchema,
      })
    },

    async validateConfig(plugin: TillioPlugin, config: Record<string, unknown>, tenantDomain: string): Promise<void> {
      await requestJson('POST', '/api/config/validate', { headers: buildHeaders(tenantDomain), body: { plugin, config }, schema: z.unknown() })
    },

    async addConfig(plugin: TillioPlugin, config: Record<string, unknown>, tenantDomain: string): Promise<{ token: string }> {
      return requestJson('POST', '/api/config', { headers: buildHeaders(tenantDomain), body: { plugin, config }, schema: addConfigResponseSchema })
    },

    async deleteConfig(plugin: TillioPlugin, token: string, tenantDomain: string): Promise<void> {
      await requestJson('DELETE', '/api/config', { headers: buildHeaders(tenantDomain), query: { plugin, token }, schema: z.unknown() })
    },
  }
}
