import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createSetupLogs } from '../setup-logs.mjs'

function harness({ isTTY = true, flowing = false, raw = false, ...options } = {}) {
  const input = new EventEmitter()
  Object.assign(input, {
    isTTY,
    isRaw: raw,
    readableFlowing: flowing,
    setRawMode(value) { this.isRaw = value },
    resume() { this.readableFlowing = true },
    pause() { this.readableFlowing = false },
  })
  const chunks = []
  const output = { isTTY, columns: 80, write: (chunk) => chunks.push(chunk) }
  const logs = createSetupLogs({ input, output, env: {}, ...options })
  return { input, output, chunks, logs, text: () => chunks.map(String).join('') }
}

test('compact setup folds, replays with d, streams live, and folds again with D', () => {
  const { input, logs, text } = harness()
  logs.start()
  assert.doesNotMatch(text(), /DEBUG LOGS/)
  assert.match(text(), /Press \[d\] to show or hide raw logs/)
  logs.log('migration %s', 'ready')
  assert.doesNotMatch(text(), /migration ready/)
  input.emit('data', Buffer.from('d'))
  assert.match(text(), /📖 Raw logs shown/)
  assert.match(text(), /migration ready/)
  logs.raw('live output\n')
  assert.match(text(), /live output/)
  const beforeHide = text()
  input.emit('data', 'D')
  assert.equal(text(), beforeHide, 'folding does not add a redundant notice')
  logs.log('hidden again')
  assert.doesNotMatch(text(), /hidden again/)
  logs.stop()
})

test('chunk boundaries and split UTF-8 characters survive buffered replay', () => {
  const { input, logs, text } = harness()
  logs.start()
  logs.raw('first par')
  logs.raw('t\nsecond ')
  const emoji = Buffer.from('✅')
  logs.raw(emoji.subarray(0, 1))
  logs.raw(emoji.subarray(1))
  logs.show('failure details')
  assert.match(text(), /first part\n   second ✅/)
  logs.raw(' done\n')
  assert.match(text(), /second ✅ done\n/)
  input.emit('data', 'd')
  logs.stop()
})

test('buffer keeps only the newest lines and caps an unterminated line', () => {
  const { logs, text } = harness()
  logs.start()
  for (let index = 0; index < 250; index++) logs.log(`line:${index}:end`)
  logs.raw('x'.repeat(50000))
  logs.show()
  assert.doesNotMatch(text(), /line:49:end/)
  assert.match(text(), /line:50:end/)
  assert.match(text(), /line:249:end/)
  assert.equal(text().match(/x/g)?.length, 4096)
  logs.stop()
})

test('start, suspend, resume and stop restore raw mode, flow and listeners', () => {
  for (const previousRaw of [true, false]) {
    for (const previousFlowing of [true, false]) {
      const { input, logs } = harness({ raw: previousRaw, flowing: previousFlowing })
      input.encoding = 'latin1'
      logs.start()
      logs.start()
      assert.equal(input.listenerCount('data'), 1)
      assert.equal(input.isRaw, true)
      assert.equal(input.readableFlowing, true)
      logs.suspend()
      assert.equal(input.listenerCount('data'), 0)
      assert.equal(input.isRaw, previousRaw)
      assert.equal(input.readableFlowing, previousFlowing)
      assert.equal(input.encoding, 'latin1')
      logs.resume()
      assert.equal(input.listenerCount('data'), 1)
      logs.stop()
      logs.stop()
      assert.equal(input.listenerCount('data'), 0)
      assert.equal(input.isRaw, previousRaw)
      assert.equal(input.readableFlowing, previousFlowing)
    }
  }
})

test('Ctrl+C uses the interrupt callback and suspended prompts do not consume d', () => {
  let interrupts = 0
  const { input, logs, text } = harness({ onInterrupt: () => interrupts++ })
  logs.start()
  input.emit('data', '\u0003')
  assert.equal(interrupts, 1)
  logs.suspend()
  input.emit('data', 'd')
  assert.doesNotMatch(text(), /RAW DEBUG LOGS/)
  logs.resume()
  input.emit('data', 'd')
  assert.match(text(), /RAW DEBUG LOGS/)
  logs.stop()
})

