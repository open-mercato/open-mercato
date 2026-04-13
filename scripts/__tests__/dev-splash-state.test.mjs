import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeSplashDisplayState,
  shouldPreferReadySplashState,
} from '../dev-splash-state.mjs'

test('keeps pre-ready failures visible', () => {
  const state = normalizeSplashDisplayState({
    phase: 'Runtime error detected',
    detail: 'Database connection failed',
    failed: true,
    ready: false,
    readyUrl: null,
    loginUrl: null,
    failureLines: ['Database connection failed'],
    failureCommand: 'yarn dev',
  })

  assert.equal(state.failed, true)
  assert.deepEqual(state.failureLines, ['Database connection failed'])
  assert.equal(state.failureCommand, 'yarn dev')
})

test('prefers ready state once launch succeeded', () => {
  const state = normalizeSplashDisplayState({
    phase: 'Runtime error detected',
    detail: 'Warmup incomplete: vector indexing timed out',
    failed: true,
    ready: true,
    readyUrl: 'http://localhost:3000',
    loginUrl: 'http://localhost:3000/login',
    failureLines: ['[SearchService] Strategy index failed {'],
    failureCommand: 'yarn dev',
  })

  assert.equal(shouldPreferReadySplashState(state), true)
  assert.equal(state.failed, false)
  assert.deepEqual(state.failureLines, [])
  assert.equal(state.failureCommand, null)
  assert.equal(state.phase, 'App is ready')
})
