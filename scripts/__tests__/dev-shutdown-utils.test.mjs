import test from 'node:test'
import assert from 'node:assert/strict'

import { killProcessTree } from '../dev-shutdown-utils.mjs'

function makeFakeSpawn() {
  const calls = []
  const fake = (command, args, options) => {
    const record = { command, args, options }
    calls.push(record)
    return {
      on: () => {},
    }
  }
  return { fake, calls }
}

function makeFakeChild(pid, { killed = false } = {}) {
  const killCalls = []
  return {
    pid,
    killed,
    kill: (signal) => {
      killCalls.push(signal)
      return true
    },
    killCalls,
  }
}

test('killProcessTree on win32 spawns taskkill with /T and /F for the child PID', () => {
  const { fake, calls } = makeFakeSpawn()
  const child = makeFakeChild(4242)

  const result = killProcessTree(child, 'SIGTERM', { platform: 'win32', spawn: fake })

  assert.equal(result, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'taskkill')
  assert.deepEqual(calls[0].args, ['/pid', '4242', '/T', '/F'])
  assert.equal(calls[0].options.stdio, 'ignore')
  assert.equal(calls[0].options.windowsHide, true)
  assert.equal(child.killCalls.length, 0)
})

test('killProcessTree on win32 always uses /T /F regardless of signal (covers SIGKILL fallback pass)', () => {
  const { fake, calls } = makeFakeSpawn()
  const child = makeFakeChild(99)

  killProcessTree(child, 'SIGKILL', { platform: 'win32', spawn: fake })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['/pid', '99', '/T', '/F'])
})

test('killProcessTree on win32 still attempts taskkill on a process flagged killed (idempotent second pass)', () => {
  const { fake, calls } = makeFakeSpawn()
  const child = makeFakeChild(7, { killed: true })

  const result = killProcessTree(child, 'SIGKILL', { platform: 'win32', spawn: fake })

  assert.equal(result, true)
  assert.equal(calls.length, 1)
})

test('killProcessTree on win32 returns false when pid is missing or invalid', () => {
  const { fake, calls } = makeFakeSpawn()

  assert.equal(killProcessTree({ pid: undefined, kill: () => {} }, 'SIGTERM', { platform: 'win32', spawn: fake }), false)
  assert.equal(killProcessTree({ pid: 0, kill: () => {} }, 'SIGTERM', { platform: 'win32', spawn: fake }), false)
  assert.equal(killProcessTree({ pid: Number.NaN, kill: () => {} }, 'SIGTERM', { platform: 'win32', spawn: fake }), false)
  assert.equal(calls.length, 0)
})

test('killProcessTree on win32 swallows taskkill spawn errors so shutdown keeps progressing', () => {
  const throwingSpawn = () => { throw new Error('ENOENT: taskkill missing') }
  const child = makeFakeChild(123)

  const result = killProcessTree(child, 'SIGTERM', { platform: 'win32', spawn: throwingSpawn })

  assert.equal(result, false)
  assert.equal(child.killCalls.length, 0)
})

test('killProcessTree on linux calls child.kill with the provided signal', () => {
  const { fake, calls } = makeFakeSpawn()
  const child = makeFakeChild(321)

  const result = killProcessTree(child, 'SIGTERM', { platform: 'linux', spawn: fake })

  assert.equal(result, true)
  assert.deepEqual(child.killCalls, ['SIGTERM'])
  assert.equal(calls.length, 0)
})

test('killProcessTree on darwin forwards SIGKILL to child.kill', () => {
  const child = makeFakeChild(500)

  killProcessTree(child, 'SIGKILL', { platform: 'darwin' })

  assert.deepEqual(child.killCalls, ['SIGKILL'])
})

test('killProcessTree on posix skips already-killed children', () => {
  const child = makeFakeChild(8, { killed: true })

  const result = killProcessTree(child, 'SIGTERM', { platform: 'linux' })

  assert.equal(result, false)
  assert.deepEqual(child.killCalls, [])
})

test('killProcessTree returns false for nullish child', () => {
  assert.equal(killProcessTree(null, 'SIGTERM', { platform: 'linux' }), false)
  assert.equal(killProcessTree(undefined, 'SIGTERM', { platform: 'win32' }), false)
})

test('killProcessTree on posix swallows child.kill exceptions', () => {
  const child = {
    pid: 11,
    killed: false,
    kill: () => { throw new Error('boom') },
  }

  const result = killProcessTree(child, 'SIGTERM', { platform: 'linux' })

  assert.equal(result, false)
})
