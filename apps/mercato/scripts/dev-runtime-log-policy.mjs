// Mirrors the pretty transport format in packages/shared/src/lib/logger/transport.pretty.ts:
// `HH:MM:SS.mmm LEVEL [scope] message key=value`, with an `err` binding appended
// as the error stack on the following lines (first line e.g. `TypeError: fetch failed`).
const STRUCTURED_PRETTY_LOG_PREFIX = /^\d{2}:\d{2}:\d{2}\.\d{3}\s+(?:DEBUG|INFO|WARN|ERROR)\s+/

export function stripStructuredLogPrefix(line) {
  if (typeof line !== 'string') return ''
  return line.replace(STRUCTURED_PRETTY_LOG_PREFIX, '')
}

const KMS_VAULT_FALLBACK_MESSAGE_PATTERN = /^\[shared:kms\] (?:Vault (?:read|write) (?:error|failed)\b|Vault write CAS conflict\b|No tenant DEK found in Vault\b|Failed to store tenant DEK in Vault\b)/

export function isIgnorableDerivedKeyWarningLine(line) {
  if (typeof line !== 'string') return false

  const normalized = stripStructuredLogPrefix(line.trim())

  return normalized.startsWith('⚠️ [encryption][kms] Vault read error')
    || normalized.startsWith('⚠️ [encryption][kms] No tenant DEK found in Vault')
    || KMS_VAULT_FALLBACK_MESSAGE_PATTERN.test(normalized)
    || normalized.startsWith("path: 'secret/data/tenant_key_")
    || normalized.startsWith("error: 'fetch failed'")
    || normalized === 'TypeError: fetch failed'
    || normalized === '}'
    || normalized.startsWith('━━━━━━━━')
    || normalized.includes('Using derived tenant encryption keys')
    || normalized.startsWith('Source: TENANT_DATA_ENCRYPTION_FALLBACK_KEY')
    || normalized.startsWith('Source: TENANT_DATA_ENCRYPTION_KEY')
    || normalized.startsWith('Source: dev default secret')
    || normalized.startsWith('Secret: ')
    || normalized.startsWith('Secret fingerprint (sha256, truncated):')
    || normalized.startsWith('Persist this secret securely.')
}

function isIgnorableStructuredWarningBlockStartLine(line) {
  if (typeof line !== 'string') return false

  const normalized = line.trim()
  if (!normalized.endsWith('{')) return false

  return isIgnorableSearchWarningLine(normalized)
    || isIgnorableDerivedKeyWarningLine(normalized)
}

export function isIgnorableSearchWarningLine(line) {
  if (typeof line !== 'string') return false

  const normalized = line.trim()

  return /^\[SearchService\] Strategy \S+ failed\b/.test(normalized)
    || /^\[search\.[^\]]+\] Failed to\b/.test(normalized)
}

export function isIgnorableQueueLogLine(line) {
  if (typeof line !== 'string') return false
  return line.trim().startsWith('[queue:')
}

export function isIgnorableSchedulerLogLine(line) {
  if (typeof line !== 'string') return false
  return line.trim().startsWith('[scheduler:')
}

export function isInteractivePromptHintLine(line) {
  if (typeof line !== 'string') return false
  return line.trim() === 'Press Ctrl+C to stop.'
}

export function isIgnorableExtraCertsWarningLine(line) {
  if (typeof line !== 'string') return false
  return line.trim().startsWith('Warning: Ignoring extra certs from')
}

export function isIgnorableNextDevServerBannerLine(line) {
  if (typeof line !== 'string') return false
  const normalized = line.trim()
  return normalized.startsWith('▲ Next.js ')
    || normalized === '✓ Starting...'
    || normalized.startsWith('- Network:')
    || normalized.startsWith('- Environments:')
    || normalized.startsWith('- Experiments')
}

export function isIgnorableTurbopackQuirkLine(line) {
  if (typeof line !== 'string') return false
  const normalized = line.trim()
  return normalized.startsWith('⨯ preloadEntriesOnStart')
    || normalized.startsWith('⨯ serverMinification')
    || normalized.startsWith('⨯ turbopackMinify')
}

export function isIgnorableBootstrapNoiseLine(line) {
  if (typeof line !== 'string') return false
  const normalized = line.trim()
  return normalized.startsWith('[Bootstrap] Entity IDs re-registered')
    || normalized.startsWith('🚀 Starting scheduler')
    || normalized.startsWith('✓ Local scheduler started')
    || normalized.startsWith('[lazy-scheduler] Watching for enabled schedules')
    || normalized.startsWith('[lazy-scheduler] Schedule probe failed')
    || normalized.startsWith('[lazy-scheduler] Poll cycle failed')
    || normalized.startsWith('[lazy-scheduler] Initial poll failed')
    || normalized.startsWith('💡 Tip:')
}

export function createSplashPassthroughIgnoreMatcher() {
  let warningBlockDepth = 0

  return function shouldIgnoreLine(line, options = {}) {
    if (typeof line !== 'string') return false
    void options

    const normalized = line.trim()
    if (!normalized) return false

    if (warningBlockDepth > 0) {
      if (normalized.endsWith('{')) {
        warningBlockDepth += 1
      }
      if (normalized === '}') {
        warningBlockDepth = Math.max(0, warningBlockDepth - 1)
      }
      return true
    }

    if (!isIgnorableStructuredWarningBlockStartLine(normalized)) {
      return false
    }

    warningBlockDepth = 1

    return true
  }
}

export function shouldIgnoreSplashPassthroughLine(line, options = {}) {
  return createSplashPassthroughIgnoreMatcher()(line, options)
}

const STATELESS_RUNTIME_NOISE_PREDICATES = [
  isIgnorableQueueLogLine,
  isIgnorableSchedulerLogLine,
  isInteractivePromptHintLine,
  isIgnorableExtraCertsWarningLine,
  isIgnorableDerivedKeyWarningLine,
  isIgnorableSearchWarningLine,
  isIgnorableNextDevServerBannerLine,
  isIgnorableTurbopackQuirkLine,
  isIgnorableBootstrapNoiseLine,
]

export function isStatelessRuntimeNoiseLine(line) {
  if (typeof line !== 'string') return false
  for (const predicate of STATELESS_RUNTIME_NOISE_PREDICATES) {
    if (predicate(line)) return true
  }
  return false
}

export function createRuntimeNoiseFilter() {
  const splashMatcher = createSplashPassthroughIgnoreMatcher()

  return function shouldIgnoreRuntimeLine(line, options = {}) {
    if (typeof line !== 'string') return true

    const normalized = line.trim()
    if (!normalized) return true

    // Run the splash matcher first so it can track multi-line warning block
    // depth even when the header line would also be caught by the stateless
    // search-warning predicate.
    if (splashMatcher(normalized, options)) return true

    return isStatelessRuntimeNoiseLine(normalized)
  }
}
