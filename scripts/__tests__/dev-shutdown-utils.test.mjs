import test from 'node:test'
import assert from 'node:assert/strict'
import { ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acquireDevSession, DevSessionConflictError } from '../dev-session-guard.mjs'
import { readProcessTable } from '../dev-process-state.mjs'

import { getSessionProcessTargets, killProcessTree, waitForProcessTreesExit } from '../dev-shutdown-utils.mjs'

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

  const result = killProcessTree(child, 'SIGTERM', { platform: 'linux', spawn: fake, readProcesses: () => [] })

  assert.equal(result, true)
  assert.deepEqual(child.killCalls, ['SIGTERM'])
  assert.equal(calls.length, 0)
})

test('killProcessTree on darwin forwards SIGKILL to child.kill', () => {
  const child = makeFakeChild(500)

  killProcessTree(child, 'SIGKILL', { platform: 'darwin', readProcesses: () => [] })

  assert.deepEqual(child.killCalls, ['SIGKILL'])
})

test('killProcessTree on posix retries already-signaled children', () => {
  const child = makeFakeChild(8, { killed: true })

  const result = killProcessTree(child, 'SIGTERM', { platform: 'linux', readProcesses: () => [] })

  assert.equal(result, true)
  assert.deepEqual(child.killCalls, ['SIGTERM'])
})

test('killProcessTree returns false for nullish child', () => {
  assert.equal(killProcessTree(null, 'SIGTERM', { platform: 'linux', readProcesses: () => [] }), false)
  assert.equal(killProcessTree(undefined, 'SIGTERM', { platform: 'win32' }), false)
})

test('killProcessTree on posix swallows child.kill exceptions', () => {
  const child = {
    pid: 11,
    killed: false,
    kill: () => { throw new Error('boom') },
  }

  const result = killProcessTree(child, 'SIGTERM', { platform: 'linux', readProcesses: () => [] })

  assert.equal(result, false)
})


test('forced shutdown still signals a remembered grandchild after its wrapper exits', () => {
  const child = makeFakeChild(8, { killed: true })
  const signals = []
  const initialProcesses = [
    { pid: 8, ppid: 1, identity: 'wrapper', state: 'S' },
    { pid: 9, ppid: 8, identity: 'grandchild', state: 'S' },
  ]
  const options = {
    platform: 'linux',
    readProcesses: () => initialProcesses,
    kill: (pid, signal) => { signals.push([pid, signal]) },
  }
  killProcessTree(child, 'SIGTERM', options)
  killProcessTree(child, 'SIGKILL', {
    ...options,
    readProcesses: () => initialProcesses.slice(1),
  })
  assert.deepEqual(signals, [[9, 'SIGTERM'], [9, 'SIGKILL']])
  assert.deepEqual(child.killCalls, ['SIGTERM'])
})


test('shutdown terminates a real grandchild that ignores TERM after its wrapper exits', { skip: process.platform === 'win32' }, async () => {
  const grandchildProgram = "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"
  const wrapperProgram = `
    const { spawn } = require('node:child_process')
    const child = spawn(process.execPath, ['--eval', ${JSON.stringify(grandchildProgram)}], { stdio: ['ignore', 'pipe', 'ignore'] })
    child.stdout.once('data', () => console.log(child.pid))
    process.on('SIGTERM', () => process.exit(0))
    setInterval(() => {}, 1000)
  `
  const wrapper = spawn(process.execPath, ['--eval', wrapperProgram], { stdio: ['ignore', 'pipe', 'ignore'] })
  let grandchildPid
  try {
    grandchildPid = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('fixture did not start')), 5_000)
      wrapper.stdout.once('data', (chunk) => { clearTimeout(timeout); resolve(Number(String(chunk).trim())) })
    })
    assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0)
    const wrapperExited = new Promise((resolve) => wrapper.once('exit', resolve))
    killProcessTree(wrapper, 'SIGTERM')
    await wrapperExited
    process.kill(grandchildPid, 0)
    killProcessTree(wrapper, 'SIGKILL')
    const deadline = Date.now() + 3_000
    while (readProcessTable()?.some((entry) => entry.pid === grandchildPid && !entry.state.startsWith('Z'))) {
      assert.ok(Date.now() < deadline, 'grandchild survived forced shutdown')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  } finally {
    wrapper.kill('SIGKILL')
    if (Number.isInteger(grandchildPid)) {
      try { process.kill(grandchildPid, 'SIGKILL') } catch {}
    }
  }
})

