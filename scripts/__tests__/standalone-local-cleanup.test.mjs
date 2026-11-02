import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
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
