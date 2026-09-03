import { POST } from '../modules/telemetry/api/browser-traces/route'

const ENV_KEYS = [
  'TELEMETRY_BROWSER_ENABLED',
  'TELEMETRY_BACKEND',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
] as const

function enableBrowserTelemetry(): void {
  process.env.TELEMETRY_BROWSER_ENABLED = 'true'
  process.env.TELEMETRY_BACKEND = 'otlp'
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318'
}

/**
 * The statuses `@opentelemetry/otlp-exporter-base/is-export-retryable` treats as retryable. Any of
 * them on a failure path turns a collector outage into a retry storm from every open tab, which is
 * exactly what the route's fire-and-forget contract exists to prevent.
 */
const EXPORTER_RETRYABLE_STATUSES = [429, 502, 503, 504]

function traceRequest(init?: RequestInit & { headers?: Record<string, string> }): Request {
  return new Request('http://localhost/api/telemetry/browser-traces', {
    method: 'POST',
    body: '{"resourceSpans":[]}',
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('browser-traces proxy route', () => {
  const original: Record<string, string | undefined> = {}
  const realFetch = global.fetch

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
    global.fetch = realFetch
  })

  it('accepts and drops with 204 when browser telemetry is disabled — a stale client must not retry', async () => {
    const fetchSpy = jest.fn()
    global.fetch = fetchSpy as typeof fetch

    const res = await POST(traceRequest())

    expect(res.status).toBe(204)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('forwards the payload to the collector with server-side credentials and returns 202', async () => {
    enableBrowserTelemetry()
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'api-key=secret123'
    const fetchSpy = jest.fn(async () => new Response(null, { status: 200 }))
    global.fetch = fetchSpy as unknown as typeof fetch

    const res = await POST(traceRequest())

    expect(res.status).toBe(202)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [target, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(target).toBe('http://collector:4318/v1/traces')
    expect((init.headers as Record<string, string>)['api-key']).toBe('secret123')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('drops the batch with a non-retryable 202 when the collector rejects it, without throwing', async () => {
    enableBrowserTelemetry()
    global.fetch = jest.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch

    const res = await POST(traceRequest())

    expect(res.status).toBe(202)
    expect(EXPORTER_RETRYABLE_STATUSES).not.toContain(res.status)
  })

  it('drops the batch with a non-retryable 202 when the collector is unreachable, without throwing', async () => {
    enableBrowserTelemetry()
    global.fetch = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch

    const res = await POST(traceRequest())

    expect(res.status).toBe(202)
    expect(EXPORTER_RETRYABLE_STATUSES).not.toContain(res.status)
  })

  it('refuses an oversized declared content-length before buffering', async () => {
    enableBrowserTelemetry()
    const fetchSpy = jest.fn()
    global.fetch = fetchSpy as typeof fetch

    const res = await POST(
      traceRequest({ headers: { 'content-type': 'application/json', 'content-length': '2000000' } }),
    )

    expect(res.status).toBe(413)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the declared-size cap even when telemetry is disabled — the cap is an unconditional contract', async () => {
    const res = await POST(
      traceRequest({ headers: { 'content-type': 'application/json', 'content-length': '2000000' } }),
    )

    expect(res.status).toBe(413)
  })

  it('refuses a body that exceeds the cap even when content-length lies', async () => {
    enableBrowserTelemetry()
    const fetchSpy = jest.fn()
    global.fetch = fetchSpy as typeof fetch

    const oversized = 'x'.repeat(1_000_001)
    const res = await POST(traceRequest({ body: oversized }))

    expect(res.status).toBe(413)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('acknowledges an empty batch with 202 without calling the collector', async () => {
    enableBrowserTelemetry()
    const fetchSpy = jest.fn()
    global.fetch = fetchSpy as typeof fetch

    const res = await POST(traceRequest({ body: null }))

    expect(res.status).toBe(202)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
