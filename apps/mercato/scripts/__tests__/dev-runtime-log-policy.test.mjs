import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isIgnorableDerivedKeyWarningLine,
  isIgnorableSearchWarningLine,
  shouldIgnoreSplashPassthroughLine,
} from '../dev-runtime-log-policy.mjs'

test('ignores derived tenant key fallback lines', () => {
  assert.equal(
    isIgnorableDerivedKeyWarningLine('⚠️ [encryption][kms] Vault read error {'),
    true,
  )
  assert.equal(
    isIgnorableDerivedKeyWarningLine('Using derived tenant encryption keys (Vault unavailable / no DEK)'),
    true,
  )
  assert.equal(isIgnorableDerivedKeyWarningLine('Error: database unavailable'), false)
})

test('treats search strategy failures as non-blocking warnings', () => {
  assert.equal(
    isIgnorableSearchWarningLine("[SearchService] Strategy index failed {"),
    true,
  )
  assert.equal(
    isIgnorableSearchWarningLine('[search.customers] Failed to load customer entity for person profile {'),
    true,
  )
  assert.equal(isIgnorableSearchWarningLine('Error: cannot find module'), false)
})

test('suppresses post-ready raw output from failing the splash state', () => {
  assert.equal(
    shouldIgnoreSplashPassthroughLine('Error: database unavailable', { startupReady: true }),
    true,
  )
  assert.equal(
    shouldIgnoreSplashPassthroughLine('Error: database unavailable', { startupReady: false }),
    false,
  )
})
