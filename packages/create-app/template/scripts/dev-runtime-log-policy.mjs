export function isIgnorableDerivedKeyWarningLine(line) {
  if (typeof line !== 'string') return false

  return line.startsWith('⚠️ [encryption][kms] Vault read error')
    || line.startsWith('⚠️ [encryption][kms] No tenant DEK found in Vault')
    || line.startsWith("path: 'secret/data/tenant_key_")
    || line.startsWith("error: 'fetch failed'")
    || line === '}'
    || line.startsWith('━━━━━━━━')
    || line.includes('Using derived tenant encryption keys')
    || line.startsWith('Source: TENANT_DATA_ENCRYPTION_FALLBACK_KEY')
    || line.startsWith('Secret: ')
    || line.startsWith('Persist this secret securely.')
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

    if (!isIgnorableSearchWarningLine(normalized)) {
      return false
    }

    if (normalized.endsWith('{')) {
      warningBlockDepth = 1
    }

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
