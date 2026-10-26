import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createDiagnosticsSink } from '../dev-runtime-diagnostics.mjs'
import { createDevRuntimeSupervisor } from '../dev-runtime-supervisor.mjs'

function withSupervisor(options, run) {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-dev-supervisor-'))
  const supervisor = createDevRuntimeSupervisor({
    stateDirectory,
    publicUrl: 'http://localhost:3000',
    configuredPort: 3000,
    config: {},
    ...options,
  })
  try {
    return run(supervisor, stateDirectory)
  } finally {
    supervisor.stop()
    fs.rmSync(stateDirectory, { recursive: true, force: true })
  }
}

function readStatusFile(supervisor) {
  return JSON.parse(fs.readFileSync(supervisor.statusFilePath, 'utf8'))
}

test('publishes an atomically written status file with the per-run token', () => {
  withSupervisor({}, (supervisor) => {
    supervisor.beginGeneration('boot')
    const published = readStatusFile(supervisor)
    assert.equal(published.token, supervisor.token)
    assert.equal(published.pid, process.pid)
    assert.equal(published.status.health, 'starting')
    assert.equal(published.status.generation, 1)
    assert.equal(fs.readdirSync(path.dirname(supervisor.statusFilePath)).some((name) => name.endsWith('.tmp')), false)
  })
})

test('hands the app process the token, status file and sink path', () => {
  withSupervisor({}, (supervisor) => {
    const env = supervisor.childEnv()
    assert.equal(env.OM_DEV_RUNTIME_TOKEN, supervisor.token)
    assert.equal(env.OM_DEV_RUNTIME_STATUS_FILE, supervisor.statusFilePath)
    assert.equal(env.OM_DEV_RUNTIME_DIAGNOSTICS_FILE, supervisor.diagnosticsFilePath)
    assert.equal(env.OM_DEV_RUNTIME_DIAGNOSTICS, '1')
    assert.equal(env.OM_DEV_RUNTIME_BANNER, '1')
  })
})

test('exposes no child env and writes no status file while disabled', () => {
  withSupervisor({ enabled: false }, (supervisor) => {
    supervisor.beginGeneration('boot')
    supervisor.recordSignal({ source: 'log', message: 'Error: boom' })
    assert.deepEqual(supervisor.childEnv(), {})
    assert.equal(fs.existsSync(supervisor.statusFilePath), false)
  })
})

test('propagates the banner opt-out to the app process', () => {
  withSupervisor({ config: { bannerEnabled: false } }, (supervisor) => {
    assert.equal(supervisor.childEnv().OM_DEV_RUNTIME_BANNER, '0')
    assert.equal(supervisor.childEnv().OM_DEV_RUNTIME_DIAGNOSTICS, '1')
  })
})

test('ingests child runtime signals exactly once', () => {
  withSupervisor({}, (supervisor) => {
    supervisor.beginGeneration('boot')
    const childState = {
      ready: false,
      runtimeSignals: [
        { seq: 1, source: 'log', message: 'error: relation "sandboxs" does not exist' },
      ],
    }

    supervisor.ingestChildState(childState)
    supervisor.ingestChildState(childState)

    const status = supervisor.getStatus()
    assert.equal(status.incidents.length, 1)
    assert.equal(status.incidents[0].occurrences, 1)
    assert.equal(status.incidents[0].code, 'db_relation_missing')
    assert.equal(status.health, 'unavailable')
  })
})

test('opens the ready gate from the child ready flag', () => {
  withSupervisor({}, (supervisor) => {
    supervisor.beginGeneration('boot')
    supervisor.ingestChildState({ ready: true })
    assert.equal(supervisor.getStatus().health, 'ready')
  })
})

test('keeps a post-ready child signal visible as degraded', () => {
  withSupervisor({}, (supervisor) => {
    supervisor.beginGeneration('boot')
    supervisor.ingestChildState({ ready: true })
    supervisor.ingestChildState({
      ready: true,
      runtimeSignals: [{ seq: 1, source: 'log', message: 'error: relation "sandboxs" does not exist' }],
    })

    const status = supervisor.getStatus()
    assert.equal(status.health, 'degraded')
    assert.equal(status.ready, true)
    assert.equal(status.failed, false)
    assert.equal(status.issueSummary.recovery, 'migrate')
  })
})

test('resets the ingestion cursor and clears the sink on a new generation', () => {
  withSupervisor({}, (supervisor) => {
    supervisor.beginGeneration('boot')
    supervisor.ingestChildState({ runtimeSignals: [{ seq: 1, source: 'log', message: 'Error: first' }] })
    assert.equal(supervisor.getStatus().incidents.length, 1)

    supervisor.beginGeneration('restart')
    assert.equal(supervisor.getStatus().generation, 2)
    assert.deepEqual(supervisor.getStatus().incidents, [])

    supervisor.ingestChildState({ runtimeSignals: [{ seq: 1, source: 'log', message: 'Error: second' }] })
    assert.equal(supervisor.getStatus().incidents.length, 1)
  })
})

test('ignores a malformed child state payload', () => {
  withSupervisor({}, (supervisor) => {
    supervisor.beginGeneration('boot')
    supervisor.ingestChildState(null)
    supervisor.ingestChildState({ runtimeSignals: 'nope' })
    supervisor.ingestChildState({ runtimeSignals: [null, { source: 'log' }] })
    assert.deepEqual(supervisor.getStatus().incidents, [])
  })
})

