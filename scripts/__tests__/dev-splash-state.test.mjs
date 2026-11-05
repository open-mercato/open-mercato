import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasActiveRuntimeIncident,
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

test('keeps a post-ready incident visible instead of normalizing it away', () => {
  const state = normalizeSplashDisplayState({
    phase: 'Runtime error detected',
    detail: 'Relation `sandboxs` is missing',
    failed: false,
    ready: true,
    readyUrl: 'http://localhost:3000',
    loginUrl: 'http://localhost:3000/login',
    failureLines: ['error: relation "sandboxs" does not exist'],
    failureCommand: 'yarn dev',
    runtime: {
      generation: 1,
      health: 'degraded',
      incidents: [{ generation: 1, code: 'db_relation_missing', title: 'Database schema mismatch' }],
    },
  })

  assert.equal(shouldPreferReadySplashState(state), false)
  assert.equal(state.phase, 'Runtime error detected')
  assert.deepEqual(state.failureLines, ['error: relation "sandboxs" does not exist'])
})

test('still normalizes once the structured runtime state reports ready', () => {
  const state = normalizeSplashDisplayState({
    phase: 'Runtime error detected',
    detail: 'Warmup incomplete: vector indexing timed out',
    failed: true,
    ready: true,
    readyUrl: 'http://localhost:3000',
    loginUrl: 'http://localhost:3000/login',
    failureLines: ['[SearchService] Strategy index failed {'],
    failureCommand: 'yarn dev',
    runtime: { generation: 2, health: 'ready', incidents: [] },
  })

  assert.equal(state.failed, false)
  assert.deepEqual(state.failureLines, [])
  assert.equal(state.phase, 'App is ready')
})

test('ignores incidents left behind by an older generation', () => {
  const runtimeState = {
    ready: true,
    readyUrl: 'http://localhost:3000',
    runtime: {
      generation: 3,
      health: 'ready',
      incidents: [{ generation: 2, code: 'db_relation_missing' }],
    },
  }

  assert.equal(hasActiveRuntimeIncident(runtimeState), false)
  assert.equal(shouldPreferReadySplashState(runtimeState), true)
})

test('treats a missing structured runtime payload as no active incident', () => {
  assert.equal(hasActiveRuntimeIncident({ ready: true }), false)
  assert.equal(hasActiveRuntimeIncident(null), false)
})
