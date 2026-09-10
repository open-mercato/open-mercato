import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DevRuntimeConfigError,
  DEFAULT_PROBE_FAILURE_THRESHOLD,
  DEFAULT_PROBE_INTERVAL_MS,
  DEFAULT_PROBE_RECOVERY_THRESHOLD,
  DEFAULT_PROBE_TIMEOUT_MS,
  resolveDevRuntimeConfig,
  resolveDevRuntimeMode,
  resolveDiagnosticsConfig,
  resolveProbeConfig,
  resolveUpstreamPort,
} from '../dev-runtime-config.mjs'
import { createRuntimeProbe } from '../dev-runtime-probe.mjs'

test('defaults the runtime mode to direct', () => {
  assert.equal(resolveDevRuntimeMode({}), 'direct')
  assert.equal(resolveDevRuntimeMode({ OM_DEV_RUNTIME_MODE: ' PROXY ' }), 'proxy')
})

test('rejects an unknown runtime mode with a readable error', () => {
  assert.throws(
    () => resolveDevRuntimeMode({ OM_DEV_RUNTIME_MODE: 'gateway' }),
    (error) => error instanceof DevRuntimeConfigError && /must be "direct" or "proxy"/.test(error.message),
  )
})

test('auto-selects the upstream port unless one is configured', () => {
  assert.equal(resolveUpstreamPort({}), null)
  assert.equal(resolveUpstreamPort({ OM_DEV_UPSTREAM_PORT: '3111' }), 3111)
})

test('rejects an out-of-range or colliding upstream port', () => {
  assert.throws(() => resolveUpstreamPort({ OM_DEV_UPSTREAM_PORT: '0' }), DevRuntimeConfigError)
  assert.throws(() => resolveUpstreamPort({ OM_DEV_UPSTREAM_PORT: '70000' }), DevRuntimeConfigError)
  assert.throws(() => resolveUpstreamPort({ OM_DEV_UPSTREAM_PORT: 'abc' }), DevRuntimeConfigError)
  assert.throws(
    () => resolveUpstreamPort({ OM_DEV_UPSTREAM_PORT: '3000' }, 3000),
    (error) => /must not equal the public application port/.test(error.message),
  )
})

test('applies the documented probe defaults', () => {
  assert.deepEqual(resolveProbeConfig({}), {
    intervalMs: DEFAULT_PROBE_INTERVAL_MS,
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    failureThreshold: DEFAULT_PROBE_FAILURE_THRESHOLD,
    recoveryThreshold: DEFAULT_PROBE_RECOVERY_THRESHOLD,
  })
})

test('requires the probe timeout to stay below the interval', () => {
  assert.throws(
    () => resolveProbeConfig({ OM_DEV_RUNTIME_PROBE_INTERVAL_MS: '1000', OM_DEV_RUNTIME_PROBE_TIMEOUT_MS: '1000' }),
    (error) => /must be less than/.test(error.message),
  )
})

test('rejects non-positive probe thresholds', () => {
  assert.throws(() => resolveProbeConfig({ OM_DEV_RUNTIME_PROBE_FAILURE_THRESHOLD: '0' }), DevRuntimeConfigError)
  assert.throws(() => resolveProbeConfig({ OM_DEV_RUNTIME_PROBE_RECOVERY_THRESHOLD: '-2' }), DevRuntimeConfigError)
})

test('follows the splash for diagnostics defaults and disables them in CI', () => {
  assert.deepEqual(resolveDiagnosticsConfig({}, { splashEnabled: true }), { diagnosticsEnabled: true, bannerEnabled: true })
  assert.deepEqual(resolveDiagnosticsConfig({}, { splashEnabled: false }), { diagnosticsEnabled: false, bannerEnabled: false })
  assert.deepEqual(resolveDiagnosticsConfig({ CI: 'true' }, { splashEnabled: true }), { diagnosticsEnabled: false, bannerEnabled: false })
})

