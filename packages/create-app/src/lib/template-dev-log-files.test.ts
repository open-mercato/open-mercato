import assert from 'node:assert/strict'
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