test('empty buffer has the same hint as dev and NO_COLOR removes ANSI', () => {
  const { logs, text } = harness({ env: { NO_COLOR: '1' } })
  logs.start()
  logs.show()
  assert.match(text(), /📭 No buffered logs yet/)
  assert.doesNotMatch(text(), /\u001b\[/)
  logs.stop()
})

test('noninteractive, verbose, CI and dumb terminals preserve raw output without toggles', () => {
  for (const options of [
    { isTTY: false },
    { verbose: true },
    { nonInteractive: true },
    { env: { CI: 'true' } },
    { env: { TERM: 'dumb' } },
    { env: { MERCATO_DEV_OUTPUT: 'verbose' } },
  ]) {
    const { logs, input, chunks, text } = harness(options)
    assert.equal(logs.interactive, false)
    logs.start()
    logs.resume()
    const bytes = Buffer.from('raw\r\n✅\n')
    logs.raw(bytes)
    logs.log('status %d', 2)
    logs.show('failure')
    logs.stop()
    assert.equal(chunks[0], bytes)
    assert.equal(text(), 'raw\r\n✅\nstatus 2\n')
    assert.equal(input.listenerCount('data'), 0)
  }
})

function temporaryRepo(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-setup-logs-'))
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }))
  return repoRoot
}

test('full output is saved while the terminal buffer stays bounded, including across restarts', (t) => {
  const repoRoot = temporaryRepo(t)
  const { logs, text } = harness({ repoRoot, env: { OM_DEV_RUN_ID: 'test-run' } })
  logs.start()
  const file = path.join(repoRoot, '.mercato', 'logs', 'test-run-setup-raw.log')
  assert.equal(logs.logFile, file)
  assert.match(text(), /📝 Verbose logs/)
  assert.ok(text().includes(file))
  const full = Array.from({ length: 400 }, (_, index) => `line ${index}\n`).join('') + 'x'.repeat(50000)
  logs.raw(full)
  logs.stop()
  assert.equal(fs.readFileSync(file, 'utf8'), full)
  logs.start()
  logs.raw(Buffer.from('\nlast output\n'))
  logs.stop()
  assert.equal(logs.logFile, file)
  assert.equal(fs.readFileSync(file, 'utf8'), `${full}\nlast output\n`)
})

test('CI and verbose modes announce and save the same raw file while passing output through', (t) => {
  for (const options of [{ env: { CI: 'true' } }, { verbose: true }]) {
    const repoRoot = temporaryRepo(t)
    const { logs, text } = harness({ repoRoot, ...options })
    logs.start()
    logs.raw('stdout\nstderr\n')
    logs.stop()
    assert.match(text(), /📝 Verbose logs/)
    assert.match(text(), /stdout\nstderr\n/)
    assert.equal(fs.readFileSync(logs.logFile, 'utf8'), 'stdout\nstderr\n')
  }
})

test('log path controls use the dev conventions and run IDs cannot escape the log directory', (t) => {
  const repoRoot = temporaryRepo(t)
  const { logs } = harness({
    repoRoot,
    name: 'infra',
    env: { OM_DEV_LOG_DIR: 'custom-logs', OM_DEV_RUN_ID: '../../outside' },
  })
  logs.start()
  logs.stop()
  assert.equal(path.dirname(logs.logFile), path.join(repoRoot, 'custom-logs'))
  assert.ok(logs.logFile.endsWith('-infra-raw.log'))
  for (const disabled of ['0', 'false']) {
    const { logs: disabledLogs, text } = harness({ repoRoot, env: { OM_DEV_LOG_TEE: disabled } })
    disabledLogs.start()
    disabledLogs.raw('not saved\n')
    disabledLogs.stop()
    assert.equal(disabledLogs.logFile, null)
    assert.doesNotMatch(text(), /Verbose logs/)
  }
})

