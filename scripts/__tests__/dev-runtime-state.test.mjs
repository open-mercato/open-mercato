import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyRuntimeMessage,
  createProbePolicy,
  createRuntimeStateStore,
  fingerprintRuntimeIssue,
  projectLegacyReadyFailed,
  redactSensitiveText,
  RUNTIME_STATUS_SCHEMA_VERSION,
} from '../dev-runtime-state.mjs'

function createClock(startMs = Date.UTC(2026, 7, 18, 10, 0, 0)) {
  let current = startMs
  return {
    now: () => new Date(current),
    advance(ms) {
      current += ms
    },
  }
}

function createStore(overrides = {}) {
  const clock = createClock()
  const store = createRuntimeStateStore({ now: clock.now, ...overrides })
  store.beginGeneration('test')
  return { store, clock }
}

test('redacts database connection strings', () => {
  const redacted = redactSensitiveText('connect postgres://admin:hunter2@db.local:5432/app failed')
  assert.ok(redacted.includes('postgres://***'))
  assert.ok(!redacted.includes('hunter2'))
})

test('redacts authorization headers, cookies and bearer tokens', () => {
  assert.equal(redactSensitiveText('authorization: Basic YWJjOmRlZg=='), 'authorization: ***')
  assert.equal(redactSensitiveText('cookie: om_session=abc123'), 'cookie: ***')
  assert.equal(redactSensitiveText('sent Bearer abcdef1234567890'), 'sent Bearer ***')
})

test('redacts JWTs, provider keys and keyed secrets', () => {
  assert.equal(redactSensitiveText('token eyJhbGciOi.eyJzdWIiOj.signature'), 'token ***')
  assert.equal(redactSensitiveText('key sk_live_abcdefgh1234'), 'key ***')
  const password = redactSensitiveText('password="hunter2" rejected')
  assert.ok(password.includes('***'))
  assert.ok(!password.includes('hunter2'))
})

test('drops control characters and bounds the redacted length', () => {
  assert.equal(redactSensitiveText('a\u0000b'), 'ab')
  assert.equal(redactSensitiveText('x'.repeat(500), 40).length, 40)
})

test('returns undefined for empty redaction input', () => {
  assert.equal(redactSensitiveText(null), undefined)
  assert.equal(redactSensitiveText('   '), undefined)
})

test('maps a missing relation to the migrate recovery action', () => {
  const classified = classifyRuntimeMessage('error: relation "sandboxs" does not exist', 'log')
  assert.equal(classified.code, 'db_relation_missing')
  assert.equal(classified.title, 'Database schema mismatch')
  assert.equal(classified.detail, 'Relation `sandboxs` is missing')
  assert.equal(classified.recovery, 'migrate')
})

test('prefers the column classifier over the relation classifier', () => {
  const classified = classifyRuntimeMessage('column "email" of relation "users" does not exist')
  assert.equal(classified.code, 'db_column_missing')
  assert.equal(classified.detail, 'Column `email` is missing on relation `users`')
})

test('maps a missing generated registry to the generate action', () => {
  const classified = classifyRuntimeMessage("Cannot find module '@/generated/modules.generated'")
  assert.equal(classified.code, 'generated_registry_missing')
  assert.equal(classified.recovery, 'generate')
})

test('maps chunk load failures and bundler crashes to restart', () => {
  assert.equal(classifyRuntimeMessage('ChunkLoadError: Loading chunk 42 failed', 'browser').recovery, 'restart')
  assert.equal(classifyRuntimeMessage('TurbopackInternalError: boom').recovery, 'restart')
})

test('never attaches a recovery action it cannot justify', () => {
  assert.equal(classifyRuntimeMessage('EADDRINUSE: address already in use').recovery, undefined)
  assert.equal(classifyRuntimeMessage('something odd happened').recovery, undefined)
})

test('falls back to a per-source classification code', () => {
  assert.equal(classifyRuntimeMessage('boom', 'browser').code, 'browser_error')
  assert.equal(classifyRuntimeMessage('boom', 'warmup').code, 'warmup_failed')
  assert.equal(classifyRuntimeMessage('boom', 'probe').code, 'probe_failed')
})

test('fingerprint is stable across volatile stack positions', () => {
  const first = fingerprintRuntimeIssue({ source: 'log', code: 'runtime_error', message: 'boom at app.js:12:44' })
  const second = fingerprintRuntimeIssue({ source: 'log', code: 'runtime_error', message: 'boom at app.js:98:11' })
  assert.equal(first, second)
})

test('fingerprint separates different relations', () => {
  const first = fingerprintRuntimeIssue({ source: 'log', code: 'db_relation_missing', message: 'relation "a" does not exist' })
  const second = fingerprintRuntimeIssue({ source: 'log', code: 'db_relation_missing', message: 'relation "b" does not exist' })
  assert.notEqual(first, second)
})

