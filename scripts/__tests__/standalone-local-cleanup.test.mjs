import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { createStandaloneCleanup, registerStandaloneCleanup } from '../lib/standalone-local-cleanup.mjs'

test('server shutdown failure cannot skip database removal', async () => {
  let stoppedDatabase = false
  const cleanup = createStandaloneCleanup({
    stopServer: async () => { throw new Error('Server stop failed') },
    stopDatabase: () => { stoppedDatabase = true },
  })
  await assert.rejects(cleanup(), /Server stop failed/)
  assert.equal(stoppedDatabase, true)
})

test('interruption during partial setup cleans up resources once and preserves signal exit status', async () => {
  const runtime = new EventEmitter()
  const exits = []
  runtime.exit = (code) => exits.push(code)
  let databaseStops = 0
  const cleanup = createStandaloneCleanup({
    stopServer: async () => {},
    stopDatabase: () => { databaseStops += 1 },
  })
  const removeHandlers = registerStandaloneCleanup(cleanup, runtime)
  runtime.emit('SIGINT')
  runtime.emit('SIGTERM')
  await cleanup()
  await Promise.resolve()
  assert.equal(databaseStops, 1)
  assert.deepEqual(exits, [130])
  removeHandlers()
  assert.equal(runtime.listenerCount('SIGINT'), 0)
  assert.equal(runtime.listenerCount('SIGTERM'), 0)
})

test('a real termination signal interrupts an active child command before cleaning resources', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-command-signal-'))
  const markerPath = path.join(tempRoot, 'child-finished')
  const commandModule = new URL('../lib/standalone-command.mjs', import.meta.url).href
  const cleanupModule = new URL('../lib/standalone-local-cleanup.mjs', import.meta.url).href
  const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'finished'), 2500)`
  const fixture = `
    import { createStandaloneCommandRunner } from ${JSON.stringify(commandModule)}
    import { createStandaloneCleanup, registerStandaloneCleanup } from ${JSON.stringify(cleanupModule)}
    const runner = createStandaloneCommandRunner({ defaultCwd: process.cwd() })
    const cleanup = createStandaloneCleanup({ stopCommand: runner.stop, stopServer: async () => {}, stopDatabase: () => {} })
    registerStandaloneCleanup(cleanup)
    console.log('READY')
    await runner.run(process.execPath, ['-e', ${JSON.stringify(childScript)}]).catch(() => {})
    await new Promise(() => {})
  `
  const fixtureProcess = spawn(process.execPath, ['--input-type=module', '--eval', fixture], {
    cwd: tempRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  try {
    let output = ''
    fixtureProcess.stdout.on('data', (chunk) => { output += chunk.toString() })
    await Promise.race([
      new Promise((resolve) => {
        const poll = () => output.includes('READY') ? resolve() : setTimeout(poll, 10)
        poll()
      }),
      delay(5_000).then(() => { throw new Error('Signal fixture did not become ready') }),
    ])
    fixtureProcess.kill('SIGTERM')
    const [code, signal] = await Promise.race([
      once(fixtureProcess, 'close'),
      delay(5_000).then(() => { throw new Error('Signal fixture did not exit after cleanup') }),
    ])
    assert.equal(code, 143)
    assert.equal(signal, null)
    await delay(3_000)
    assert.equal(fs.existsSync(markerPath), false)
  } finally {
    if (fixtureProcess.exitCode === null && fixtureProcess.signalCode === null) fixtureProcess.kill('SIGKILL')
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
