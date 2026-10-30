import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { isIP } from 'node:net'
import * as http from 'node:http'
import * as https from 'node:https'
import { createPinnedLookup } from '@open-mercato/web-research'

const gzipAsync = promisify(gzip)

export const OTLP_HTTP_DEFAULT_TIMEOUT_MS = 10_000
export const OTEL_EXPORT_MARKER_HEADER = 'x-om-otel-export'
export const OTLP_JSON_CONTENT_TYPE = 'application/json'
export const OTLP_PROTOBUF_CONTENT_TYPE = 'application/x-protobuf'
export const OTLP_RETRYABLE_STATUSES: readonly number[] = [429, 502, 503, 504]

export const OTLP_ERROR_CODES = {
  timeout: 'timeout',
  network: 'network_error',
  invalidEndpoint: 'invalid_endpoint',
  encoding: 'encoding_failed',
} as const

export type OtlpExportOutcome = 'ok' | 'retry' | 'drop'

export type OtlpExportResult = {
  outcome: OtlpExportOutcome
  httpStatus: number | null
  retryAfterMs: number | null
  errorCode: string | null
  latencyMs: number
}

const HTTP_DATE_HINT_RE = /^[A-Za-z]{3,9},?\s/

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type PostOtlpTracesInput = {
  endpoint: string
  headers?: Record<string, string>
  body: string | Uint8Array
  contentType?: typeof OTLP_JSON_CONTENT_TYPE | typeof OTLP_PROTOBUF_CONTENT_TYPE
  timeoutMs?: number
  fetchImpl?: FetchLike
  now?: () => number
  /**
   * Vetted IP addresses (from `vetTenantOtlpEndpoint`) to pin the connection
   * to. When present the request bypasses `fetch` and DNS entirely; TLS SNI and
   * certificate validation still use the URL hostname. An empty or non-IP list
   * fails closed.
   */
  pinnedAddresses?: readonly string[]
}

type TransportResponse = { status: number; retryAfter: string | null }

function sendPinned(
  target: URL,
  addresses: readonly string[],
  headers: Record<string, string>,
  body: Buffer,
  signal: AbortSignal,
): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const secure = target.protocol === 'https:'
    const lookup = createPinnedLookup(addresses)
    const agent = secure
      ? new https.Agent({ keepAlive: false, lookup })
      : new http.Agent({ keepAlive: false, lookup })
    const send = secure ? https.request : http.request
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort)
      agent.destroy()
    }
    const request = send(
      {
        protocol: target.protocol,
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: target.port || (secure ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: { ...headers, 'content-length': String(body.length) },
        agent,
        lookup,
      },
      (response) => {
        const rawRetryAfter = response.headers['retry-after']
        const retryAfter = Array.isArray(rawRetryAfter) ? (rawRetryAfter[0] ?? null) : (rawRetryAfter ?? null)
        const status = response.statusCode ?? 0
        response.on('error', () => undefined)
        response.resume()
        finish()
        request.destroy()
        resolve({ status, retryAfter })
      },
    )
    function onAbort(): void {
      request.destroy(new Error('[internal] otlp export aborted'))
    }
    request.on('error', (error) => {
      finish()
      reject(error)
    })
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    request.end(body)
  })
}

function hasUsablePins(addresses: readonly string[]): boolean {
  return addresses.length > 0 && addresses.every((address) => isIP(address) !== 0)
}

/**
 * Parses an HTTP `Retry-After` header (delay-seconds or HTTP-date) into a
 * non-negative delay in milliseconds; `null` when absent or unparseable.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    return Number.isSafeInteger(seconds) ? seconds * 1000 : null
  }
  if (!HTTP_DATE_HINT_RE.test(trimmed)) return null
  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return null
  return Math.max(0, dateMs - nowMs)
}

export function classifyOtlpStatus(status: number): OtlpExportOutcome {
  if (status >= 200 && status < 300) return 'ok'
  if (OTLP_RETRYABLE_STATUSES.includes(status)) return 'retry'
  return 'drop'
}

function isValidEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    return
  }
}

/**
 * POSTs one gzip-compressed OTLP trace request — OTLP/JSON (a string body,
 * `application/json`, the default) or OTLP/protobuf (a byte body,
 * `application/x-protobuf`). Never throws and never
 * logs the endpoint or header values: the outcome is `ok` (2xx), `retry`
 * (429/502/503/504, network error, timeout; `Retry-After` honored) or `drop`
 * (any other status, an invalid endpoint, or an encoding failure). Redirects
 * are not followed so credentials never reach another host. With
 * `pinnedAddresses` the connection goes to those vetted IPs over `node:http(s)`
 * instead of `fetch`, so DNS cannot be re-resolved between vetting and sending.
 */
export async function postOtlpTraces(input: PostOtlpTracesInput): Promise<OtlpExportResult> {
  const now = input.now ?? Date.now
  const startedAt = now()
  const result = (
    outcome: OtlpExportOutcome,
    fields: Partial<Omit<OtlpExportResult, 'outcome' | 'latencyMs'>> = {},
  ): OtlpExportResult => ({
    outcome,
    httpStatus: fields.httpStatus ?? null,
    retryAfterMs: fields.retryAfterMs ?? null,
    errorCode: fields.errorCode ?? null,
    latencyMs: Math.max(0, now() - startedAt),
  })

  if (!isValidEndpoint(input.endpoint)) return result('drop', { errorCode: OTLP_ERROR_CODES.invalidEndpoint })
  if (input.pinnedAddresses !== undefined && !hasUsablePins(input.pinnedAddresses)) {
    return result('drop', { errorCode: OTLP_ERROR_CODES.invalidEndpoint })
  }

  let compressed: Buffer
  try {
    const raw = typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : Buffer.from(input.body)
    compressed = await gzipAsync(raw)
  } catch {
    return result('drop', { errorCode: OTLP_ERROR_CODES.encoding })
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, input.timeoutMs ?? OTLP_HTTP_DEFAULT_TIMEOUT_MS)
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    'content-type': input.contentType ?? OTLP_JSON_CONTENT_TYPE,
    'content-encoding': 'gzip',
    [OTEL_EXPORT_MARKER_HEADER]: '1',
  }

  try {
    let response: TransportResponse
    if (input.pinnedAddresses !== undefined) {
      response = await sendPinned(new URL(input.endpoint), input.pinnedAddresses, headers, compressed, controller.signal)
    } else {
      const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init))
      const fetched = await fetchImpl(input.endpoint, {
        method: 'POST',
        headers,
        body: new Uint8Array(compressed),
        redirect: 'manual',
        signal: controller.signal,
      })
      await discardBody(fetched)
      response = { status: fetched.status, retryAfter: fetched.headers.get('retry-after') }
    }
    const outcome = classifyOtlpStatus(response.status)
    if (outcome === 'ok') return result('ok', { httpStatus: response.status })
    return result(outcome, {
      httpStatus: response.status,
      retryAfterMs: outcome === 'retry' ? parseRetryAfter(response.retryAfter, now()) : null,
      errorCode: `http_${response.status}`,
    })
  } catch {
    return result('retry', { errorCode: timedOut ? OTLP_ERROR_CODES.timeout : OTLP_ERROR_CODES.network })
  } finally {
    clearTimeout(timer)
  }
}
