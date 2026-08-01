import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildUnexpectedChildExitReport,
  createRuntimeFailureLatch,
  createRuntimeNoiseFilter,
  isRuntimeRestartMarker,
  createSplashPassthroughIgnoreMatcher,
  formatChildExitStatus,
  resolveChildExitCode,
  resolveUnexpectedExitCode,
  isIgnorableDerivedKeyWarningLine,
  isIgnorableExtraCertsWarningLine,
  isIgnorableQueueLogLine,
  isIgnorableSchedulerLogLine,
  isIgnorableSearchWarningLine,
  isInteractivePromptHintLine,
  isStatelessRuntimeNoiseLine,
  shouldIgnoreSplashPassthroughLine,
  stripStructuredLogPrefix,
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

test('stripStructuredLogPrefix removes the pretty transport timestamp and level', () => {
  assert.equal(
    stripStructuredLogPrefix('12:16:22.204 WARN  [shared:kms] Vault read error path=secret/data/tenant_key_123 timeoutMs=1000'),
    '[shared:kms] Vault read error path=secret/data/tenant_key_123 timeoutMs=1000',
  )
  assert.equal(stripStructuredLogPrefix('TypeError: fetch failed'), 'TypeError: fetch failed')
  assert.equal(stripStructuredLogPrefix(undefined), '')
})

test('ignores structured-logger KMS Vault fallback lines', () => {
  assert.equal(
    isIgnorableDerivedKeyWarningLine('12:16:22.204 WARN  [shared:kms] Vault read error path=secret/data/tenant_key_61905439-c148-4818-97e0-7a92bf469379 timeoutMs=1000'),
    true,
  )
  assert.equal(
    isIgnorableDerivedKeyWarningLine('12:16:22.204 WARN  [shared:kms] Vault read failed path=secret/data/tenant_key_123 status=503'),
    true,
  )
  assert.equal(
    isIgnorableDerivedKeyWarningLine('12:16:22.204 WARN  [shared:kms] Vault write error path=secret/data/tenant_key_123 timeoutMs=1000'),
    true,
  )
  assert.equal(
    isIgnorableDerivedKeyWarningLine('12:16:22.204 WARN  [shared:kms] No tenant DEK found in Vault tenantId=61905439-c148-4818-97e0-7a92bf469379 path=secret/data/tenant_key_61905439-c148-4818-97e0-7a92bf469379'),
    true,
  )
  assert.equal(
    isIgnorableDerivedKeyWarningLine('12:16:22.204 WARN  [shared:kms] Using derived tenant encryption keys (Vault unavailable / no DEK) secretFingerprint=c7eabc7b8d9e7cd0'),
    true,
  )
  assert.equal(isIgnorableDerivedKeyWarningLine('TypeError: fetch failed'), true)
  assert.equal(
    isIgnorableDerivedKeyWarningLine('12:16:22.204 ERROR [sales:orders] Payment capture failed orderId=42'),
    false,
  )
  assert.equal(isIgnorableDerivedKeyWarningLine('TypeError: cannot read properties of undefined'), false)
})

test('ignores the derived-key fallback banner body lines', () => {
  assert.equal(
    isIgnorableDerivedKeyWarningLine(' 🚨 Using derived tenant encryption keys (Vault unavailable / no DEK)'),
    true,
  )
  assert.equal(isIgnorableDerivedKeyWarningLine(' Source: TENANT_DATA_ENCRYPTION_FALLBACK_KEY'), true)
  assert.equal(isIgnorableDerivedKeyWarningLine(' Source: TENANT_DATA_ENCRYPTION_KEY'), true)
  assert.equal(isIgnorableDerivedKeyWarningLine(' Source: dev default secret (do NOT use in production)'), true)
  assert.equal(isIgnorableDerivedKeyWarningLine(' Secret fingerprint (sha256, truncated): c7eabc7b8d9e7cd0'), true)
  assert.equal(
    isIgnorableDerivedKeyWarningLine(' Persist this secret securely. Without it, encrypted tenant data cannot be recovered after restart.'),
    true,
  )
})

