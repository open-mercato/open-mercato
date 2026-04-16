import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createRuntimeNoiseFilter,
  createSplashPassthroughIgnoreMatcher,
  isIgnorableDerivedKeyWarningLine,
  isIgnorableExtraCertsWarningLine,
  isIgnorableQueueLogLine,
  isIgnorableSchedulerLogLine,
  isIgnorableSearchWarningLine,
  isInteractivePromptHintLine,
  isStatelessRuntimeNoiseLine,
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
    shouldIgnoreSplashPassthroughLine('[SearchService] Strategy index failed {', { startupReady: true }),
    true,
  )
  assert.equal(
    shouldIgnoreSplashPassthroughLine('Error: database unavailable', { startupReady: false }),
    false,
  )
})

test('suppresses full multi-line search warning blocks', () => {
  const ignoreMatcher = createSplashPassthroughIgnoreMatcher()

  assert.equal(ignoreMatcher('[SearchService] Strategy index failed {', { startupReady: true }), true)
  assert.equal(ignoreMatcher('error: relation "search_documents" does not exist', { startupReady: true }), true)
  assert.equal(ignoreMatcher('details: {', { startupReady: true }), true)
  assert.equal(ignoreMatcher('hint: retrying with fallback strategy', { startupReady: true }), true)
  assert.equal(ignoreMatcher('}', { startupReady: true }), true)
  assert.equal(ignoreMatcher('}', { startupReady: true }), true)
  assert.equal(ignoreMatcher('Error: database unavailable', { startupReady: true }), false)
})

test('isIgnorableQueueLogLine matches queue worker log prefix only', () => {
  assert.equal(isIgnorableQueueLogLine('[queue:default] processing job 42'), true)
  assert.equal(isIgnorableQueueLogLine('  [queue:webhooks] heartbeat'), true)
  assert.equal(isIgnorableQueueLogLine('[scheduler:cron] tick'), false)
  assert.equal(isIgnorableQueueLogLine('Queue overflow detected'), false)
  assert.equal(isIgnorableQueueLogLine(''), false)
  assert.equal(isIgnorableQueueLogLine(undefined), false)
})

test('isIgnorableSchedulerLogLine matches scheduler log prefix only', () => {
  assert.equal(isIgnorableSchedulerLogLine('[scheduler:cron] tick fired'), true)
  assert.equal(isIgnorableSchedulerLogLine('  [scheduler:default] heartbeat'), true)
  assert.equal(isIgnorableSchedulerLogLine('[queue:default] busy'), false)
  assert.equal(isIgnorableSchedulerLogLine('Scheduler crashed'), false)
  assert.equal(isIgnorableSchedulerLogLine(null), false)
})

test('isInteractivePromptHintLine matches the exact Press Ctrl+C banner', () => {
  assert.equal(isInteractivePromptHintLine('Press Ctrl+C to stop.'), true)
  assert.equal(isInteractivePromptHintLine('  Press Ctrl+C to stop.  '), true)
  assert.equal(isInteractivePromptHintLine('Press Ctrl+C to stop'), false)
  assert.equal(isInteractivePromptHintLine('press ctrl+c to stop.'), false)
  assert.equal(isInteractivePromptHintLine(42), false)
})

test('isIgnorableExtraCertsWarningLine matches the Node extra-certs warning prefix', () => {
  assert.equal(
    isIgnorableExtraCertsWarningLine('Warning: Ignoring extra certs from `/etc/ssl/extra.pem`, load failed: ...'),
    true,
  )
  assert.equal(
    isIgnorableExtraCertsWarningLine('  Warning: Ignoring extra certs from foo'),
    true,
  )
  assert.equal(isIgnorableExtraCertsWarningLine('Warning: deprecated API usage'), false)
  assert.equal(isIgnorableExtraCertsWarningLine(undefined), false)
})

test('isStatelessRuntimeNoiseLine combines all single-line ignore predicates', () => {
  assert.equal(isStatelessRuntimeNoiseLine('[queue:default] running'), true)
  assert.equal(isStatelessRuntimeNoiseLine('[scheduler:cron] tick'), true)
  assert.equal(isStatelessRuntimeNoiseLine('Press Ctrl+C to stop.'), true)
  assert.equal(isStatelessRuntimeNoiseLine('Warning: Ignoring extra certs from foo'), true)
  assert.equal(isStatelessRuntimeNoiseLine('⚠️ [encryption][kms] Vault read error {'), true)
  assert.equal(isStatelessRuntimeNoiseLine('[SearchService] Strategy index failed {'), true)
  assert.equal(isStatelessRuntimeNoiseLine('Error: real failure'), false)
  assert.equal(isStatelessRuntimeNoiseLine(''), false)
  assert.equal(isStatelessRuntimeNoiseLine(null), false)
})

test('createRuntimeNoiseFilter ignores empty, stateless noise, and multi-line search warning blocks', () => {
  const ignoreLine = createRuntimeNoiseFilter()

  // Empty / whitespace-only / non-string
  assert.equal(ignoreLine(''), true)
  assert.equal(ignoreLine('   '), true)
  assert.equal(ignoreLine(null), true)

  // Stateless single-line noise patterns
  assert.equal(ignoreLine('[queue:default] processing'), true)
  assert.equal(ignoreLine('[scheduler:cron] tick'), true)
  assert.equal(ignoreLine('Press Ctrl+C to stop.'), true)
  assert.equal(ignoreLine('Warning: Ignoring extra certs from /tmp/extra.pem'), true)
  assert.equal(ignoreLine('⚠️ [encryption][kms] Vault read error {'), true)

  // Real error lines should NOT be ignored
  assert.equal(ignoreLine('Error: database unavailable'), false)
  assert.equal(ignoreLine('TypeError: cannot read property of undefined'), false)
})

test('createRuntimeNoiseFilter tracks multi-line search warning blocks across calls', () => {
  const ignoreLine = createRuntimeNoiseFilter()

  // Header line opens the block
  assert.equal(ignoreLine('[SearchService] Strategy index failed {', { startupReady: true }), true)
  // Lines inside the block are also ignored even though they look like real errors
  assert.equal(ignoreLine('error: relation "search_documents" does not exist', { startupReady: true }), true)
  assert.equal(ignoreLine('details: {', { startupReady: true }), true)
  assert.equal(ignoreLine('hint: retrying with fallback strategy', { startupReady: true }), true)
  // Closing braces unwind the depth
  assert.equal(ignoreLine('}', { startupReady: true }), true)
  assert.equal(ignoreLine('}', { startupReady: true }), true)
  // Once the block is fully closed, real errors are surfaced again
  assert.equal(ignoreLine('Error: database unavailable', { startupReady: true }), false)
})

test('createRuntimeNoiseFilter instances do not share state', () => {
  const filterA = createRuntimeNoiseFilter()
  const filterB = createRuntimeNoiseFilter()

  // Open a warning block in filterA
  assert.equal(filterA('[SearchService] Strategy index failed {'), true)
  assert.equal(filterA('error: details'), true)

  // filterB should not see filterA's open block
  assert.equal(filterB('error: details'), false)
})
