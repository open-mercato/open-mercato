import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)

export const OTLP_HTTP_DEFAULT_TIMEOUT_MS = 10_000
export const OTEL_EXPORT_MARKER_HEADER = 'x-om-otel-export'
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
  body: string
  timeoutMs?: number
  fetchImpl?: FetchLike
  now?: () => number
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
 * POSTs one gzip-compressed OTLP/JSON trace request. Never throws and never
 * logs the endpoint or header values: the outcome is `ok` (2xx), `retry`
 * (429/502/503/504, network error, timeout; `Retry-After` honored) or `drop`
 * (any other status, an invalid endpoint, or an encoding failure). Redirects
 * are not followed so credentials never reach another host.
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

  let compressed: Buffer
  try {
    compressed = await gzipAsync(Buffer.from(input.body, 'utf8'))
  } catch {
    return result('drop', { errorCode: OTLP_ERROR_CODES.encoding })
  }

  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init))
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, input.timeoutMs ?? OTLP_HTTP_DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetchImpl(input.endpoint, {
      method: 'POST',
      headers: {
        ...(input.headers ?? {}),
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        [OTEL_EXPORT_MARKER_HEADER]: '1',
      },
      body: new Uint8Array(compressed),
      redirect: 'manual',
      signal: controller.signal,
    })
    await discardBody(response)
    const outcome = classifyOtlpStatus(response.status)
    if (outcome === 'ok') return result('ok', { httpStatus: response.status })
    return result(outcome, {
      httpStatus: response.status,
      retryAfterMs: outcome === 'retry' ? parseRetryAfter(response.headers.get('retry-after'), now()) : null,
      errorCode: `http_${response.status}`,
    })
  } catch {
    return result('retry', { errorCode: timedOut ? OTLP_ERROR_CODES.timeout : OTLP_ERROR_CODES.network })
  } finally {
    clearTimeout(timer)
  }
}
