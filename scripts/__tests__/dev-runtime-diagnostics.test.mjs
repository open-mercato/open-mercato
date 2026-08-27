import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  browserReportToSignal,
  createDevRuntimeToken,
  createDiagnosticsSink,
  createRateLimiter,
  isMatchingDevRuntimeToken,
  validateBrowserReport,
} from '../dev-runtime-diagnostics.mjs'
import { createRuntimeStateStore } from '../dev-runtime-state.mjs'

function withTempSink(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-dev-diagnostics-'))
  try {
    return run(path.join(directory, 'diagnostics.ndjson'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('issues distinct high-entropy tokens', () => {
  const first = createDevRuntimeToken()
  const second = createDevRuntimeToken()
  assert.notEqual(first, second)
  assert.ok(first.length >= 32)
})

test('matches only the exact token', () => {
  const token = createDevRuntimeToken()
  assert.equal(isMatchingDevRuntimeToken(token, token), true)
  assert.equal(isMatchingDevRuntimeToken(token, `${token}x`), false)
  assert.equal(isMatchingDevRuntimeToken(token, ''), false)
  assert.equal(isMatchingDevRuntimeToken('', ''), false)
  assert.equal(isMatchingDevRuntimeToken(token, undefined), false)
})

test('accepts a valid bounded report', () => {
  const result = validateBrowserReport({
    kind: 'global-error',
    message: 'TypeError: x is not a function',
    digest: 'abc123',
    path: '/backend/example',
    stack: 'at render (page.tsx:1:1)',
    timestamp: '2026-08-18T10:00:00.000Z',
  })
  assert.equal(result.ok, true)
  assert.equal(result.report.kind, 'global-error')
  assert.equal(result.report.path, '/backend/example')
  assert.equal(result.report.timestamp, '2026-08-18T10:00:00.000Z')
})

test('rejects an unsupported kind', () => {
  const result = validateBrowserReport({ kind: 'shell-exec', message: 'boom' })
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
  assert.equal(result.error.code, 'invalid_report')
})

test('rejects a report without a message', () => {
  assert.equal(validateBrowserReport({ kind: 'global-error' }).ok, false)
  assert.equal(validateBrowserReport({ kind: 'global-error', message: '   ' }).ok, false)
})

test('rejects a malformed digest, path and timestamp', () => {
  assert.equal(validateBrowserReport({ kind: 'global-error', message: 'x', digest: 'a b' }).ok, false)
  assert.equal(validateBrowserReport({ kind: 'global-error', message: 'x', path: 'x'.repeat(400) }).ok, false)
  assert.equal(validateBrowserReport({ kind: 'global-error', message: 'x', timestamp: 'not-a-date' }).ok, false)
})

test('rejects an oversized report', () => {
  const oversized = JSON.stringify({ kind: 'global-error', message: 'x'.repeat(20_000) })
  const result = validateBrowserReport(oversized)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'report_too_large')
})

test('rejects non-JSON input', () => {
  assert.equal(validateBrowserReport('{not json').ok, false)
  assert.equal(validateBrowserReport(null).ok, false)
  assert.equal(validateBrowserReport(['array']).ok, false)
})

test('redacts secrets inside an accepted report', () => {
  const result = validateBrowserReport({
    kind: 'window-error',
    message: 'failed to reach postgres://admin:hunter2@localhost:5432/app',
    stack: 'authorization: Bearer abcdefgh12345678',
  })
  assert.equal(result.ok, true)
  assert.ok(!JSON.stringify(result.report).includes('hunter2'))
  assert.ok(!JSON.stringify(result.report).includes('abcdefgh12345678'))
})

test('bounds an over-long stack', () => {
  const result = validateBrowserReport({ kind: 'global-error', message: 'boom', stack: 'y'.repeat(5000) })
  assert.equal(result.ok, true)
  assert.ok(result.report.stack.length <= 2000)
})

test('converts a report into a non-blocking browser signal', () => {
  const store = createRuntimeStateStore()
  store.beginGeneration('test')
  store.markReady()
  const { report } = validateBrowserReport({ kind: 'global-error', message: 'boom', path: '/backend' })
  const status = store.recordSignal(browserReportToSignal(report, store.getGeneration()))
  assert.equal(status.health, 'degraded')
  assert.equal(status.issueSummary.source, 'browser')
  assert.equal(status.issueSummary.path, '/backend')
})

test('rate limiter allows a bounded burst and refills after the window', () => {
  let current = 0
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => current })
  assert.equal(limiter.tryConsume(), true)
  assert.equal(limiter.tryConsume(), true)
  assert.equal(limiter.tryConsume(), false)
  current += 1000
  assert.equal(limiter.tryConsume(), true)
})

test('sink round-trips appended reports exactly once', () => {
  withTempSink((filePath) => {
    const writer = createDiagnosticsSink({ filePath })
    const reader = createDiagnosticsSink({ filePath })
    writer.clear()
    writer.append({ kind: 'global-error', message: 'first' })
    writer.append({ kind: 'global-error', message: 'second' })

    const drained = reader.drain()
    assert.deepEqual(drained.map((report) => report.message), ['first', 'second'])
    assert.deepEqual(reader.drain(), [])

    writer.append({ kind: 'global-error', message: 'third' })
    assert.deepEqual(reader.drain().map((report) => report.message), ['third'])
  })
})

test('sink ignores a partially written trailing line until it completes', () => {
  withTempSink((filePath) => {
    const reader = createDiagnosticsSink({ filePath })
    fs.writeFileSync(filePath, '{"kind":"global-error","message":"complete"}\n{"kind":"global-err', 'utf8')
    assert.deepEqual(reader.drain().map((report) => report.message), ['complete'])

    fs.appendFileSync(filePath, 'or","message":"tail"}\n', 'utf8')
    assert.deepEqual(reader.drain().map((report) => report.message), ['tail'])
  })
})

test('sink skips malformed and invalid lines', () => {
  withTempSink((filePath) => {
    const reader = createDiagnosticsSink({ filePath })
    fs.writeFileSync(filePath, 'not json\n{"kind":"nope","message":"x"}\n{"kind":"global-error","message":"kept"}\n', 'utf8')
    assert.deepEqual(reader.drain().map((report) => report.message), ['kept'])
  })
})

test('sink rotates once it exceeds the byte limit', () => {
  withTempSink((filePath) => {
    const sink = createDiagnosticsSink({ filePath, maxBytes: 200 })
    sink.clear()
    for (let index = 0; index < 20; index += 1) {
      sink.append({ kind: 'global-error', message: `message ${index}` })
    }
    sink.drain()
    assert.equal(fs.existsSync(filePath), false)
  })
})

test('sink recovers when the file is rotated underneath the reader', () => {
  withTempSink((filePath) => {
    const writer = createDiagnosticsSink({ filePath })
    const reader = createDiagnosticsSink({ filePath })
    writer.clear()
    writer.append({ kind: 'global-error', message: 'first' })
    reader.drain()

    writer.clear()
    writer.append({ kind: 'global-error', message: 'after-rotation' })
    assert.deepEqual(reader.drain().map((report) => report.message), ['after-rotation'])
  })
})

test('sink returns no reports when the file does not exist', () => {
  withTempSink((filePath) => {
    const sink = createDiagnosticsSink({ filePath })
    assert.deepEqual(sink.drain(), [])
  })
})
