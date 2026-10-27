import { describe, expect, jest, test } from '@jest/globals'
import { gunzipSync } from 'node:zlib'
import {
  OTEL_EXPORT_MARKER_HEADER,
  classifyOtlpStatus,
  parseRetryAfter,
  postOtlpTraces,
} from '../lib/trace/otel/otlpHttpClient'

const ENDPOINT = 'http://collector:4318/v1/traces'
const BODY = JSON.stringify({ resourceSpans: [{ scopeSpans: [] }] })

type CapturedRequest = { url: string; init: RequestInit }

function respondWith(status: number, headers: Record<string, string> = {}) {
  const calls: CapturedRequest[] = []
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(status === 204 ? null : 'body', { status, headers })
  })
  return { fetchImpl, calls }
}

describe('parseRetryAfter', () => {
  const nowMs = Date.parse('2026-10-27T12:00:00.000Z')

  test('parses delay-seconds', () => {
    expect(parseRetryAfter('7', nowMs)).toBe(7000)
    expect(parseRetryAfter(' 0 ', nowMs)).toBe(0)
  })

  test('parses an HTTP-date relative to now and clamps past dates to zero', () => {
    expect(parseRetryAfter('Tue, 27 Oct 2026 12:00:30 GMT', nowMs)).toBe(30_000)
    expect(parseRetryAfter('Tue, 27 Oct 2026 11:00:00 GMT', nowMs)).toBe(0)
  })

  test('returns null for missing or malformed values', () => {
    expect(parseRetryAfter(null, nowMs)).toBeNull()
    expect(parseRetryAfter('', nowMs)).toBeNull()
    expect(parseRetryAfter('-1', nowMs)).toBeNull()
    expect(parseRetryAfter('soon', nowMs)).toBeNull()
  })
})

describe('classifyOtlpStatus', () => {
  test.each([
    [200, 'ok'],
    [204, 'ok'],
    [429, 'retry'],
    [502, 'retry'],
    [503, 'retry'],
    [504, 'retry'],
    [301, 'drop'],
    [400, 'drop'],
    [401, 'drop'],
    [404, 'drop'],
    [413, 'drop'],
    [500, 'drop'],
  ] as const)('%i → %s', (status, outcome) => {
    expect(classifyOtlpStatus(status)).toBe(outcome)
  })
})

describe('postOtlpTraces', () => {
  test('posts a gzip JSON body with the export headers', async () => {
    const { fetchImpl, calls } = respondWith(200)
    const result = await postOtlpTraces({
      endpoint: ENDPOINT,
      headers: { 'api-key': 'secret', 'content-type': 'text/plain' },
      body: BODY,
      fetchImpl,
    })
    expect(result).toMatchObject({ outcome: 'ok', httpStatus: 200, retryAfterMs: null, errorCode: null })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.headers).toEqual({
      'api-key': 'secret',
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      [OTEL_EXPORT_MARKER_HEADER]: '1',
    })
    const sent = Buffer.from(init.body as Uint8Array)
    expect(gunzipSync(sent).toString('utf8')).toBe(BODY)
  })

  test('retries a 503 and honors Retry-After', async () => {
    const { fetchImpl } = respondWith(503, { 'retry-after': '12' })
    const result = await postOtlpTraces({ endpoint: ENDPOINT, body: BODY, fetchImpl })
    expect(result).toMatchObject({ outcome: 'retry', httpStatus: 503, retryAfterMs: 12_000, errorCode: 'http_503' })
  })

  test('retries a 429 without Retry-After', async () => {
    const { fetchImpl } = respondWith(429)
    const result = await postOtlpTraces({ endpoint: ENDPOINT, body: BODY, fetchImpl })
    expect(result).toMatchObject({ outcome: 'retry', httpStatus: 429, retryAfterMs: null, errorCode: 'http_429' })
  })

  test('drops other non-2xx responses', async () => {
    const { fetchImpl } = respondWith(400, { 'retry-after': '5' })
    const result = await postOtlpTraces({ endpoint: ENDPOINT, body: BODY, fetchImpl })
    expect(result).toMatchObject({ outcome: 'drop', httpStatus: 400, retryAfterMs: null, errorCode: 'http_400' })
  })

  test('retries a network error', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const result = await postOtlpTraces({ endpoint: ENDPOINT, body: BODY, fetchImpl })
    expect(result).toMatchObject({ outcome: 'retry', httpStatus: null, errorCode: 'network_error' })
  })

  test('aborts and retries on timeout', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const result = await postOtlpTraces({ endpoint: ENDPOINT, body: BODY, fetchImpl, timeoutMs: 20 })
    expect(result).toMatchObject({ outcome: 'retry', httpStatus: null, errorCode: 'timeout' })
  })

  test('drops an invalid endpoint without calling fetch', async () => {
    const { fetchImpl } = respondWith(200)
    const result = await postOtlpTraces({ endpoint: 'file:///etc/passwd', body: BODY, fetchImpl })
    expect(result).toMatchObject({ outcome: 'drop', errorCode: 'invalid_endpoint' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('measures latency with the injected clock', async () => {
    const { fetchImpl } = respondWith(204)
    const ticks = [1000, 1250, 1250]
    const now = () => ticks.shift() ?? 1250
    const result = await postOtlpTraces({ endpoint: ENDPOINT, body: BODY, fetchImpl, now })
    expect(result).toMatchObject({ outcome: 'ok', httpStatus: 204, latencyMs: 250 })
  })
})
