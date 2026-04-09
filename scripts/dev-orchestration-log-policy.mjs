// Centralized noise-filter policy for the dev orchestration script
// (`scripts/dev.mjs`). This module owns every "is this line operator-visible
// noise from yarn/turbo/setup output?" decision so the orchestrator does not
// have to embed inline pattern lists.
//
// Add new patterns here whenever a stage emits noise that should be hidden
// from captured failure output or the splash UI. Tests in
// `scripts/__tests__/dev-orchestration-log-policy.test.mjs` MUST cover any new
// predicate.

import { stripAnsi } from './dev-splash-helpers.mjs'

function normalize(line) {
  return stripAnsi(String(line ?? '')).replace(/\s+$/, '').trim()
}

export function isIgnorableBoxDrawingLine(line) {
  if (typeof line !== 'string') return false
  return /^[╭│╰]/.test(normalize(line))
}

export function isIgnorableEnvInjectionLine(line) {
  if (typeof line !== 'string') return false
  return /^◇ injecting env \(\d+\) from \.env\b/i.test(normalize(line))
}

export function isIgnorableSetupEnvNoticeLine(line) {
  if (typeof line !== 'string') return false
  return /^\[setup\] (Copied \.env\.example to \.env|Keeping existing \.env)$/i.test(normalize(line))
}

export function isIgnorableMercatoCliBannerLine(line) {
  if (typeof line !== 'string') return false
  return /^Open Mercato CLI$/i.test(normalize(line))
}

export function isIgnorableTurboBannerLine(line) {
  if (typeof line !== 'string') return false
  const plain = normalize(line)
  return plain.startsWith('• turbo ')
    || plain.startsWith('• Packages in scope:')
    || plain.startsWith('• Running build in ')
    || plain.startsWith('• Running watch in ')
    || plain.startsWith('• Remote caching disabled')
}

export function isIgnorableTurboSummaryLine(line) {
  if (typeof line !== 'string') return false
  const plain = normalize(line)
  return plain.startsWith('Tasks:')
    || plain.startsWith('Cached:')
    || plain.startsWith('Time:')
}

export function isIgnorableTurboCacheCancellationLine(line) {
  if (typeof line !== 'string') return false
  return normalize(line) === '^C    ...Finishing writing to cache...'
}

const FAILURE_NOISE_PREDICATES = [
  isIgnorableBoxDrawingLine,
  isIgnorableEnvInjectionLine,
  isIgnorableSetupEnvNoticeLine,
  isIgnorableMercatoCliBannerLine,
]

export function isIgnorableFailureLine(line) {
  if (typeof line !== 'string') return true
  const plain = normalize(line)
  if (!plain) return true
  for (const predicate of FAILURE_NOISE_PREDICATES) {
    if (predicate(plain)) return true
  }
  return false
}

const TURBO_NOISE_PREDICATES = [
  isIgnorableTurboBannerLine,
  isIgnorableTurboSummaryLine,
  isIgnorableTurboCacheCancellationLine,
  isIgnorableBoxDrawingLine,
]

export function isIgnorableTurboLine(line) {
  if (typeof line !== 'string') return true
  const plain = normalize(line)
  if (!plain) return true
  for (const predicate of TURBO_NOISE_PREDICATES) {
    if (predicate(plain)) return true
  }
  return false
}