test('turns a drained browser report into a non-blocking incident', () => {
  withSupervisor({}, (supervisor) => {
    supervisor.beginGeneration('boot')
    supervisor.ingestChildState({ ready: true })

    const writer = createDiagnosticsSink({ filePath: supervisor.diagnosticsFilePath })
    writer.append({ kind: 'global-error', message: 'TypeError: boom', path: '/backend/example' })

    const status = supervisor.sync()
    assert.equal(status.health, 'degraded')
    assert.equal(status.issueSummary.source, 'browser')
    assert.equal(status.issueSummary.path, '/backend/example')
  })
})

test('drops a browser report left over from the previous run', () => {
  withSupervisor({}, (supervisor) => {
    const writer = createDiagnosticsSink({ filePath: supervisor.diagnosticsFilePath })
    writer.append({ kind: 'global-error', message: 'TypeError: stale' })

    supervisor.start()
    supervisor.ingestChildState({ ready: true })
    assert.equal(supervisor.sync().health, 'ready')
  })
})

test('removes the status file on shutdown', () => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-dev-supervisor-'))
  const supervisor = createDevRuntimeSupervisor({ stateDirectory, config: {} })
  supervisor.beginGeneration('boot')
  assert.equal(fs.existsSync(supervisor.statusFilePath), true)
  supervisor.stop()
  assert.equal(fs.existsSync(supervisor.statusFilePath), false)
  fs.rmSync(stateDirectory, { recursive: true, force: true })
})

test('serves bounded diagnostic lines for the logs view', () => {
  withSupervisor({}, (supervisor) => {
    supervisor.beginGeneration('boot')
    supervisor.recordSignal({ source: 'log', message: 'error: relation "sandboxs" does not exist' })
    const snapshot = supervisor.getDiagnosticLines(0)
    assert.equal(snapshot.generation, 1)
    assert.ok(snapshot.lines.some((line) => line.text.includes('sandboxs')))
    assert.ok(snapshot.nextCursor > 0)
  })
})

test('runs an action queued by the dev-only app route', () => {
  const invoked = []
  withSupervisor({ runAction: (action) => invoked.push(action) }, (supervisor) => {
    supervisor.beginGeneration('boot')
    const writer = createDiagnosticsSink({ filePath: supervisor.actionsFilePath })
    writer.append({ action: 'restart', generation: supervisor.getGeneration(), requestedAt: '2026-08-18T10:00:00.000Z' })

    supervisor.sync()
    assert.deepEqual(invoked, ['restart'])

    // Draining is exactly-once.
    supervisor.sync()
    assert.deepEqual(invoked, ['restart'])
  })
})

test('drops an action request raised against a stale generation', () => {
  const invoked = []
  withSupervisor({ runAction: (action) => invoked.push(action) }, (supervisor) => {
    supervisor.beginGeneration('boot')
    const writer = createDiagnosticsSink({ filePath: supervisor.actionsFilePath })
    writer.append({ action: 'migrate', generation: 99, requestedAt: '2026-08-18T10:00:00.000Z' })

    supervisor.sync()
    assert.deepEqual(invoked, [])
  })
})

test('never runs an action outside the allowlist even if the sink is tampered with', () => {
  const invoked = []
  withSupervisor({ runAction: (action) => invoked.push(action) }, (supervisor) => {
    supervisor.beginGeneration('boot')
    fs.writeFileSync(
      supervisor.actionsFilePath,
      `${JSON.stringify({ action: 'rm -rf /' })}\n${JSON.stringify({ action: 'restart' })}\n`,
      'utf8',
    )

    supervisor.sync()
    assert.deepEqual(invoked, ['restart'])
  })
})

test('hands the app process the action channel path', () => {
  withSupervisor({}, (supervisor) => {
    assert.equal(supervisor.childEnv().OM_DEV_RUNTIME_ACTIONS_FILE, supervisor.actionsFilePath)
  })
})

test('publishes the bounded log tail to its own file', () => {
  withSupervisor({}, (supervisor) => {
    supervisor.beginGeneration('boot')
    supervisor.recordSignal({ source: 'log', message: 'error: relation "sandboxs" does not exist' })

    const published = JSON.parse(fs.readFileSync(supervisor.logsFilePath, 'utf8'))
    assert.equal(published.token, supervisor.token)
    assert.equal(published.generation, 1)
    assert.ok(published.lines.some((line) => line.text.includes('sandboxs')))
    // The status poll must stay small: lines live in the separate logs file.
    assert.equal(JSON.parse(fs.readFileSync(supervisor.statusFilePath, 'utf8')).status.lines, undefined)
  })
})

test('hands the app process the logs channel path and clears it on shutdown', () => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-dev-supervisor-'))
  const supervisor = createDevRuntimeSupervisor({ stateDirectory, config: {} })
  supervisor.beginGeneration('boot')
  assert.equal(supervisor.childEnv().OM_DEV_RUNTIME_LOGS_FILE, supervisor.logsFilePath)
  assert.equal(fs.existsSync(supervisor.logsFilePath), true)
  supervisor.stop()
  assert.equal(fs.existsSync(supervisor.logsFilePath), false)
  fs.rmSync(stateDirectory, { recursive: true, force: true })
})
