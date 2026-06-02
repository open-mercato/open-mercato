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
  assert.match(source, /OM_AUTO_SPAWN_SCHEDULER_LAZY = 'true'/)
  assert.match(source, /OM_DEV_WARMUP_READY_FILE/)
  assert.match(source, /env: buildAppDevEnv\(/)
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
    assert.match(result.stdout, /\.mercato\/next\/dev/)
  } finally {
    rmTempDir(tempDir)
  }
})