test('structured-logger KMS fallback lines count as stateless runtime noise', () => {
  assert.equal(
    isStatelessRuntimeNoiseLine('12:16:22.204 WARN  [shared:kms] Vault read error path=secret/data/tenant_key_123 timeoutMs=1000'),
    true,
  )
  assert.equal(isStatelessRuntimeNoiseLine('TypeError: fetch failed'), true)
  assert.equal(isStatelessRuntimeNoiseLine('Secret fingerprint (sha256, truncated): c7eabc7b8d9e7cd0'), true)
  assert.equal(
    isStatelessRuntimeNoiseLine('12:16:22.204 ERROR [sales:orders] Payment capture failed orderId=42'),
    false,
  )
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

test('suppresses full multi-line derived-key warning blocks', () => {
  const ignoreMatcher = createSplashPassthroughIgnoreMatcher()

  assert.equal(ignoreMatcher('⚠️ [encryption][kms] Vault read error {', { startupReady: true }), true)
  assert.equal(
    ignoreMatcher("error: 'Request to http://localhost:8200/v1/secret/data/tenant_key_123 timed out after 5000ms',", { startupReady: true }),
    true,
  )
  assert.equal(ignoreMatcher("path: 'secret/data/tenant_key_123',", { startupReady: true }), true)
  assert.equal(ignoreMatcher('details: {', { startupReady: true }), true)
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
  assert.equal(ignoreLine('}', { startupReady: true }), true)

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

test('createRuntimeNoiseFilter tracks multi-line derived-key warning blocks across calls', () => {
  const ignoreLine = createRuntimeNoiseFilter()

  assert.equal(ignoreLine('⚠️ [encryption][kms] Vault read error {', { startupReady: true }), true)
  assert.equal(
    ignoreLine("error: 'Request to http://localhost:8200/v1/secret/data/tenant_key_123 timed out after 5000ms',", { startupReady: true }),
    true,
  )
  assert.equal(ignoreLine("path: 'secret/data/tenant_key_123',", { startupReady: true }), true)
  assert.equal(ignoreLine('details: {', { startupReady: true }), true)
  assert.equal(ignoreLine('}', { startupReady: true }), true)
  assert.equal(ignoreLine('}', { startupReady: true }), true)
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

test('buildUnexpectedChildExitReport replays the buffered tail exactly once in compact mode', () => {
  const report = buildUnexpectedChildExitReport({
    label: 'App runtime',
    exitStatus: 'exit code 1',
    bufferedFailureLines: [
      'Another next dev server is already running.',
      '- PID:          4242',
    ],
    logsVisible: false,
  })

  const banner = '❌ App runtime exited unexpectedly with exit code 1'
  assert.equal(report.banner, banner)
  assert.deepEqual(report.terminalLines, [
    banner,
    '📄 Last 2 runtime log line(s) before the exit:',
    'Another next dev server is already running.',
    '- PID:          4242',
    'ℹ️ Rerun with MERCATO_DEV_OUTPUT=verbose for the full runtime output.',
  ])
  // The banner is printed from terminalLines, so it must appear only once there.
  assert.equal(report.terminalLines.filter((line) => line === banner).length, 1)
  // Splash state keeps the buffered context plus the banner.
  assert.deepEqual(report.failureLines, [
    'Another next dev server is already running.',
    '- PID:          4242',
    banner,
  ])
})

test('buildUnexpectedChildExitReport does not replay lines the user is already streaming', () => {
  const report = buildUnexpectedChildExitReport({
    label: 'App runtime',
    exitStatus: 'exit code 1',
    bufferedFailureLines: ['⨯ TurbopackInternalError'],
    logsVisible: true,
  })

  assert.deepEqual(report.terminalLines, ['❌ App runtime exited unexpectedly with exit code 1'])
  // Raw logs are on screen, but the splash still needs the context.
  assert.deepEqual(report.failureLines, [
    '⨯ TurbopackInternalError',
    '❌ App runtime exited unexpectedly with exit code 1',
  ])
})

test('buildUnexpectedChildExitReport prints only the banner when nothing was buffered', () => {
  const report = buildUnexpectedChildExitReport({
    label: 'Generator watch (legacy sidecar)',
    exitStatus: 'signal SIGKILL',
    bufferedFailureLines: [],
  })

  assert.deepEqual(report.terminalLines, [
    '❌ Generator watch (legacy sidecar) exited unexpectedly with signal SIGKILL',
  ])
  assert.deepEqual(report.failureLines, [
    '❌ Generator watch (legacy sidecar) exited unexpectedly with signal SIGKILL',
  ])
})

test('buildUnexpectedChildExitReport caps splash failure lines at the newest entries', () => {
  const buffered = Array.from({ length: 20 }, (_, index) => `line ${index}`)
  const report = buildUnexpectedChildExitReport({
    label: 'App runtime',
    exitStatus: 'exit code 1',
    bufferedFailureLines: buffered,
  })

  assert.equal(report.failureLines.length, 10)
  assert.equal(report.failureLines[0], 'line 11')
  assert.equal(report.failureLines.at(-1), '❌ App runtime exited unexpectedly with exit code 1')
  // The terminal replay is not capped by maxFailureLines.
  assert.equal(report.terminalLines.length, buffered.length + 3)
})

test('isRuntimeRestartMarker recognises the restart announcements the CLI prints', () => {
  assert.equal(
    isRuntimeRestartMarker('[server] Next.js dev server exited before becoming ready (exit code 1). Retrying once...'),
    true,
  )
  assert.equal(
    isRuntimeRestartMarker('[server] Detected corrupted Turbopack dev cache. Clearing .mercato/next/dev and restarting Next.js once...'),
    true,
  )
  assert.equal(isRuntimeRestartMarker('Another next dev server is already running.'), false)
  assert.equal(isRuntimeRestartMarker('[server] Ready in 1ms'), false)
  assert.equal(isRuntimeRestartMarker(undefined), false)
})

test('createRuntimeFailureLatch swallows output until the runtime announces a restart', () => {
  const latch = createRuntimeFailureLatch()

  assert.equal(latch.isLatched(), false)
  // A line that arrives before any failure is classified normally.
  assert.equal(latch.releaseOn('✓ Ready in 1ms'), false)

  latch.latch()
  assert.equal(latch.isLatched(), true)
  // Ordinary output stays swallowed while the reporter is in raw passthrough.
  assert.equal(latch.releaseOn('- PID:          4242'), false)
  assert.equal(latch.isLatched(), true)

  // The cold-start retry marker hands classification back, so the restart and
  // ready lines that follow can reset the splash and start route warmup.
  assert.equal(
    latch.releaseOn('[server] Next.js dev server exited before becoming ready (exit code 1). Retrying once...'),
    true,
  )
  assert.equal(latch.isLatched(), false)
})

test('createRuntimeFailureLatch releases on the Turbopack cache recovery marker', () => {
  const latch = createRuntimeFailureLatch()
  latch.latch()

  assert.equal(
    latch.releaseOn('[server] Detected corrupted Turbopack dev cache. Clearing .mercato/next/dev and restarting Next.js once...'),
    true,
  )
  assert.equal(latch.isLatched(), false)
})

test('createRuntimeFailureLatch re-arms after a release and keeps instances independent', () => {
  const latch = createRuntimeFailureLatch()
  latch.latch()
  latch.releaseOn('[server] Next.js dev server exited before becoming ready (exit code 1). Retrying once...')

  // A second failure after the restart must latch again.
  latch.latch()
  assert.equal(latch.isLatched(), true)
  assert.equal(latch.releaseOn('⨯ TurbopackInternalError'), false)

  const other = createRuntimeFailureLatch()
  assert.equal(other.isLatched(), false)
  // A released latch reports no release for a marker it never latched on.
  assert.equal(other.releaseOn('[server] Detected corrupted Turbopack dev cache. Clearing .mercato/next/dev and restarting Next.js once...'), false)
})

test('unexpected child exits resolve a non-zero exit code', () => {
  assert.equal(formatChildExitStatus({ code: 1 }), 'exit code 1')
  assert.equal(formatChildExitStatus({ code: null, signal: 'SIGTERM' }), 'signal SIGTERM')
  assert.equal(formatChildExitStatus({ code: null, signal: null }), 'an unknown status')

  assert.equal(resolveChildExitCode({ code: 3 }), 3)
  assert.equal(resolveChildExitCode({ code: null, signal: 'SIGINT' }), 130)
  assert.equal(resolveChildExitCode({ code: null, signal: 'SIGTERM' }), 143)
  assert.equal(resolveChildExitCode({ code: null, signal: null }, 7), 7)

  // A runtime that exits cleanly but unexpectedly must still fail the wrapper.
  assert.equal(resolveUnexpectedExitCode({ code: 0 }), 1)
  assert.equal(resolveUnexpectedExitCode({ code: 1 }), 1)
  assert.equal(resolveUnexpectedExitCode({ code: null, signal: 'SIGTERM' }), 143)
})
