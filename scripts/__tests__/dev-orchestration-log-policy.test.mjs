import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isIgnorableBoxDrawingLine,
  isIgnorableEnvInjectionLine,
  isIgnorableFailureLine,
  isIgnorableMercatoCliBannerLine,
  isIgnorableSetupEnvNoticeLine,
  isIgnorableTurboBannerLine,
  isIgnorableTurboCacheCancellationLine,
  isIgnorableTurboLine,
  isIgnorableTurboSummaryLine,
} from '../dev-orchestration-log-policy.mjs'

test('isIgnorableBoxDrawingLine catches turbo error box characters', () => {
  assert.equal(isIgnorableBoxDrawingLine('╭─ Build error'), true)
  assert.equal(isIgnorableBoxDrawingLine('│ at index'), true)
  assert.equal(isIgnorableBoxDrawingLine('╰── trace'), true)
  assert.equal(isIgnorableBoxDrawingLine('Error: real failure'), false)
  assert.equal(isIgnorableBoxDrawingLine(''), false)
  assert.equal(isIgnorableBoxDrawingLine(null), false)
})

test('isIgnorableEnvInjectionLine catches dotenv injection notices', () => {
  assert.equal(isIgnorableEnvInjectionLine('◇ injecting env (12) from .env'), true)
  assert.equal(isIgnorableEnvInjectionLine('◇ injecting env (3) from .env.local'), true)
  assert.equal(isIgnorableEnvInjectionLine('Some other env line'), false)
  assert.equal(isIgnorableEnvInjectionLine(undefined), false)
})

test('isIgnorableSetupEnvNoticeLine catches setup .env notices', () => {
  assert.equal(isIgnorableSetupEnvNoticeLine('[setup] Copied .env.example to .env'), true)
  assert.equal(isIgnorableSetupEnvNoticeLine('[setup] Keeping existing .env'), true)
  assert.equal(isIgnorableSetupEnvNoticeLine('[setup] Some other notice'), false)
  assert.equal(isIgnorableSetupEnvNoticeLine(null), false)
})

test('isIgnorableMercatoCliBannerLine catches the Open Mercato CLI banner only', () => {
  assert.equal(isIgnorableMercatoCliBannerLine('Open Mercato CLI'), true)
  assert.equal(isIgnorableMercatoCliBannerLine('  Open Mercato CLI  '), true)
  assert.equal(isIgnorableMercatoCliBannerLine('Open Mercato CLI v1.2.3'), false)
  assert.equal(isIgnorableMercatoCliBannerLine('open mercato cli'), true)
  assert.equal(isIgnorableMercatoCliBannerLine(42), false)
})

test('isIgnorableTurboBannerLine catches turbo banner prefixes', () => {
  assert.equal(isIgnorableTurboBannerLine('• turbo 2.7.5'), true)
  assert.equal(isIgnorableTurboBannerLine('• Packages in scope: @open-mercato/app, @open-mercato/core'), true)
  assert.equal(isIgnorableTurboBannerLine('• Running build in 18 packages'), true)
  assert.equal(isIgnorableTurboBannerLine('• Running watch in 18 packages'), true)
  assert.equal(isIgnorableTurboBannerLine('• Remote caching disabled'), true)
  assert.equal(isIgnorableTurboBannerLine('• Other bullet'), false)
  assert.equal(isIgnorableTurboBannerLine('Error: turbo failed'), false)
})

test('isIgnorableTurboSummaryLine catches turbo end-of-run summary lines', () => {
  assert.equal(isIgnorableTurboSummaryLine('Tasks:    18 successful, 18 total'), true)
  assert.equal(isIgnorableTurboSummaryLine('Cached:   0 cached, 18 total'), true)
  assert.equal(isIgnorableTurboSummaryLine('Time:     33.93s'), true)
  assert.equal(isIgnorableTurboSummaryLine('Tasks ahead of schedule'), false)
})

test('isIgnorableTurboCacheCancellationLine catches the cache flush message on Ctrl+C', () => {
  assert.equal(isIgnorableTurboCacheCancellationLine('^C    ...Finishing writing to cache...'), true)
  assert.equal(isIgnorableTurboCacheCancellationLine('^C    ...Cancelled'), false)
})

test('isIgnorableFailureLine treats empty/whitespace and noise predicates as ignorable', () => {
  assert.equal(isIgnorableFailureLine(''), true)
  assert.equal(isIgnorableFailureLine('   '), true)
  assert.equal(isIgnorableFailureLine(null), true)
  assert.equal(isIgnorableFailureLine('╭── trace'), true)
  assert.equal(isIgnorableFailureLine('◇ injecting env (1) from .env'), true)
  assert.equal(isIgnorableFailureLine('[setup] Copied .env.example to .env'), true)
  assert.equal(isIgnorableFailureLine('Open Mercato CLI'), true)
  // Real errors must NOT be filtered
  assert.equal(isIgnorableFailureLine('Error: database unavailable'), false)
  assert.equal(isIgnorableFailureLine('TypeError: cannot read property of undefined'), false)
})

test('isIgnorableTurboLine treats empty/whitespace and turbo noise predicates as ignorable', () => {
  assert.equal(isIgnorableTurboLine(''), true)
  assert.equal(isIgnorableTurboLine('   '), true)
  assert.equal(isIgnorableTurboLine(null), true)
  assert.equal(isIgnorableTurboLine('• turbo 2.7.5'), true)
  assert.equal(isIgnorableTurboLine('• Packages in scope: @open-mercato/app'), true)
  assert.equal(isIgnorableTurboLine('Tasks: 18 successful'), true)
  assert.equal(isIgnorableTurboLine('Cached: 0 cached'), true)
  assert.equal(isIgnorableTurboLine('Time: 5.1s'), true)
  assert.equal(isIgnorableTurboLine('╭── error'), true)
  assert.equal(isIgnorableTurboLine('^C    ...Finishing writing to cache...'), true)
  // Real progress lines should NOT be filtered
  assert.equal(isIgnorableTurboLine('@open-mercato/core:build: building'), false)
  assert.equal(isIgnorableTurboLine('Error: turbo failed'), false)
})
