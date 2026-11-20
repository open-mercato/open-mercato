import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn as nativeSpawn } from 'node:child_process'

import { inspectProcessTree, killProcessTree, signalProcessTree } from '../dev-shutdown-utils.mjs'

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

  const result = killProcessTree(child, 'SIGTERM', { platform: 'linux', spawn: fake, readProcessTable: () => [] })

  assert.equal(result, true)
  assert.deepEqual(child.killCalls, ['SIGTERM'])
  assert.equal(calls.length, 0)
})

test('killProcessTree on darwin forwards SIGKILL to child.kill', () => {
  const child = makeFakeChild(500)

  killProcessTree(child, 'SIGKILL', { platform: 'darwin', readProcessTable: () => [] })

  assert.deepEqual(child.killCalls, ['SIGKILL'])
})

test('killProcessTree on posix escalates children after a previous signal was sent', () => {
  const child = makeFakeChild(8, { killed: true })

  const result = killProcessTree(child, 'SIGKILL', { platform: 'linux', readProcessTable: () => [] })

  assert.equal(result, true)
  assert.deepEqual(child.killCalls, ['SIGKILL'])
})

test('killProcessTree returns false for nullish child', () => {
  assert.equal(killProcessTree(null, 'SIGTERM', { platform: 'linux', readProcessTable: () => [] }), false)
  assert.equal(killProcessTree(undefined, 'SIGTERM', { platform: 'win32' }), false)
})

test('killProcessTree on posix swallows child.kill exceptions', () => {
  const child = {
    pid: 11,
    killed: false,
    kill: () => { throw new Error('boom') },
  }

  const result = killProcessTree(child, 'SIGTERM', { platform: 'linux', readProcessTable: () => [] })

  assert.equal(result, false)
})

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim()
    return state !== '' && !state.startsWith('Z')
  } catch {
    return false
  }
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`POSIX shutdown retains a resistant grandchild after wrapper exits on ${signal}`, async (context) => {
    if (process.platform === 'win32') return context.skip('POSIX process-tree behavior')
    const unrelated = nativeSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const wrapperSource = `
      const { spawn } = require('node:child_process')
      const leaf = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.on('SIGINT', () => {}); process.send('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      leaf.on('message', () => process.send(leaf.pid))
      process.on('SIGTERM', () => process.exit(0))
      process.on('SIGINT', () => process.exit(0))
      setInterval(() => {}, 1000)
    `
    const wrapper = nativeSpawn(process.execPath, ['-e', wrapperSource], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    let leafPid
    try {
      leafPid = await new Promise((resolve, reject) => {
        wrapper.once('message', resolve)
        wrapper.once('error', reject)
      })
      killProcessTree(wrapper, signal)
      await waitUntil(() => !isRunning(wrapper.pid), 'wrapper did not exit')
      assert.equal(isRunning(leafPid), true)
      killProcessTree(wrapper, 'SIGKILL')
      await waitUntil(() => !isRunning(leafPid), 'grandchild survived forced cleanup after its wrapper exited')
      assert.equal(isRunning(unrelated.pid), true, 'unrelated process was terminated')
    } finally {
      for (const pid of [leafPid, wrapper.pid, unrelated.pid]) {
        if (pid) {
          try { process.kill(pid, 'SIGKILL') } catch {}
        }
      }
    }
  })
}


test('inspectProcessTree includes descendants but excludes unrelated processes', () => {
  const processes = [
    { pid: 41, parentPid: 1, startedAt: 'root' },
    { pid: 42, parentPid: 41, startedAt: 'child' },
    { pid: 43, parentPid: 42, startedAt: 'grandchild' },
    { pid: 44, parentPid: 1, startedAt: 'unrelated' },
  ]
  assert.deepEqual(inspectProcessTree(41, { readProcessTable: () => processes }).map((entry) => entry.pid), [41, 42, 43])
})

test('signalProcessTree does not signal reused PIDs or rows missing identity', () => {
  const signals = []
  const snapshot = [
    { pid: 41, parentPid: 1, startedAt: 'original' },
    { pid: 42, parentPid: 41, startedAt: 'same' },
    { pid: 43, parentPid: 41 },
  ]
  const result = signalProcessTree(snapshot, 'SIGTERM', {
    readProcessTable: () => [
      { pid: 41, parentPid: 1, startedAt: 'replacement' },
      { pid: 42, parentPid: 1, startedAt: 'same' },
    ],
    kill: (pid, signal) => signals.push([pid, signal]),
  })
  assert.equal(result, true)
  assert.deepEqual(signals, [[42, 'SIGTERM']])
})

test('signalProcessTree terminates deepest descendants before the wrapper', () => {
  const processes = [
    { pid: 41, parentPid: 1, startedAt: 'root' },
    { pid: 42, parentPid: 41, startedAt: 'child' },
    { pid: 43, parentPid: 42, startedAt: 'grandchild' },
  ]
  const signaled = []
  signalProcessTree(processes, 'SIGTERM', {
    readProcessTable: () => processes,
    kill: (pid) => signaled.push(pid),
  })
  assert.deepEqual(signaled, [43, 42, 41])
})

test('POSIX process identities remain stable under a localized shell', (context) => {
  if (process.platform === 'win32') { context.skip('POSIX ps only'); return }
  const previous = process.env.LC_ALL
  try {
    process.env.LC_ALL = 'C'
    const baseline = inspectProcessTree(process.pid).find((record) => record.pid === process.pid)
    assert.ok(baseline)
    process.env.LC_ALL = 'pl_PL.UTF-8'
    const localized = inspectProcessTree(process.pid).find((record) => record.pid === process.pid)
    assert.ok(localized)
    assert.equal(localized.startedAt, baseline.startedAt)
  } finally {
    if (previous === undefined) delete process.env.LC_ALL
    else process.env.LC_ALL = previous
  }
})