test('forced cleanup does not signal a remembered PID after it has been reused', () => {
  const child = makeFakeChild(8)
  const signals = []
  const options = {
    platform: 'linux',
    readProcesses: () => [
      { pid: 8, ppid: 1, identity: 'wrapper', state: 'S' },
      { pid: 9, ppid: 8, identity: 'old-grandchild', state: 'S' },
    ],
    kill: (pid, signal) => signals.push([pid, signal]),
  }
  killProcessTree(child, 'SIGTERM', options)
  killProcessTree(child, 'SIGKILL', {
    ...options,
    readProcesses: () => [{ pid: 9, ppid: 1, identity: 'unrelated-new-process', state: 'S' }],
  })
  assert.deepEqual(signals, [[9, 'SIGTERM']])
})


test('shutdown discovers a session orphan after its wrapper exited before signal handling', { skip: process.platform === 'win32' }, async () => {
  const token = randomUUID()
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-session-orphan-'))
  const grandchildProgram = "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"
  const wrapperProgram = `
    const { spawn } = require('node:child_process')
    const child = spawn(process.execPath, ['--eval', ${JSON.stringify(grandchildProgram)}], { stdio: ['ignore', 'pipe', 'ignore'] })
    child.stdout.once('data', () => { console.log(child.pid); process.exit(0) })
  `
  const wrapper = spawn(process.execPath, ['--eval', wrapperProgram], {
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, OM_DEV_SESSION_TOKEN: token, OM_DEV_PROCESS_OWNER_PID: String(process.pid) },
  })
  const wrapperExited = new Promise((resolve) => wrapper.once('exit', resolve))
  let grandchildPid
  try {
    grandchildPid = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('fixture did not start')), 5_000)
      wrapper.stdout.once('data', (chunk) => { clearTimeout(timeout); resolve(Number(String(chunk).trim())) })
    })
    await wrapperExited
    assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0)
    const lockDirectory = path.join(workspaceRoot, '.mercato/dev-session.lock')
    fs.mkdirSync(path.join(lockDirectory, 'members'), { recursive: true })
    fs.writeFileSync(path.join(lockDirectory, 'owner.json'), JSON.stringify({
      pid: 2_147_483_647, token, mode: 'greenfield', workspaceRoot,
    }))
    assert.throws(() => acquireDevSession({ workspaceRoot, token: null }), (error) => {
      assert.ok(error instanceof DevSessionConflictError)
      assert.equal(error.owner.pid, grandchildPid)
      return true
    })
    const targets = getSessionProcessTargets({ token, ownsLock: true })
    assert.ok(targets.some((target) => target.pid === grandchildPid), 'session orphan was not discovered')
    for (const target of targets) killProcessTree(target, 'SIGTERM')
    process.kill(grandchildPid, 0)
    for (const target of targets) killProcessTree(target, 'SIGKILL')
    assert.equal(await waitForProcessTreesExit(targets), true)
    assert.deepEqual(getSessionProcessTargets({ token: randomUUID(), ownsLock: true }), [])
    const restarted = acquireDevSession({ workspaceRoot, token: null })
    restarted.release()
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
    wrapper.kill('SIGKILL')
    if (Number.isInteger(grandchildPid)) {
      try { process.kill(grandchildPid, 'SIGKILL') } catch {}
    }
  }
})


test('force pass retains native child kill when process inspection becomes unavailable', () => {
  const child = new ChildProcess()
  child.pid = 8
  const signals = []
  child.kill = (signal) => { signals.push(signal); return true }
  killProcessTree(child, 'SIGTERM', {
    platform: 'linux',
    readProcesses: () => [{ pid: 8, ppid: 1, identity: 'wrapper', state: 'S' }],
  })
  killProcessTree(child, 'SIGKILL', { platform: 'linux', readProcesses: () => null })
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})

test('failed inspection never permits unverified synthetic PID kills', () => {
  const child = makeFakeChild(8)
  killProcessTree(child, 'SIGTERM', {
    platform: 'linux',
    readProcesses: () => [{ pid: 8, ppid: 1, identity: 'wrapper', state: 'S' }],
  })
  killProcessTree(child, 'SIGKILL', { platform: 'linux', readProcesses: () => null })
  assert.deepEqual(child.killCalls, ['SIGTERM'])
})
