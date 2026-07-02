import fs from 'node:fs'
import path from 'node:path'
import { telemetryServerExternalPackages, recordHttpDuration, registerTelemetryForNextjs } from '../nextjs'
import { resetTelemetryInit } from '../init'
import { registerProvider, resetActiveProvider } from '../provider/registry'
import { resetTelemetryEnvCache } from '../env'
import { runSpan } from '../provider/run-span'
import type { MetricPoint, Span, SpanOptions, TelemetryProvider } from '../types'

class RecordingSpan implements Span {
  setAttribute(): void {}
  setAttributes(): void {}
  recordException(): void {}
  setStatus(): void {}
  end(): void {}
}

function otelSpecifiersInSource(): string[] {
  // Scan every source file except nextjs.ts itself (it contains the list under
  // test) and the tests, so the expected set is derived from what the provider
  // actually imports rather than a second hand-maintained copy.
  const specifiers = new Set<string>()
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(full)
      } else if (entry.name.endsWith('.ts') && full !== path.resolve(__dirname, '../nextjs.ts')) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(/['"](@opentelemetry\/[a-z0-9-]+)['"]/g)) {
          specifiers.add(match[1])
        }
      }
    }
  }
  visit(path.resolve(__dirname, '..'))
  return [...specifiers].sort()
}

function recordingProvider() {
  const metrics: MetricPoint[] = []
  let starts = 0
  const span = new RecordingSpan()
  const provider: TelemetryProvider = {
    name: 'noop', // matches the default backend so initTelemetry picks it up
    supports: ['traces', 'metrics', 'logs', 'errors'],
    async start() {
      starts += 1
    },
    async shutdown() {},
    runInSpan<T>(_name: string, _options: SpanOptions, fn: (s: Span) => T): T {
      return runSpan(span, fn)
    },
    activeSpan: () => undefined,
    inject: () => {},
    runInRemoteSpan<T>(_carrier, _name: string, _options: SpanOptions, fn: (s: Span) => T): T {
      return runSpan(span, fn)
    },
    emitLog: () => {},
    recordMetric: (point) => metrics.push(point),
  }
  return { provider, metrics, startCount: () => starts }
}

describe('telemetry/nextjs helpers', () => {
  beforeEach(() => {
    resetActiveProvider()
    resetTelemetryInit()
    resetTelemetryEnvCache()
    delete process.env.TELEMETRY_BACKEND
    delete process.env.NEXT_RUNTIME
  })

  it('externals list is the full OTEL set the provider loads (no partial-copy footgun)', () => {
    // Every @opentelemetry/* package the provider imports must be listed, or the
    // bundler re-bundles a patched module and telemetry silently emits nothing.
    // Set-equality both ways: a new provider import without a list entry fails,
    // and so does a stale list entry nothing imports anymore.
    expect([...telemetryServerExternalPackages].sort()).toEqual(otelSpecifiersInSource())
    expect(telemetryServerExternalPackages.every((p) => p.startsWith('@opentelemetry/'))).toBe(true)
  })

  it('recordHttpDuration emits the semconv histogram; error.type only on 5xx', async () => {
    const { provider, metrics } = recordingProvider()
    registerProvider(provider)
    await registerTelemetryForNextjs()

    recordHttpDuration('GET', '/api/[...slug]', 200, Date.now())
    recordHttpDuration('POST', '/api/[...slug]', 500, Date.now())

    const points = metrics.filter((m) => m.name === 'http.server.request.duration')
    expect(points).toHaveLength(2)
    expect(points[0].kind).toBe('histogram')
    expect(points[0].unit).toBe('s')
    expect(points[0].labels).toMatchObject({
      'http.request.method': 'GET',
      'http.route': '/api/[...slug]',
      'http.response.status_code': 200,
    })
    expect(points[0].labels?.['error.type']).toBeUndefined()
    expect(points[1].labels?.['error.type']).toBe('500')
  })

  it('registerTelemetryForNextjs is a safe no-op when telemetry is off', async () => {
    await expect(registerTelemetryForNextjs()).resolves.toBeUndefined()
  })

  it('skips initialization on the edge runtime (NodeSDK is Node-only)', async () => {
    const { provider, startCount } = recordingProvider()
    registerProvider(provider)

    process.env.NEXT_RUNTIME = 'edge'
    await registerTelemetryForNextjs()
    expect(startCount()).toBe(0)

    process.env.NEXT_RUNTIME = 'nodejs'
    await registerTelemetryForNextjs()
    expect(startCount()).toBe(1)
  })
})
