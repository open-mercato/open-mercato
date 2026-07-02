/**
 * Regression for the CLI `.env` load-order bug: the CLI binary statically
 * imports this package (evaluating the logger) BEFORE dotenv loads the app's
 * `.env`. The old module-scope `readTelemetryEnv()` in the logger stamped the
 * env cache at import time, so `TELEMETRY_BACKEND` set only in `.env` silently
 * resolved to `noop` for worker/scheduler processes.
 *
 * These tests reproduce the exact sequence — import the facade, THEN set env
 * (simulating the dotenv load), then init — and assert the late env wins.
 */

describe('telemetry env load order (import before .env)', () => {
  const ENV_KEYS = ['TELEMETRY_BACKEND', 'TELEMETRY_LOG_LEVEL', 'TELEMETRY_LOG_PRETTY'] as const
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('initTelemetry resolves a backend set AFTER the facade was imported', async () => {
    await jest.isolateModulesAsync(async () => {
      // 1. Static import of the facade (what bin.ts does at the top of the file).
      //    This must NOT freeze the env snapshot.
      const { logger } = await import('../facade/logger')
      expect(logger).toBeDefined()

      // 2. The app's .env is loaded (dotenv) — only now is the backend known.
      process.env.TELEMETRY_BACKEND = 'console'

      // 3. bin.ts calls initTelemetry().
      const { initTelemetry } = await import('../init')
      await initTelemetry()

      const { getActiveProvider } = await import('../provider/registry')
      expect(getActiveProvider().name).toBe('console')
    })
  })

  it('log-level gating honors TELEMETRY_LOG_LEVEL set after import', async () => {
    await jest.isolateModulesAsync(async () => {
      const { writeRecord } = await import('../facade/logger')
      const { registerProvider } = await import('../provider/registry')
      const { initTelemetry } = await import('../init')
      const { runSpan } = await import('../provider/run-span')
      type LogRecordType = import('../types').LogRecord
      type ProviderType = import('../types').TelemetryProvider

      // .env arrives after import: warn-level export only.
      process.env.TELEMETRY_BACKEND = 'noop'
      process.env.TELEMETRY_LOG_LEVEL = 'warn'
      process.env.TELEMETRY_LOG_PRETTY = 'true'

      const exported: LogRecordType[] = []
      const provider: ProviderType = {
        name: 'noop',
        supports: ['logs'],
        async start() {},
        async shutdown() {},
        runInSpan: (_n, _o, fn) => runSpan({ setAttribute() {}, recordException() {}, setStatus() {}, end() {} }, fn),
        activeSpan: () => undefined,
        activeTraceContext: () => undefined,
        inject: () => {},
        runInRemoteSpan: (_c, _n, _o, fn) => runSpan({ setAttribute() {}, recordException() {}, setStatus() {}, end() {} }, fn),
        emitLog: (record) => exported.push(record),
        recordMetric: () => {},
      }
      registerProvider(provider)
      await initTelemetry()

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      writeRecord({ level: 'info', message: 'below level' })
      writeRecord({ level: 'warn', message: 'at level' })
      consoleSpy.mockRestore()

      expect(exported.map((record) => record.message)).toEqual(['at level'])
    })
  })
})
