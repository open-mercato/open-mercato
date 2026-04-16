import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

import {
  attachLoggedProcessStreams,
  createDevLogSession,
  formatDevLogAnnouncement,
  noteCommandEnd,
  noteCommandStart,
} from '../dev-log-files.mjs'

function makeTempDir(prefix = 'dev-log-files-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function rmTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

async function flushHandle(handle) {
  const result = handle.close()
  if (result && typeof result.then === 'function') {
    await result
  }
}

test('createDevLogSession sanitizes runId/role and exposes filePattern + env vars', () => {
  const tempDir = makeTempDir()
  try {
    const session = createDevLogSession({
      logDir: tempDir,
      role: 'Dev Runner!!',
      runId: '2026-04-09T08:00:00.000Z--PID 12',
    })

    assert.equal(session.role, 'dev-runner')
    assert.match(session.runId, /^2026-04-09t08-00-00.000z-pid-12$/)
    assert.equal(session.filePattern, path.join(tempDir, `${session.runId}-dev-runner-*.log`))
    assert.deepEqual(session.env, {
      OM_DEV_LOG_DIR: tempDir,
      OM_DEV_RUN_ID: session.runId,
    })
    assert.equal(formatDevLogAnnouncement(session), session.filePattern)
    assert.equal(typeof session.openLog, 'function')
    assert.equal(typeof session.closeAll, 'function')
  } finally {
    rmTempDir(tempDir)
  }
})

test('createDevLogSession creates the log directory if missing', () => {
  const tempDir = makeTempDir()
  const nested = path.join(tempDir, 'nested', 'logs')
  try {
    createDevLogSession({ logDir: nested, role: 'dev-runner', runId: 'abc' })
    assert.equal(fs.existsSync(nested), true)
  } finally {
    rmTempDir(tempDir)
  }
})

test('openLog writes a header with metadata and is idempotent per label', async () => {
  const tempDir = makeTempDir()
  try {
    const session = createDevLogSession({ logDir: tempDir, role: 'dev-runner', runId: 'run1' })

    const handle = session.openLog('runner', { argv: ['--verbose'], cwd: '/tmp/proj', mode: 'dev' })
    const sameHandle = session.openLog('runner', { ignored: true })
    assert.strictEqual(handle, sameHandle)

    handle.writeLine('first line')
    handle.write('raw chunk')
    await flushHandle(handle)

    const contents = fs.readFileSync(handle.filePath, 'utf8')
    assert.match(contents, /^# Open Mercato dev log/m)
    assert.match(contents, /^# Run ID: run1/m)
    assert.match(contents, /^# Role: dev-runner/m)
    assert.match(contents, /^# Label: runner/m)
    assert.match(contents, /^# argv: \["--verbose"\]/m)
    assert.match(contents, /^# cwd: \/tmp\/proj/m)
    assert.match(contents, /^# mode: dev/m)
    assert.match(contents, /^first line$/m)
    assert.match(contents, /raw chunk/)
  } finally {
    rmTempDir(tempDir)
  }
})

test('openLog appends a "Reopened" marker when the file already exists', async () => {
  const tempDir = makeTempDir()
  try {
    const session1 = createDevLogSession({ logDir: tempDir, role: 'dev-runner', runId: 'reopen' })
    const handle1 = session1.openLog('runner', { mode: 'dev' })
    handle1.writeLine('parent line')
    await flushHandle(handle1)

    const session2 = createDevLogSession({ logDir: tempDir, role: 'dev-runner', runId: 'reopen' })
    const handle2 = session2.openLog('runner', { mode: 'dev' })
    handle2.writeLine('child line')
    await flushHandle(handle2)

    const contents = fs.readFileSync(handle2.filePath, 'utf8')
    // The original header must still be present (we did not overwrite the file)
    assert.match(contents, /^# Open Mercato dev log/m)
    assert.match(contents, /parent line/)
    assert.match(contents, /^# --- Reopened /m)
    assert.match(contents, /child line/)
  } finally {
    rmTempDir(tempDir)
  }
})

test('noteCommandStart and noteCommandEnd write framing lines', async () => {
  const tempDir = makeTempDir()
  try {
    const session = createDevLogSession({ logDir: tempDir, role: 'dev-runner', runId: 'frame' })
    const handle = session.openLog('runner')

    noteCommandStart(handle, 'build:packages', 'yarn', ['build:packages'])
    noteCommandEnd(handle, 'build:packages', 0, null)
    noteCommandEnd(handle, 'build:packages', null, 'SIGTERM')
    await flushHandle(handle)

    const contents = fs.readFileSync(handle.filePath, 'utf8')
    assert.match(contents, /=== .* build:packages ===/)
    assert.match(contents, /^\$ yarn build:packages$/m)
    assert.match(contents, /=== .* build:packages done \(exit=0\) ===/)
    assert.match(contents, /=== .* build:packages done \(signal=SIGTERM\) ===/)
  } finally {
    rmTempDir(tempDir)
  }
})

test('noteCommandStart and noteCommandEnd are no-ops on null logFile', () => {
  assert.doesNotThrow(() => noteCommandStart(null, 'label', 'cmd', []))
  assert.doesNotThrow(() => noteCommandEnd(null, 'label', 0, null))
})

test('attachLoggedProcessStreams forwards stdout/stderr chunks to logFile and mirror targets', async () => {
  const tempDir = makeTempDir()
  try {
    const session = createDevLogSession({ logDir: tempDir, role: 'dev-runner', runId: 'attach' })
    const handle = session.openLog('runner')

    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()

    const stdoutMirror = { written: [], write(chunk) { this.written.push(String(chunk)) } }
    const stderrMirror = { written: [], write(chunk) { this.written.push(String(chunk)) } }

    attachLoggedProcessStreams(child, handle, { stdout: stdoutMirror, stderr: stderrMirror })

    child.stdout.emit('data', Buffer.from('out chunk\n'))
    child.stderr.emit('data', 'err chunk\n')
    await flushHandle(handle)

    assert.deepEqual(stdoutMirror.written, ['out chunk\n'])
    assert.deepEqual(stderrMirror.written, ['err chunk\n'])

    const contents = fs.readFileSync(handle.filePath, 'utf8')
    assert.match(contents, /out chunk/)
    assert.match(contents, /err chunk/)
  } finally {
    rmTempDir(tempDir)
  }
})

test('attachLoggedProcessStreams tolerates missing child stdio and null logFile', () => {
  const child = new EventEmitter()
  // Only stdout present
  child.stdout = new EventEmitter()

  assert.doesNotThrow(() => attachLoggedProcessStreams(child, null, { stdout: { write() {} } }))
  assert.doesNotThrow(() => attachLoggedProcessStreams(null, null))
  child.stdout.emit('data', 'noop')
})

test('createDevLogSession writes nothing when the session is closed before any writes', async () => {
  const tempDir = makeTempDir()
  try {
    const session = createDevLogSession({ logDir: tempDir, role: 'dev-runner', runId: 'close' })
    const handle = session.openLog('runner')
    await session.closeAll()
    // closeAll should be safe to call twice
    await session.closeAll()
    // close on the handle should also be safe to call again
    await handle.close()
  } finally {
    rmTempDir(tempDir)
  }
})