test('file creation failure warns once and leaves terminal output usable', (t) => {
  const repoRoot = temporaryRepo(t)
  fs.writeFileSync(path.join(repoRoot, '.mercato'), 'not a directory')
  const { logs, text } = harness({ repoRoot, isTTY: false })
  logs.start()
  logs.raw('still running\n')
  logs.raw('next line\n')
  logs.stop()
  assert.equal(logs.logFile, null)
  assert.equal(text().match(/Could not save setup logs/g).length, 1)
  assert.match(text(), /still running\nnext line\n/)
})

test('append failure does not abort setup or prevent raw logs from being revealed', (t) => {
  const repoRoot = temporaryRepo(t)
  const { logs, text } = harness({ repoRoot })
  logs.start()
  fs.rmSync(logs.logFile)
  fs.mkdirSync(logs.logFile)
  logs.raw('details after disk failure\n')
  logs.show('command failed')
  logs.stop()
  assert.match(text(), /Could not save setup logs/)
  assert.match(text(), /details after disk failure/)
})

test('record saves summaries without duplicating them in terminal output or buffered replay', (t) => {
  const repoRoot = temporaryRepo(t)
  const { logs, text } = harness({ repoRoot })
  logs.start()
  logs.record('Step %d: build', 6)
  logs.log('compiler output')
  logs.show()
  logs.stop()
  assert.doesNotMatch(text(), /Step 6: build/)
  assert.match(text(), /compiler output/)
  assert.equal(fs.readFileSync(logs.logFile, 'utf8'), 'Step 6: build\ncompiler output\n')
})


test('reopening logs or revealing a failure never repeats output already displayed', (t) => {
  const repoRoot = temporaryRepo(t)
  const { input, logs, text } = harness({ repoRoot })
  logs.start()
  logs.log('compiler detail: packages ready')
  input.emit('data', 'd')
  logs.log('live compiler detail')
  input.emit('data', 'd')
  logs.log('new migration diagnostic')
  logs.show('Database failed')
  logs.stop()
  for (const detail of ['compiler detail: packages ready', 'live compiler detail', 'new migration diagnostic']) {
    assert.equal(text().split(detail).length - 1, 1, detail + ' appears once')
  }
  assert.doesNotMatch(text(), /Raw logs hidden/)
  assert.equal(fs.readFileSync(logs.logFile, 'utf8'), 'compiler detail: packages ready\nlive compiler detail\nnew migration diagnostic\n')
})

test('folding a partial live line adds only a newline before resuming progress', () => {
  const { input, logs, text } = harness()
  logs.start()
  logs.raw('compiler par')
  input.emit('data', 'd')
  logs.raw('tial')
  const beforeHide = text()
  input.emit('data', 'd')
  assert.equal(text(), beforeHide + '\n')
  logs.raw('new hidden tail')
  input.emit('data', 'd')
  assert.equal(text().split('compiler partial').length - 1, 1)
  assert.match(text(), /new hidden tail/)
  logs.stop()
})


test('dark gray banner and setup messages share three-space content padding', () => {
  const { logs, text } = harness()
  logs.start()
  logs.raw('compiler par')
  logs.show()
  logs.raw('tial\nnext line\n')
  logs.stop()
  assert.match(text(), /\x1b\[48;2;51;55;64;97m   Press \[d\]/)
  assert.doesNotMatch(text(), /\x1b\[46/)
  assert.match(text(), /\n   compiler partial\n   next line\n/)
})


test('starter-generated details align with raw child output without altering the saved file', (t) => {
  const repoRoot = temporaryRepo(t)
  const { logs, text } = harness({ repoRoot })
  logs.start()
  logs.log('   generated status')
  logs.raw('child diagnostic\n')
  logs.show()
  logs.stop()
  assert.match(text(), /\n   generated status\n   child diagnostic\n/)
  assert.equal(fs.readFileSync(logs.logFile, 'utf8'), '   generated status\nchild diagnostic\n')
})


test('live carriage-return progress keeps the same left margin', () => {
  const { logs, text } = harness()
  logs.start()
  logs.show()
  const before = text()
  logs.raw('first\rsecond\r\nthird')
  assert.equal(text().slice(before.length), '   first\r   second\r\n   third')
  logs.stop()
})