test('allows the banner to be disabled independently from collection', () => {
  assert.deepEqual(
    resolveDiagnosticsConfig({ OM_DEV_RUNTIME_BANNER: 'off' }, { splashEnabled: true }),
    { diagnosticsEnabled: true, bannerEnabled: false },
  )
})

test('never enables the banner while diagnostics are off', () => {
  assert.deepEqual(
    resolveDiagnosticsConfig({ OM_DEV_RUNTIME_DIAGNOSTICS: 'off', OM_DEV_RUNTIME_BANNER: 'on' }, { splashEnabled: true }),
    { diagnosticsEnabled: false, bannerEnabled: false },
  )
})

test('rejects a non-boolean diagnostics flag', () => {
  assert.throws(() => resolveDiagnosticsConfig({ OM_DEV_RUNTIME_DIAGNOSTICS: 'maybe' }), DevRuntimeConfigError)
})

test('resolves the combined dev runtime configuration', () => {
  const config = resolveDevRuntimeConfig({ OM_DEV_RUNTIME_MODE: 'proxy', OM_DEV_UPSTREAM_PORT: '3111' }, { publicPort: 3000 })
  assert.equal(config.mode, 'proxy')
  assert.equal(config.upstreamPort, 3111)
  assert.equal(config.probe.intervalMs, DEFAULT_PROBE_INTERVAL_MS)
  assert.equal(config.diagnosticsEnabled, true)
})

test('probe reports degraded only after the failure threshold', async () => {
  const transitions = []
  const probe = createRuntimeProbe({
    config: { failureThreshold: 2, recoveryThreshold: 2 },
    resolveBaseUrl: () => 'http://127.0.0.1:3000/',
    request: async () => ({ healthy: false, status: 503 }),
    onDegraded: () => transitions.push('degraded'),
    onRecovered: () => transitions.push('recovered'),
  })

  await probe.tick()
  assert.deepEqual(transitions, [])
  await probe.tick()
  assert.deepEqual(transitions, ['degraded'])
  await probe.tick()
  assert.deepEqual(transitions, ['degraded'])
})

test('probe recovers after consecutive successes', async () => {
  const transitions = []
  let healthy = false
  const probe = createRuntimeProbe({
    config: { failureThreshold: 1, recoveryThreshold: 2 },
    resolveBaseUrl: () => 'http://127.0.0.1:3000',
    request: async () => ({ healthy }),
    onDegraded: () => transitions.push('degraded'),
    onRecovered: () => transitions.push('recovered'),
  })

  await probe.tick()
  healthy = true
  await probe.tick()
  await probe.tick()
  assert.deepEqual(transitions, ['degraded', 'recovered'])
})

test('probe requests the shared health path once per tick', async () => {
  const urls = []
  const probe = createRuntimeProbe({
    config: { failureThreshold: 5 },
    resolveBaseUrl: () => 'http://127.0.0.1:3000/',
    request: async (url) => {
      urls.push(url)
      return { healthy: true }
    },
  })

  await probe.tick()
  assert.deepEqual(urls, ['http://127.0.0.1:3000/api/healthz'])
})

test('probe stays idle and resets counters while it should not run', async () => {
  let allowed = false
  let calls = 0
  const probe = createRuntimeProbe({
    config: { failureThreshold: 2 },
    shouldRun: () => allowed,
    resolveBaseUrl: () => 'http://127.0.0.1:3000',
    request: async () => {
      calls += 1
      return { healthy: false }
    },
  })

  await probe.tick()
  assert.equal(calls, 0)
  allowed = true
  await probe.tick()
  assert.equal(calls, 1)
  assert.deepEqual(probe.getCounters(), { consecutiveFailures: 1, consecutiveSuccesses: 0 })

  allowed = false
  await probe.tick()
  assert.deepEqual(probe.getCounters(), { consecutiveFailures: 0, consecutiveSuccesses: 0 })
})

test('probe skips a tick when no upstream base url is known', async () => {
  let calls = 0
  const probe = createRuntimeProbe({
    resolveBaseUrl: () => null,
    request: async () => {
      calls += 1
      return { healthy: true }
    },
  })
  await probe.tick()
  assert.equal(calls, 0)
})
