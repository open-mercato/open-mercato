import { isOtelSdkBackend, isOtlpBackend, readTelemetryEnv, resetTelemetryEnvCache } from '../env'

const SAVED = { ...process.env }

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  resetTelemetryEnvCache()
}

afterEach(() => {
  process.env = { ...SAVED }
  resetTelemetryEnvCache()
})

describe('readTelemetryEnv', () => {
  it('defaults to the noop backend (off) when TELEMETRY_BACKEND is unset', () => {
    setEnv({ TELEMETRY_BACKEND: undefined })
    const env = readTelemetryEnv()
    expect(env.backend).toBe('noop')
    expect(env.enabled).toBe(false)
  })

  it('treats an unknown backend as noop', () => {
    setEnv({ TELEMETRY_BACKEND: 'datadog-lol' })
    expect(readTelemetryEnv().backend).toBe('noop')
  })

  it('accepts signoz/console and marks them enabled', () => {
    setEnv({ TELEMETRY_BACKEND: 'signoz' })
    expect(readTelemetryEnv()).toMatchObject({ backend: 'signoz', enabled: true })
    setEnv({ TELEMETRY_BACKEND: 'console' })
    expect(readTelemetryEnv()).toMatchObject({ backend: 'console', enabled: true })
  })

  it('accepts newrelic/otlp as OTLP backends (same seam, vendor by endpoint)', () => {
    setEnv({ TELEMETRY_BACKEND: 'newrelic' })
    expect(readTelemetryEnv()).toMatchObject({ backend: 'newrelic', enabled: true })
    setEnv({ TELEMETRY_BACKEND: 'otlp' })
    expect(readTelemetryEnv()).toMatchObject({ backend: 'otlp', enabled: true })
    expect(isOtlpBackend('newrelic')).toBe(true)
    expect(isOtlpBackend('otlp')).toBe(true)
    expect(isOtlpBackend('signoz')).toBe(true)
    expect(isOtlpBackend('console')).toBe(false)
    expect(isOtlpBackend('noop')).toBe(false)
  })

  it('isOtelSdkBackend reflects whether the OTEL SDK backend is active (bullmq-otel gate)', () => {
    setEnv({ TELEMETRY_BACKEND: 'otlp' })
    expect(isOtelSdkBackend()).toBe(true)
    setEnv({ TELEMETRY_BACKEND: 'signoz' })
    expect(isOtelSdkBackend()).toBe(true)
    setEnv({ TELEMETRY_BACKEND: 'newrelic' })
    expect(isOtelSdkBackend()).toBe(true)
    setEnv({ TELEMETRY_BACKEND: 'console' })
    expect(isOtelSdkBackend()).toBe(false)
    setEnv({ TELEMETRY_BACKEND: undefined })
    expect(isOtelSdkBackend()).toBe(false)
  })

  it('defaults log level to info and rejects invalid levels', () => {
    setEnv({ TELEMETRY_LOG_LEVEL: undefined })
    expect(readTelemetryEnv().logLevel).toBe('info')
    setEnv({ TELEMETRY_LOG_LEVEL: 'verbose' })
    expect(readTelemetryEnv().logLevel).toBe('info')
    setEnv({ TELEMETRY_LOG_LEVEL: 'debug' })
    expect(readTelemetryEnv().logLevel).toBe('debug')
  })

  it('parses sampling ratio and falls back / clamps invalid values', () => {
    setEnv({ TELEMETRY_SAMPLING_RATIO: '0.25', NODE_ENV: 'development' })
    expect(readTelemetryEnv().samplingRatio).toBe(0.25)
    setEnv({ TELEMETRY_SAMPLING_RATIO: '5', NODE_ENV: 'development' })
    expect(readTelemetryEnv().samplingRatio).toBe(1.0) // out of range -> dev default
    setEnv({ TELEMETRY_SAMPLING_RATIO: undefined, NODE_ENV: 'development' })
    expect(readTelemetryEnv().samplingRatio).toBe(1.0)
  })

  it('trust-inbound-trace defaults off (root-per-request), explicit values parse', () => {
    setEnv({ TELEMETRY_TRUST_INBOUND_TRACE: undefined })
    expect(readTelemetryEnv().trustInboundTrace).toBe(false)
    setEnv({ TELEMETRY_TRUST_INBOUND_TRACE: 'true' })
    expect(readTelemetryEnv().trustInboundTrace).toBe(true)
    setEnv({ TELEMETRY_TRUST_INBOUND_TRACE: '1' })
    expect(readTelemetryEnv().trustInboundTrace).toBe(true)
    setEnv({ TELEMETRY_TRUST_INBOUND_TRACE: 'false' })
    expect(readTelemetryEnv().trustInboundTrace).toBe(false)
    setEnv({ TELEMETRY_TRUST_INBOUND_TRACE: 'garbage' })
    expect(readTelemetryEnv().trustInboundTrace).toBe(false)
  })

  it('pretty stdout defaults to dev-only, with explicit override winning', () => {
    setEnv({ TELEMETRY_LOG_PRETTY: undefined, NODE_ENV: 'development' })
    expect(readTelemetryEnv().logPretty).toBe(true)
    setEnv({ TELEMETRY_LOG_PRETTY: undefined, NODE_ENV: 'production' })
    expect(readTelemetryEnv().logPretty).toBe(false) // prod must emit JSON
    setEnv({ TELEMETRY_LOG_PRETTY: undefined, NODE_ENV: 'test' })
    expect(readTelemetryEnv().logPretty).toBe(false)
    setEnv({ TELEMETRY_LOG_PRETTY: 'true', NODE_ENV: 'production' })
    expect(readTelemetryEnv().logPretty).toBe(true) // explicit on overrides prod
    setEnv({ TELEMETRY_LOG_PRETTY: 'false', NODE_ENV: 'development' })
    expect(readTelemetryEnv().logPretty).toBe(false) // explicit off overrides dev
  })
})
