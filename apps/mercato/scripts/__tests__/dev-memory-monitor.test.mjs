import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  getProcessTreeMemorySample,
  getProcessTreeMemoryBytes,
  parseProcessTreeMemoryBytes,
} from '../dev-memory-monitor.mjs'

function createFakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stdout.setEncoding = () => {}
  return child
}

test('resolves null without throwing when spawn throws synchronously', async () => {
  const throwingSpawn = () => {
    throw Object.assign(new Error('spawn ps ENAMETOOLONG'), { code: 'ENAMETOOLONG' })
  }

  const result = await getProcessTreeMemoryBytes(1234, { spawn: throwingSpawn })
  assert.equal(result, null)
})

test('resolves null for non-positive or non-integer pids without spawning', async () => {
  let spawnCalls = 0
  const trackingSpawn = () => {
    spawnCalls += 1
    return createFakeChild()
  }

  assert.equal(await getProcessTreeMemoryBytes(0, { spawn: trackingSpawn }), null)
  assert.equal(await getProcessTreeMemoryBytes(-1, { spawn: trackingSpawn }), null)
  assert.equal(await getProcessTreeMemoryBytes(1.5, { spawn: trackingSpawn }), null)
  assert.equal(spawnCalls, 0)
})

test('resolves null when ps exits with a non-zero code', async () => {
  const child = createFakeChild()
  const result = getProcessTreeMemoryBytes(1234, { spawn: () => child })
  child.emit('close', 1)
  assert.equal(await result, null)
})

test('sums RSS of the process subtree on the happy path', async () => {
  const child = createFakeChild()
  const result = getProcessTreeMemoryBytes(100, { spawn: () => child })

  child.stdout.emit('data', '100 1 2048\n')
  child.stdout.emit('data', '200 100 1024\n300 999 4096\n')
  child.emit('close', 0)

  assert.equal(await result, (2048 + 1024) * 1024)
})

test('returns a rich process-tree memory sample for injected ps output', async () => {
  const child = createFakeChild()
  const result = getProcessTreeMemorySample(100, { spawn: () => child })

  child.stdout.emit('data', '100 1 2048\n')
  child.stdout.emit('data', '200 100 1024\n300 999 4096\n')
  child.emit('close', 0)

  const sample = await result
  assert.equal(sample.totalRssBytes, (2048 + 1024) * 1024)
  assert.equal(sample.totalRssMb, 3)
})

test('parseProcessTreeMemoryBytes returns null when the root pid is absent', () => {
  assert.equal(parseProcessTreeMemoryBytes('200 1 1024\n', 100), null)
})