test('fingerprint prefers the digest over raw message text', () => {
  const first = fingerprintRuntimeIssue({ source: 'browser', code: 'browser_error', digest: 'abc', message: 'one' })
  const second = fingerprintRuntimeIssue({ source: 'browser', code: 'browser_error', digest: 'abc', message: 'two' })
  assert.equal(first, second)
})

test('projects every health value onto the legacy ready/failed pair', () => {
  assert.deepEqual(projectLegacyReadyFailed('starting'), { ready: false, failed: false })
  assert.deepEqual(projectLegacyReadyFailed('ready'), { ready: true, failed: false })
  assert.deepEqual(projectLegacyReadyFailed('degraded'), { ready: true, failed: false })
  assert.deepEqual(projectLegacyReadyFailed('recovering'), { ready: false, failed: false })
  assert.deepEqual(projectLegacyReadyFailed('unavailable'), { ready: false, failed: true })
})

test('starts in the starting state with a bounded payload shape', () => {
  const { store } = createStore()
  const status = store.getStatus()
  assert.equal(status.schemaVersion, RUNTIME_STATUS_SCHEMA_VERSION)
  assert.equal(status.health, 'starting')
  assert.equal(status.ready, false)
  assert.equal(status.failed, false)
  assert.deepEqual(status.incidents, [])
  assert.equal(status.issueSummary, undefined)
  assert.deepEqual(status.legacy, { failureLines: [], failureCommand: undefined, failureStage: undefined })
})

test('marks a hard startup failure unavailable and projects the legacy fields', () => {
  const { store } = createStore()
  const status = store.recordSignal({
    source: 'process',
    message: 'app runtime exited with code 1',
    failureLines: ['boom'],
    failureCommand: 'yarn dev',
    failureStage: 'App runtime',
  })
  assert.equal(status.health, 'unavailable')
  assert.equal(status.ready, false)
  assert.equal(status.failed, true)
  assert.deepEqual(status.legacy.failureLines, ['boom'])
  assert.equal(status.legacy.failureCommand, 'yarn dev')
  assert.equal(status.legacy.failureStage, 'App runtime')
})

test('keeps a post-ready runtime error visible as degraded instead of ready', () => {
  const { store } = createStore()
  store.markReady()
  assert.equal(store.getStatus().health, 'ready')

  const status = store.recordSignal({ source: 'log', message: 'error: relation "sandboxs" does not exist' })
  assert.equal(status.health, 'degraded')
  assert.equal(status.ready, true)
  assert.equal(status.failed, false)
  assert.equal(status.issueSummary.code, 'db_relation_missing')
  assert.equal(status.issueSummary.title, 'Database schema mismatch')
  assert.equal(status.issueSummary.detail, 'Relation `sandboxs` is missing')
  assert.equal(status.issueSummary.recovery, 'migrate')
  assert.equal(status.issueSummary.source, 'log')
  assert.equal(status.issueSummary.occurrences, 1)
})

test('never marks the runtime unavailable from a browser report alone', () => {
  const { store } = createStore()
  store.markReady()
  const status = store.recordSignal({ source: 'browser', message: 'TypeError: x is not a function' })
  assert.equal(status.health, 'degraded')
  assert.equal(status.failed, false)
})

test('keeps a browser report during startup in the starting state', () => {
  const { store } = createStore()
  const status = store.recordSignal({ source: 'browser', message: 'TypeError: x is not a function' })
  assert.equal(status.health, 'starting')
  assert.equal(status.incidents.length, 1)
})

test('deduplicates repeated signals into occurrences', () => {
  const { store, clock } = createStore()
  store.markReady()
  store.recordSignal({ source: 'log', message: 'relation "sandboxs" does not exist' })
  clock.advance(1000)
  const status = store.recordSignal({ source: 'log', message: 'relation "sandboxs" does not exist' })
  assert.equal(status.incidents.length, 1)
  assert.equal(status.incidents[0].occurrences, 2)
  assert.notEqual(status.incidents[0].lastSeenAt, status.incidents[0].firstSeenAt)
})

test('ignores signals from a stale generation', () => {
  const { store } = createStore()
  store.markReady()
  const staleGeneration = store.getGeneration() - 1
  const status = store.recordSignal({ source: 'log', generation: staleGeneration, message: 'relation "old" does not exist' })
  assert.equal(status.health, 'ready')
  assert.deepEqual(status.incidents, [])
})

test('drops incidents from a previous generation when the runtime restarts', () => {
  const { store } = createStore()
  store.recordSignal({ source: 'process', message: 'runtime exited with code 1' })
  assert.equal(store.getStatus().health, 'unavailable')

  store.beginGeneration('restart')
  const status = store.getStatus()
  assert.equal(status.health, 'starting')
  assert.deepEqual(status.incidents, [])
  assert.deepEqual(status.legacy.failureLines, [])
})

