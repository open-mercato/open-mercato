import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renameReplaceSync } from '../lib/add-js-extension.mjs'

function epermError() {
  const error = new Error('EPERM: operation not permitted, rename')
  error.code = 'EPERM'
  return error
}

test('renameReplaceSync retries transient EPERM on win32 until the rename succeeds', () => {
  let attempts = 0
  const delays = []
  renameReplaceSync('tmp', 'target', {
    platform: 'win32',
    renameImpl: () => {
      attempts += 1
      if (attempts < 4) throw epermError()
    },
    sleepImpl: (ms) => delays.push(ms),
  })
  assert.equal(attempts, 4)
  assert.deepEqual(delays, [10, 20, 40])
})

test('renameReplaceSync throws EPERM immediately off win32', () => {
  let attempts = 0
  assert.throws(
    () =>
      renameReplaceSync('tmp', 'target', {
        platform: 'linux',
        renameImpl: () => {
          attempts += 1
          throw epermError()
        },
        sleepImpl: () => {},
      }),
    /EPERM/,
  )
  assert.equal(attempts, 1)
})

test('renameReplaceSync does not retry non-transient errors on win32', () => {
  let attempts = 0
  assert.throws(
    () =>
      renameReplaceSync('tmp', 'target', {
        platform: 'win32',
        renameImpl: () => {
          attempts += 1
          const error = new Error('ENOENT: no such file or directory')
          error.code = 'ENOENT'
          throw error
        },
        sleepImpl: () => {},
      }),
    /ENOENT/,
  )
  assert.equal(attempts, 1)
})

test('renameReplaceSync gives up once the deadline passes', () => {
  let attempts = 0
  assert.throws(
    () =>
      renameReplaceSync('tmp', 'target', {
        platform: 'win32',
        maxWaitMs: 0,
        renameImpl: () => {
          attempts += 1
          throw epermError()
        },
        sleepImpl: () => {},
      }),
    /EPERM/,
  )
  assert.equal(attempts, 1)
})
