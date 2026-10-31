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

export function isIgnorableTurboShutdownLine(line) {
  if (typeof line !== 'string') return false
  const plain = normalize(line)
  return plain === '^C'
    || plain.startsWith('^C ')
    || /^received (SIGINT|SIGTERM),? shutting down/i.test(plain)
    || /^command (interrupted|cancelled|canceled)/i.test(plain)
}

export function isIgnorableConsolidatedWatchLine(line) {
  if (typeof line !== 'string') return false
  const plain = normalize(line)
  if (!plain.startsWith('[watch]')) return false
  return /^\[watch\] consolidated watcher: /.test(plain)
    || /^\[watch\] watch scope: /.test(plain)
    || /^\[watch\] [^:]+: rebuilding\.\.\.$/.test(plain)
    || /^\[watch\] [^:]+: rebuild complete$/.test(plain)
    || /^\[watch\] [^:]+: no source files found, skipping rebuild$/.test(plain)
    || /^\[watch\] no workspace packages with a `watch` script /.test(plain)
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
  isIgnorableTurboShutdownLine,
  isIgnorableBoxDrawingLine,
  isIgnorableConsolidatedWatchLine,
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

const SUMMARY_BOX_CHARS = /[╔║╚]/

// Compact mode captures `mercato init` output into the log file only, which
// used to hide the "Users created" box with the login credentials. Returns the
// LAST double-line box (╔ … ╚) from the captured lines, with any turbo task
// prefix stripped, or [] when the output has none.
export function extractInitSummaryBox(lines) {
  if (!Array.isArray(lines)) return []
  const plain = lines.map((line) => stripAnsi(String(line ?? '')).replace(/\s+$/, ''))
  let start = -1
  for (let index = plain.length - 1; index >= 0; index -= 1) {
    if (plain[index].includes('╔')) {
      start = index
      break
    }
  }
  if (start === -1) return []
  const box = []
  for (let index = start; index < plain.length; index += 1) {
    const line = plain[index]
    const column = line.search(SUMMARY_BOX_CHARS)
    if (column === -1) return []
    box.push(line.slice(column))
    if (line.includes('╚')) return box
  }
  return []
}

// What compact setup echoes after `mercato init`: the credentials box on a
// first run, or the "already initialized" notice when a re-run kept the data.
export function extractInitSummaryLines(lines) {
  const box = extractInitSummaryBox(lines)
  if (box.length > 0) return box
  if (!Array.isArray(lines)) return []
  const kept = lines.map((line) => normalize(line)).find((line) => line.includes('Database already initialized'))
  return kept ? [kept] : []
}