test('redacts secrets before storing an incident', () => {
  const { store } = createStore()
  store.markReady()
  const status = store.recordSignal({
    source: 'log',
    message: 'connection failed for postgres://admin:hunter2@localhost:5432/app',
  })
  assert.ok(!JSON.stringify(status).includes('hunter2'))
  assert.ok(status.issueSummary.detail.includes('postgres://***'))
})

test('bounds the number of retained incidents', () => {
  const { store, clock } = createStore({ maxIncidents: 3 })
  store.markReady()
  for (let index = 0; index < 6; index += 1) {
    clock.advance(10)
    store.recordSignal({ source: 'log', message: `relation "table_${index}" does not exist` })
  }
  assert.equal(store.getStatus().incidents.length, 3)
})

test('clears blocking startup incidents once warmup opens the ready gate', () => {
  const { store } = createStore()
  store.recordSignal({ source: 'log', message: 'Error: compile failed' })
  assert.equal(store.getStatus().health, 'unavailable')
  const status = store.markReady()
  assert.equal(status.health, 'ready')
  assert.deepEqual(status.incidents, [])
})

test('reports recovering while an action is busy and cannot set ready directly', () => {
  const { store } = createStore()
  store.recordSignal({ source: 'process', message: 'runtime exited with code 1' })
  const started = store.beginRecovery('migrate')
  assert.equal(started.health, 'recovering')
  assert.equal(started.ready, false)
  assert.equal(started.failed, false)
  assert.equal(started.recovery.action, 'migrate')
  assert.equal(started.recovery.busy, true)

  const completed = store.completeRecovery(0)
  assert.equal(completed.recovery.busy, false)
  assert.equal(completed.recovery.lastExitCode, 0)
  assert.equal(completed.health, 'unavailable')
})

test('ignores a recovery completion from a stale generation', () => {
  const { store } = createStore()
  store.beginRecovery('restart')
  const staleGeneration = store.getGeneration()
  store.beginGeneration('restart')
  store.beginRecovery('restart')
  const status = store.completeRecovery(1, { generation: staleGeneration })
  assert.equal(status.recovery.busy, true)
})

test('rejects a recovery action outside the allowlist', () => {
  const { store } = createStore()
  assert.equal(store.beginRecovery('rm -rf /'), null)
  assert.equal(store.getStatus().health, 'starting')
})

test('serves bounded diagnostic lines through an opaque cursor', () => {
  const { store } = createStore({ maxDiagnosticLines: 4 })
  store.markReady()
  for (let index = 0; index < 6; index += 1) {
    store.appendDiagnosticLine(`line ${index}`)
  }
  const first = store.getDiagnosticLines(0)
  assert.equal(first.lines.length, 4)
  assert.equal(first.lines[0].text, 'line 2')

  const second = store.getDiagnosticLines(first.nextCursor)
  assert.deepEqual(second.lines, [])
  assert.equal(second.nextCursor, first.nextCursor)
})

test('redacts diagnostic lines', () => {
  const { store } = createStore()
  store.appendDiagnosticLine('cookie: om_session=secret-value')
  const { lines } = store.getDiagnosticLines(0)
  assert.equal(lines.at(-1).text, 'cookie: ***')
})

test('exposes the upstream descriptor', () => {
  const { store } = createStore()
  const status = store.setUpstream({ configuredPort: 3000, actualPort: 3111, publicUrl: 'http://localhost:3000' })
  assert.deepEqual(status.upstream, { configuredPort: 3000, actualPort: 3111, publicUrl: 'http://localhost:3000' })
})

test('probe policy enters degraded only after the failure threshold', () => {
  const policy = createProbePolicy({ failureThreshold: 3, recoveryThreshold: 2 })
  assert.equal(policy.record(false), null)
  assert.equal(policy.record(false), null)
  assert.equal(policy.record(false), 'degraded')
})

test('probe policy recovers only after consecutive successes', () => {
  const policy = createProbePolicy({ failureThreshold: 2, recoveryThreshold: 2 })
  policy.record(false)
  policy.record(false)
  assert.equal(policy.record(true), null)
  assert.equal(policy.record(true), 'recovered')
})

test('probe policy resets counters on demand', () => {
  const policy = createProbePolicy({ failureThreshold: 2 })
  policy.record(false)
  policy.reset()
  assert.deepEqual(policy.getCounters(), { consecutiveFailures: 0, consecutiveSuccesses: 0 })
  assert.equal(policy.record(false), null)
})

test('probe policy does not repeat the threshold transition on every tick', () => {
  const policy = createProbePolicy({ failureThreshold: 1 })
  assert.equal(policy.record(false), 'degraded')
  assert.equal(policy.record(false), null)
})
