import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

function makeTempDir(prefix = 'template-dev-log-files-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function rmTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

test('standalone template dev-log-files exports the runtime logging API expected by dev.mjs', async () => {
  const moduleUrl = new URL('../../template/scripts/dev-log-files.mjs', import.meta.url)
  const devLogFiles = await import(moduleUrl.href)
  const tempDir = makeTempDir()

  try {
    assert.equal(typeof devLogFiles.createDevLogSession, 'function')
    assert.equal(typeof devLogFiles.noteCommandStart, 'function')
    assert.equal(typeof devLogFiles.noteCommandEnd, 'function')
    assert.equal(typeof devLogFiles.attachLoggedProcessStreams, 'function')
    assert.equal(typeof devLogFiles.formatDevLogAnnouncement, 'function')

    const session = devLogFiles.createDevLogSession({
      logDir: tempDir,
      role: 'dev-runner',
      runId: 'template-check',
    })

    assert.equal(typeof session.closeAll, 'function')
    const handle = session.openLog('runner', { mode: 'dev' })
    assert.equal(typeof handle.write, 'function')
    assert.equal(typeof handle.writeLine, 'function')
    assert.equal(typeof handle.close, 'function')

    handle.writeLine('hello from template')
    await session.closeAll()

    const contents = fs.readFileSync(handle.filePath, 'utf8')
    assert.match(contents, /hello from template/)
  } finally {
    rmTempDir(tempDir)
  }
})

test('standalone template dev wrapper defaults background services to lazy mode', () => {
  const devScriptPath = new URL('../../template/scripts/dev.mjs', import.meta.url)
  const source = fs.readFileSync(devScriptPath, 'utf8')

  assert.match(source, /function applyLocalDevBackgroundServiceDefaults/)
  assert.match(source, /OM_AUTO_SPAWN_WORKERS_LAZY = 'true'/)
  assert.match(source, /OM_AUTO_SPAWN_WORKERS_LAZY_MODE = 'shared'/)
  assert.match(source, /OM_AUTO_SPAWN_SCHEDULER_LAZY = 'true'/)
  assert.match(source, /OM_DEV_WARMUP_READY_FILE/)
  assert.match(source, /env: buildAppDevEnv\(/)
})

test('standalone template dev runtime replays buffered output when a child exits unexpectedly', async () => {
  const moduleUrl = new URL('../../template/scripts/dev-runtime-log-policy.mjs', import.meta.url)
  const { buildUnexpectedChildExitReport } = await import(moduleUrl.href)

  // Compact mode drops unclassified child output, so a crash would otherwise
  // report nothing but an exit code.
  const compact = buildUnexpectedChildExitReport({
    label: 'App runtime',
    exitStatus: 'exit code 1',
    bufferedFailureLines: ['Another next dev server is already running.'],
    logsVisible: false,
  })

  const banner = '❌ App runtime exited unexpectedly with exit code 1'
  assert.deepEqual(compact.terminalLines, [
    banner,
    '📄 Last 1 runtime log line(s) before the exit:',
    'Another next dev server is already running.',
    'ℹ️ Rerun with MERCATO_DEV_OUTPUT=verbose for the full runtime output.',
  ])
  assert.equal(compact.terminalLines.filter((line: string) => line === banner).length, 1)
  assert.deepEqual(compact.failureLines, ['Another next dev server is already running.', banner])

  // With raw logs already streaming, replaying them would duplicate the output.
  const streaming = buildUnexpectedChildExitReport({
    label: 'App runtime',
    exitStatus: 'exit code 1',
    bufferedFailureLines: ['Another next dev server is already running.'],
    logsVisible: true,
  })
  assert.deepEqual(streaming.terminalLines, [banner])
  assert.deepEqual(streaming.failureLines, ['Another next dev server is already running.', banner])
})

test('standalone template dev runtime wires the exit report into the child exit path', () => {
  const runtimeScriptPath = new URL('../../template/scripts/dev-runtime.mjs', import.meta.url)
  const source = fs.readFileSync(runtimeScriptPath, 'utf8')

  // The behavior lives in dev-runtime-log-policy.mjs; this guards the wiring so
  // the replay cannot silently stop running on an unexpected child exit.
  assert.match(source, /buildUnexpectedChildExitReport,/)
  assert.match(source, /const report = buildUnexpectedChildExitReport\(\{/)
  assert.match(source, /for \(const line of report\.terminalLines\) \{\n {4}console\.error\(line\)/)
  assert.match(source, /failureLines: report\.failureLines,/)
  // The banner is printed from terminalLines, so buffering must not echo it again.
  assert.match(source, /bufferRawLog\(report\.banner\)/)
  assert.match(source, /reportUnexpectedChildExit\(result\)/)
})

test('standalone template dev runtime releases raw passthrough when the runtime restarts', async () => {
  const moduleUrl = new URL('../../template/scripts/dev-runtime-log-policy.mjs', import.meta.url)
  const { createRuntimeFailureLatch } = await import(moduleUrl.href)

  const latch = createRuntimeFailureLatch()
  latch.latch()
  // Without a release the retried dev server would stay reported as failed:
  // classification stops, so warmup never starts and the splash never turns ready.
  assert.equal(latch.releaseOn('- PID:          4242'), false)
  assert.equal(
    latch.releaseOn('[server] Next.js dev server exited before becoming ready (exit code 1). Retrying once...'),
    true,
  )
  assert.equal(latch.isLatched(), false)
})

test('standalone template dev runtime wires the failure latch into the compact reporter', () => {
  const runtimeScriptPath = new URL('../../template/scripts/dev-runtime.mjs', import.meta.url)
  const source = fs.readFileSync(runtimeScriptPath, 'utf8')

  // The latch behavior lives in dev-runtime-log-policy.mjs; this guards the wiring
  // so the reporter cannot go back to swallowing every line after a failure.
  assert.match(source, /createRuntimeFailureLatch,/)
  assert.match(source, /const failureLatch = createRuntimeFailureLatch\(\)/)
  assert.match(source, /if \(!failureLatch\.releaseOn\(plain\)\) return/)
  assert.match(source, /failureLatch\.latch\(\)/)
  assert.doesNotMatch(source, /passthrough = true/)
})

test('standalone template dev runtime surfaces Next.js startup failures and cold-start retries', () => {
  const runtimeScriptPath = new URL('../../template/scripts/dev-runtime.mjs', import.meta.url)
  const source = fs.readFileSync(runtimeScriptPath, 'utf8')

  assert.match(source, /Another next dev server is already running/)
  assert.match(source, /TurbopackInternalError/)
  assert.match(source, /EADDRINUSE/)
  assert.match(source, /\[server\] Next\.js dev server exited before becoming ready/)
})

test('standalone template dev runtime log policy mirrors the monorepo source', async () => {
  const templateUrl = new URL('../../template/scripts/dev-runtime-log-policy.mjs', import.meta.url)
  const monorepoUrl = new URL('../../../../apps/mercato/scripts/dev-runtime-log-policy.mjs', import.meta.url)

  assert.equal(
    fs.readFileSync(templateUrl, 'utf8'),
    fs.readFileSync(monorepoUrl, 'utf8'),
    'template/scripts/dev-runtime-log-policy.mjs must stay byte-identical to apps/mercato/scripts/dev-runtime-log-policy.mjs',
  )
})

test('standalone template setup forwards the verbose flag to the dev orchestrator', () => {
  const setupScriptPath = new URL('../../template/scripts/setup.mjs', import.meta.url)
  const source = fs.readFileSync(setupScriptPath, 'utf8')

  assert.match(source, /const verbose = argv\.includes\('--verbose'\)/)
  assert.match(source, /\.\.\.\(verbose \? \['--verbose'\] : \[\]\)/)
})

test('standalone template dev wrapper owns shutdown notice for managed runtime', () => {
  const devScriptPath = new URL('../../template/scripts/dev.mjs', import.meta.url)
  const runtimeScriptPath = new URL('../../template/scripts/dev-runtime.mjs', import.meta.url)
  const devSource = fs.readFileSync(devScriptPath, 'utf8')
  const runtimeSource = fs.readFileSync(runtimeScriptPath, 'utf8')

  assert.match(devSource, /function announceShutdown\(\)/)
  assert.match(devSource, /Shutting down services\.\.\./)
  assert.match(devSource, /OM_DEV_SHUTDOWN_NOTICE_OWNER: 'parent'/)
  assert.match(runtimeSource, /shutdownNoticeOwnedByParent/)
  assert.match(runtimeSource, /if \(!shutdownNoticeOwnedByParent\)/)
  assert.match(runtimeSource, /Shutting down services\.\.\./)
})

test('standalone template dev reset clears configured Next dev distDir cache', () => {
  const sourceScriptPath = new URL('../../template/scripts/dev-reset.mjs', import.meta.url)
  const tempDir = makeTempDir('template-dev-reset-')

  try {
    const scriptsDir = path.join(tempDir, 'scripts')
    const distDevDir = path.join(tempDir, '.mercato', 'next', 'dev')
    const legacyTurboDir = path.join(tempDir, '.next', 'cache', 'turbopack')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(distDevDir, { recursive: true })
    fs.mkdirSync(legacyTurboDir, { recursive: true })
    fs.copyFileSync(sourceScriptPath, path.join(scriptsDir, 'dev-reset.mjs'))

    const result = spawnSync(process.execPath, [path.join(scriptsDir, 'dev-reset.mjs')], {
      cwd: tempDir,
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.existsSync(distDevDir), false)
    assert.equal(fs.existsSync(legacyTurboDir), false)
    assert.match(result.stdout, /\.mercato[/\\]next[/\\]dev/)
  } finally {
    rmTempDir(tempDir)
  }
})
