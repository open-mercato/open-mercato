import {
  registerLoggerExtension,
  resetLoggerExtension,
  type LoggerExtensionRecord,
} from '@open-mercato/shared/lib/logger'
import { BROWSER_TRACES_PATH } from '../browser/config'
import {
  BROWSER_TELEMETRY_TEST_COOKIE,
  resetBrowserTelemetryWarnings,
  resolveBrowserTelemetryConfig,
  resolveCollectorHeaders,
  resolveCollectorTracesUrl,
} from '../browser/server'
import { resetTelemetryEnvCache } from '../env'

// The env keys this module reads. Cleared before each case so a leaked value from the developer's
// own .env cannot make a test pass for the wrong reason.
const TELEMETRY_ENV_KEYS = [
  'TELEMETRY_BROWSER_ENABLED',
  'TELEMETRY_BROWSER_SAMPLING_RATIO',
  'TELEMETRY_BROWSER_SERVICE_NAME',
  'TELEMETRY_BACKEND',
  'TELEMETRY_TRUST_INBOUND_TRACE',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_SERVICE_NAME',
  'OTEL_RESOURCE_ATTRIBUTES',
  'OM_TEST_MODE',
  'OM_TEST_BROWSER_TELEMETRY_MODE',
] as const

describe('browser telemetry config', () => {
  const original: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of TELEMETRY_ENV_KEYS) {
      original[key] = process.env[key]
      delete process.env[key]
    }
    resetTelemetryEnvCache()
    resetBrowserTelemetryWarnings()
  })

  afterEach(() => {
    for (const key of TELEMETRY_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
    resetTelemetryEnvCache()
  })

  describe('resolveBrowserTelemetryConfig', () => {
    it('is off unless explicitly enabled — the SDK chunk must never load by accident', () => {
      process.env.TELEMETRY_BACKEND = 'signoz'
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318'

      expect(resolveBrowserTelemetryConfig()).toBeNull()
    })

    it('stays off when the server telemetry backend is absent or a no-op', () => {
      process.env.TELEMETRY_BROWSER_ENABLED = 'true'
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318'

      expect(resolveBrowserTelemetryConfig()).toBeNull()

      process.env.TELEMETRY_BACKEND = 'noop'
      expect(resolveBrowserTelemetryConfig()).toBeNull()
    })

    it('stays off with a backend but no collector endpoint — RUM with nowhere to export is pure client overhead', () => {
      process.env.TELEMETRY_BROWSER_ENABLED = 'true'
      process.env.TELEMETRY_BACKEND = 'signoz'

      expect(resolveBrowserTelemetryConfig()).toBeNull()
    })

    it('derives service name and deployment.environment from the existing server telemetry env', () => {
      process.env.TELEMETRY_BROWSER_ENABLED = 'true'
      process.env.TELEMETRY_BACKEND = 'signoz'
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318'
      process.env.OTEL_SERVICE_NAME = 'acme-oms'
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'deployment.environment=production,foo=bar'

      const config = resolveBrowserTelemetryConfig()

      // Separate service so RUM latency does not distort the server service's charts.
      expect(config?.serviceName).toBe('acme-oms-browser')
      expect(config?.environment).toBe('production')
      // Same-origin proxy — never the collector itself.
      expect(config?.endpoint).toBe(BROWSER_TRACES_PATH)
    })

    it('honors an explicit browser service name override', () => {
      process.env.TELEMETRY_BROWSER_ENABLED = 'true'
      process.env.TELEMETRY_BACKEND = 'signoz'
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318'
      process.env.TELEMETRY_BROWSER_SERVICE_NAME = 'storefront-rum'

      expect(resolveBrowserTelemetryConfig()?.serviceName).toBe('storefront-rum')
    })

    it('tolerates OTEL_RESOURCE_ATTRIBUTES without deployment.environment', () => {
      process.env.TELEMETRY_BROWSER_ENABLED = 'true'
      process.env.TELEMETRY_BACKEND = 'signoz'
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318'
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'foo=bar'

      expect(resolveBrowserTelemetryConfig()?.environment).toBeNull()
    })

    it('defaults sampling to 1.0 and clamps out-of-range or garbage values', () => {
      process.env.TELEMETRY_BROWSER_ENABLED = 'true'
      process.env.TELEMETRY_BACKEND = 'signoz'
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318'

      expect(resolveBrowserTelemetryConfig()?.samplingRatio).toBe(1)

      process.env.TELEMETRY_BROWSER_SAMPLING_RATIO = '0.25'
      expect(resolveBrowserTelemetryConfig()?.samplingRatio).toBe(0.25)

      process.env.TELEMETRY_BROWSER_SAMPLING_RATIO = '7'
      expect(resolveBrowserTelemetryConfig()?.samplingRatio).toBe(1)

      process.env.TELEMETRY_BROWSER_SAMPLING_RATIO = '-1'
      expect(resolveBrowserTelemetryConfig()?.samplingRatio).toBe(0)

      process.env.TELEMETRY_BROWSER_SAMPLING_RATIO = 'garbage'
      expect(resolveBrowserTelemetryConfig()?.samplingRatio).toBe(1)
    })
  })

  describe('trace-continuity warning', () => {
    function enableRum(): void {
      process.env.TELEMETRY_BROWSER_ENABLED = 'true'
      process.env.TELEMETRY_BACKEND = 'signoz'
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318'
    }

    function captureWarnings(): { records: LoggerExtensionRecord[]; dispose: () => void } {
      const records: LoggerExtensionRecord[] = []
      const dispose = registerLoggerExtension({ emit: (record) => records.push(record) })
      return { records, dispose }
    }

    afterEach(() => {
      resetLoggerExtension()
    })

    it('warns once when RUM is enabled without TELEMETRY_TRUST_INBOUND_TRACE — the spans would not stitch', () => {
      enableRum()
      const { records } = captureWarnings()

      resolveBrowserTelemetryConfig()
      resolveBrowserTelemetryConfig()

      const warnings = records.filter((record) => record.message === 'telemetry.browser.trace_continuity_disabled')
      // Once per process, not once per request: the layout resolves this on every page render.
      expect(warnings).toHaveLength(1)
      expect(warnings[0].level).toBe('warn')
    })

    it('stays quiet once the deployment opts into continuing the inbound trace', () => {
      enableRum()
      process.env.TELEMETRY_TRUST_INBOUND_TRACE = 'true'
      resetTelemetryEnvCache()
      const { records } = captureWarnings()

      expect(resolveBrowserTelemetryConfig()).not.toBeNull()
      expect(records.filter((record) => record.message === 'telemetry.browser.trace_continuity_disabled')).toHaveLength(0)
    })

    it('stays quiet while RUM is off — a disabled feature has nothing to misconfigure', () => {
      const { records } = captureWarnings()

      expect(resolveBrowserTelemetryConfig()).toBeNull()
      expect(records).toHaveLength(0)
    })
  })

  describe('resolveCollectorTracesUrl', () => {
    it('appends /v1/traces to the generic endpoint, tolerating a trailing slash', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://collector.example.com'
      expect(resolveCollectorTracesUrl()).toBe('https://collector.example.com/v1/traces')

      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://collector.example.com/'
      expect(resolveCollectorTracesUrl()).toBe('https://collector.example.com/v1/traces')
    })

    it('uses a signal-specific endpoint verbatim, as the OTLP spec requires', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://collector.example.com'
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'https://collector.example.com/custom/traces'

      expect(resolveCollectorTracesUrl()).toBe('https://collector.example.com/custom/traces')
    })

    it('returns null when nothing is configured', () => {
      expect(resolveCollectorTracesUrl()).toBeNull()
    })
  })

  describe('integration-test cookie opt-in', () => {
    const ON = `${BROWSER_TELEMETRY_TEST_COOKIE}=on`

    function armTestMode(): void {
      process.env.OM_TEST_MODE = '1'
      process.env.OM_TEST_BROWSER_TELEMETRY_MODE = 'opt-in'
    }

    it('boots RUM for a request carrying the cookie, with no telemetry env set at all', () => {
      armTestMode()

      // The point of the escape hatch: a Playwright spec can cover the enabled path for its own
      // page without turning the web SDK on for every other spec in the environment.
      expect(resolveBrowserTelemetryConfig({ cookieHeader: `foo=1; ${ON}; bar=2` })).toEqual({
        endpoint: BROWSER_TRACES_PATH,
        serviceName: 'open-mercato-browser',
        environment: null,
        samplingRatio: 1,
      })
    })

    it('ignores the cookie in production, where neither test-mode variable is set', () => {
      expect(resolveBrowserTelemetryConfig({ cookieHeader: ON })).toBeNull()
    })

    it('ignores the cookie when OM_TEST_MODE is set but the feature was not explicitly opted in', () => {
      process.env.OM_TEST_MODE = '1'

      // Two gates, not one: OM_TEST_MODE is on across the whole integration environment.
      expect(resolveBrowserTelemetryConfig({ cookieHeader: ON })).toBeNull()
    })

    it('ignores a request without the cookie even with both gates armed', () => {
      armTestMode()

      expect(resolveBrowserTelemetryConfig({ cookieHeader: 'session=abc' })).toBeNull()
      expect(resolveBrowserTelemetryConfig()).toBeNull()
    })

    it('does not match a cookie whose name merely ends with the opt-in name', () => {
      armTestMode()

      expect(resolveBrowserTelemetryConfig({ cookieHeader: `not_${BROWSER_TELEMETRY_TEST_COOKIE}=on` })).toBeNull()
    })
  })

  describe('resolveCollectorHeaders', () => {
    it('splits on the FIRST = so base64 padding in a BasicAuth credential survives', () => {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic b3RlbDpzZWNyZXQ='

      expect(resolveCollectorHeaders()).toEqual({ Authorization: 'Basic b3RlbDpzZWNyZXQ=' })
    })

    it('parses multiple comma-separated pairs and ignores malformed ones', () => {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'api-key=abc123, x-tenant = t1 ,broken,=novalue'

      expect(resolveCollectorHeaders()).toEqual({ 'api-key': 'abc123', 'x-tenant': 't1' })
    })

    it('returns an empty record when unset — an in-cluster collector may need no credential', () => {
      expect(resolveCollectorHeaders()).toEqual({})
    })
  })
})
